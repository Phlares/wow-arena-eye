"""A.2 transseasonal map-position features: map-normalized via occupancy-grid bounds,
mechanics-free so they stay comparable across seasons."""
import numpy as np
import pytest

from wae.features2 import map_position_features


def s(t, x, y):
    return {"tSec": t, "x": x, "y": y}


def _blob(tracks):
    """tracks: {unitId: (team, samples)}"""
    return {
        "playerUnitId": "P",
        "teams": [
            {"team": "friendly", "players": [
                {"player": {"unitId": u, "team": "friendly", "spec": "265"}}
                for u, (tm, _) in tracks.items() if tm == "friendly"
            ]},
            {"team": "enemy", "players": [
                {"player": {"unitId": u, "team": "enemy", "spec": "71"}}
                for u, (tm, _) in tracks.items() if tm == "enemy"
            ]},
        ],
        "positionTracks": [
            {"unitId": u, "samples": smp, "breaks": []} for u, (_, smp) in tracks.items()
        ],
    }


# 100x100 map, fully playable (all cells open), center (50, 50)
GRID = {
    "bounds": {"minX": 0.0, "minY": 0.0, "maxX": 100.0, "maxY": 100.0},
    "cellSize": 10.0, "cols": 10, "rows": 10,
    "voidness": [0.0] * 100,
}


def test_center_dist_and_edge_proximity():
    # I sit exactly at the center the whole match: center dist 0, never near an edge.
    me = [s(t, 50.0, 50.0) for t in range(0, 60, 2)]
    enemy = [s(t, 80.0, 50.0) for t in range(0, 60, 2)]
    blob = _blob({"P": ("friendly", me), "E": ("enemy", enemy)})
    out = map_position_features(blob, GRID)
    assert out["center_dist_frac_mean"] == pytest.approx(0.0)
    assert out["edge_proximity_frac"] == pytest.approx(0.0)


def test_edge_hugger_flags_high_edge_proximity():
    # Parked 2yd from the x=0 wall: normalized edge distance 2/50 = 0.04 < 0.15.
    me = [s(t, 2.0, 50.0) for t in range(0, 60, 2)]
    enemy = [s(t, 80.0, 50.0) for t in range(0, 60, 2)]
    out = map_position_features(_blob({"P": ("friendly", me), "E": ("enemy", enemy)}), GRID)
    assert out["edge_proximity_frac"] == pytest.approx(1.0)
    # 48yd from center, half-diagonal = sqrt(50^2+50^2) ≈ 70.7 → ~0.679
    assert out["center_dist_frac_mean"] == pytest.approx(48.0 / np.hypot(50.0, 50.0), abs=1e-3)


def test_own_half_time_frac_uses_starting_positions():
    # My team starts left (x≈10), enemy right (x≈90) → boundary at x=50.
    # I spend the first half of my samples at x=20 (own half), second half at x=80 (enemy half).
    me = [s(t, 20.0, 50.0) for t in range(0, 30, 2)] + [s(t, 80.0, 50.0) for t in range(30, 60, 2)]
    ally = [s(t, 10.0, 40.0) for t in range(0, 60, 2)]
    enemy = [s(t, 90.0, 50.0) for t in range(0, 60, 2)]
    out = map_position_features(
        _blob({"P": ("friendly", me), "A": ("friendly", ally), "E": ("enemy", enemy)}), GRID)
    assert out["own_half_time_frac"] == pytest.approx(0.5, abs=0.05)


def test_area_coverage_of_a_quadrant():
    # My hull is the square (0,0)-(50,50) = 2500 of 10000 playable -> 0.25.
    me = [s(0, 0.0, 0.0), s(10, 50.0, 0.0), s(20, 50.0, 50.0), s(30, 0.0, 50.0), s(40, 0.0, 0.0)]
    enemy = [s(t, 80.0, 80.0) for t in range(0, 60, 2)]
    out = map_position_features(_blob({"P": ("friendly", me), "E": ("enemy", enemy)}), GRID)
    assert out["map_area_coverage_frac"] == pytest.approx(0.25, abs=0.01)


def test_no_grid_yields_only_grid_free_features():
    me = [s(t, 20.0, 50.0) for t in range(0, 60, 2)]
    enemy = [s(t, 90.0, 50.0) for t in range(0, 60, 2)]
    out = map_position_features(_blob({"P": ("friendly", me), "E": ("enemy", enemy)}), None)
    assert "center_dist_frac_mean" not in out
    assert "map_area_coverage_frac" not in out
    assert out["own_half_time_frac"] == pytest.approx(1.0)


def test_influence_json_carries_transseasonal_tags(tmp_path):
    import json
    import pandas as pd
    from wae import report

    rng = np.random.default_rng(7)
    n = 80
    df = pd.DataFrame({
        "win": rng.integers(0, 2, n).astype(float),
        "session_id": ["s"] * n,
        "match_id": [str(i) for i in range(n)],
        "casts_per_min": rng.normal(30, 5, n),
        "opener_pattern": ["A > B > C"] * n,
    })
    screen_df = pd.DataFrame([{
        "feature": "casts_per_min", "tier": "process", "n": n,
        "median_win": 30.0, "median_loss": 29.0, "rank_biserial": 0.1,
        "p_raw": 0.5, "p_mmr_adj": 0.5, "q_raw": 0.5, "q_mmr_adj": 0.5,
    }])
    report.write_reports(tmp_path, "test", df, screen_df, [], [], [], [],
                         transseasonal={"casts_per_min", "not_a_column"})
    payload = json.loads((tmp_path / "influence-test.json").read_text(encoding="utf8"))
    assert payload["transseasonal_features"] == ["casts_per_min"]  # only real columns
    assert payload["screen"][0]["transseasonal"] is True


def test_transseasonal_registry_contains_map_features():
    from wae.features import TRANSSEASONAL

    for f in ("center_dist_frac_mean", "edge_proximity_frac",
              "own_half_time_frac", "map_area_coverage_frac",
              "casts_per_min", "distanceMoved_per_min", "timeStationarySec_per_min"):
        assert f in TRANSSEASONAL
