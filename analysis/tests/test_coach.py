"""C: coach context pack - deterministic, no LLM. Percentile placement against the
win/loss anchors + matchup priors + GO summary, assembled into one JSON the agent
layer consumes."""
import pytest

from wae.coach import anchor_placement, build_pack, matchup_priors


ANCHORS = {
    "casts_per_min": {"win_q": [20.0, 25.0, 30.0, 35.0, 40.0],
                      "loss_q": [15.0, 20.0, 25.0, 30.0, 35.0],
                      "quantiles": [0.1, 0.25, 0.5, 0.75, 0.9]},
}
SCREEN = [{"feature": "casts_per_min", "tier": "process", "rank_biserial": 0.3,
           "q_raw": 0.01, "q_mmr_adj": 0.02, "median_win": 30.0, "median_loss": 25.0,
           "transseasonal": True}]


def test_anchor_placement_flags_loss_territory():
    # winners cast more (rb +0.3); my 21 casts/min sits at the win-dist's ~12th pctile
    out = anchor_placement(21.0, ANCHORS["casts_per_min"], rank_biserial=0.3)
    assert out["pct_in_win"] < 0.2
    assert out["loss_territory"] is True
    # a healthy value is not flagged
    ok = anchor_placement(34.0, ANCHORS["casts_per_min"], rank_biserial=0.3)
    assert ok["loss_territory"] is False


def test_anchor_placement_respects_direction():
    # for a higher-in-LOSSES feature (rb negative), a HIGH value is loss territory
    out = anchor_placement(39.0, ANCHORS["casts_per_min"], rank_biserial=-0.3)
    assert out["loss_territory"] is True


def test_matchup_priors_picks_this_matchs_levels():
    cat = [
        {"variable": "enemy_healer_class", "level": "Paladin", "n": 200, "win_rate": 0.41,
         "ci_lo": 0.34, "ci_hi": 0.48, "baseline": 0.52, "q": 0.05},
        {"variable": "enemy_healer_class", "level": "Shaman", "n": 150, "win_rate": 0.60,
         "ci_lo": 0.52, "ci_hi": 0.67, "baseline": 0.52, "q": 0.20},
        {"variable": "map_name", "level": "Hook Point", "n": 120, "win_rate": 0.55,
         "ci_lo": 0.46, "ci_hi": 0.63, "baseline": 0.52, "q": 0.80},
    ]
    pri = matchup_priors(cat, {"enemy_healer_class": "Paladin", "map_name": "Hook Point",
                               "my_main_target_class": "Priest"})
    assert pri["enemy_healer_class"]["win_rate"] == 0.41
    assert pri["map_name"]["level"] == "Hook Point"
    assert "my_main_target_class" not in pri   # no row for Priest -> omitted, never invented


def test_build_pack_shape():
    influence = {
        "label": "pooled-3v3", "n_matches": 881, "win_rate": 0.526,
        "anchors": ANCHORS, "screen": SCREEN, "categorical": [],
        "death_atlas_summary": [{"map": "Hook Point", "deaths": 30, "mean_voidness": 0.4,
                                 "mean_healer_dist_yd": 25.0, "pct_beyond_heal_range": 0.2}],
        "caveats": ["correlation is not causation"],
        "data_sufficiency": {"coaching_ceiling": "descriptive-contextual"},
        "interactions": {"pairs": [], "gbm_h2": []},
    }
    feats = {"match_id": "abc123", "win": 1.0, "casts_per_min": 21.0,
             "enemy_healer_class": "Paladin", "map_name": "Hook Point"}
    blob = {"offensiveWindows": [
        {"attackingTeam": "enemy", "startSec": 30, "endSec": 45, "teamDamageTaken": 90000,
         "mitigation": {"available": ["Unending Resolve"]}},
        {"attackingTeam": "friendly", "startSec": 60, "endSec": 75, "teamDamageTaken": 0},
    ], "timeline": [{"kind": "death", "tSec": 44, "unitId": "P"}],
        "playerUnitId": "P",
        "teams": [{"team": "friendly",
                   "players": [{"player": {"unitId": "P", "team": "friendly", "spec": "265"}}]}]}
    pack = build_pack(feats, blob, influence, row={"result": "win", "duration_sec": 240,
                                                   "player_rating": 2400})
    assert pack["match"]["match_id"] == "abc123"
    assert pack["match"]["result"] == "win"
    placed = pack["features"]["casts_per_min"]
    assert placed["value"] == 21.0
    assert placed["loss_territory"] is True
    assert placed["transseasonal"] is True
    assert pack["go_summary"]["enemy_go_count"] == 1
    assert pack["go_summary"]["our_go_count"] == 1
    assert pack["go_summary"]["lethal_enemy_gos"] == 1   # my death at 44s inside 30-45
    assert pack["history"]["n_matches"] == 881
    assert pack["caveats"]
    assert pack["top_correlates"][0]["feature"] == "casts_per_min"
