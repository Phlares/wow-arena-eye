"""A.4 carried items: comp archetypes, mid-game spell bigrams, calibration bins."""
import numpy as np
import pandas as pd
import pytest

from wae.features2 import comp_archetype_features, midgame_bigrams


def _blob(ally_specs, enemy_specs, casts=()):
    """ally_specs excludes the recorder (265 Affliction, unitId P)."""
    allies = [{"player": {"unitId": "P", "team": "friendly", "spec": "265"}}] + [
        {"player": {"unitId": f"A{i}", "team": "friendly", "spec": s}}
        for i, s in enumerate(ally_specs)
    ]
    enemies = [{"player": {"unitId": f"E{i}", "team": "enemy", "spec": s}}
               for i, s in enumerate(enemy_specs)]
    return {
        "playerUnitId": "P",
        "teams": [{"team": "friendly", "players": allies},
                  {"team": "enemy", "players": enemies}],
        "timeline": [{"tSec": t, "unitId": "P", "kind": "cast", "spell": s} for t, s in casts],
    }


def test_comp_archetypes():
    # allies: Holy Paladin (65, healer) + Arms Warrior (71, melee)
    # enemies: Arms (71) + Unholy DK (252) + RSham (264)
    out = comp_archetype_features(_blob(["65", "71"], ["71", "252", "264"]))
    assert out["ally_comp_archetype"] == "melee+healer"
    assert out["enemy_comp_archetype"] == "2melee+healer"
    assert out["enemy_melee_count"] == 2.0


def test_comp_archetypes_ranged_enemy():
    # enemies: Frost Mage (64) + Shadow Priest (258) + Disc (256)
    out = comp_archetype_features(_blob(["65", "62"], ["64", "258", "256"]))
    assert out["ally_comp_archetype"] == "ranged+healer"
    assert out["enemy_comp_archetype"] == "2ranged+healer"
    assert out["enemy_melee_count"] == 0.0


def test_archetypes_agree_with_healer_spec_ids():
    # two hand-maintained registries overlap on healers; this is the sync guard
    from wae.db import HEALER_SPEC_IDS
    from wae.features2 import ARCHETYPES

    assert {s for s, a in ARCHETYPES.items() if a == "healer"} == HEALER_SPEC_IDS


def test_midgame_bigrams_skips_opener_and_counts_pairs():
    casts = [(2, "Agony"), (4, "Corruption"), (10, "Haunt"),          # opener window
             (20, "Agony"), (22, "Corruption"), (25, "Agony"), (27, "Corruption")]
    c = midgame_bigrams(_blob([], [], casts))
    assert c[("Agony", "Corruption")] == 2
    assert ("Corruption", "Haunt") not in c    # nothing before 15s contributes
    assert c[("Corruption", "Agony")] == 1     # the 22->25 transition


def test_bigram_rate_columns():
    from collections import Counter
    from wae.features import add_bigram_rate_columns

    rows = [{"match_id": "1"}, {"match_id": "2"}, {"match_id": "3"}]
    counters = [Counter({("A", "B"): 4}), Counter({("A", "B"): 2}), Counter()]
    kept = add_bigram_rate_columns(rows, counters, [120.0, 60.0, 60.0], min_presence=0.5, top_k=5)
    assert kept == [("A", "B")]
    col = "midgame_per_min__A>B"
    assert rows[0][col] == pytest.approx(2.0)   # 4 casts / 2 min
    assert rows[1][col] == pytest.approx(2.0)
    assert rows[2][col] == pytest.approx(0.0)


def test_report_carries_sufficiency_and_calibration(tmp_path):
    import json
    from wae import report

    df = pd.DataFrame({"win": [1.0, 0.0] * 40, "session_id": ["s"] * 80,
                       "match_id": [str(i) for i in range(80)]})
    screen_df = pd.DataFrame([{
        "feature": "x", "tier": "process", "n": 80, "median_win": 1.0, "median_loss": 0.0,
        "rank_biserial": 0.1, "p_raw": 0.5, "p_mmr_adj": 0.5, "q_raw": 0.5, "q_mmr_adj": 0.5,
    }])
    models = [{"scope": "process", "n": 80, "n_features": 1,
               "models": {"logistic_en": {"auc_mean": 0.6, "auc_std": 0.02, "brier_mean": 0.17,
                                          "calibration": [{"pred_mean": 0.5, "obs_rate": 0.5, "n": 80}]}},
               "permutation_importance": []}]
    suff = {"n": 80, "sufficient_now": ["anchors"], "marginal": ["interactions"],
            "not_sufficient": ["sequence models"], "growth_note": "g", "coaching_ceiling": "c"}
    report.write_reports(tmp_path, "test", df, screen_df, models, [], [], [],
                         data_sufficiency=suff)
    payload = json.loads((tmp_path / "influence-test.json").read_text(encoding="utf8"))
    assert payload["data_sufficiency"]["coaching_ceiling"] == "c"
    md = (tmp_path / "influence-test.md").read_text(encoding="utf8")
    assert "Data sufficiency" in md
    assert "Calibration" in md


def test_calibration_bins_shape():
    from wae.model import calibration_bins

    rng = np.random.default_rng(3)
    prob = rng.random(400)
    y = (rng.random(400) < prob).astype(float)   # perfectly calibrated by construction
    bins = calibration_bins(prob, y, n_bins=5)
    assert len(bins) == 5
    assert sum(b["n"] for b in bins) == 400
    for b in bins:
        assert abs(b["pred_mean"] - b["obs_rate"]) < 0.12  # calibrated within bin noise
