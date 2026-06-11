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


def test_anchor_placement_handles_tied_quantiles():
    # discrete features tie their quantiles (real pooled anchor: deaths win_q is all 0).
    # np.interp misreads ties - a ZERO-death game must NOT land at the 90th pctile of
    # wins and get flagged as loss territory.
    deaths_anchor = {"win_q": [0.0, 0.0, 0.0, 0.0, 0.0], "loss_q": [0.0, 0.25, 1.0, 1.0, 1.0],
                     "quantiles": [0.1, 0.25, 0.5, 0.75, 0.9]}
    out = anchor_placement(0.0, deaths_anchor, rank_biserial=-0.5)
    assert out["pct_in_win"] == pytest.approx(0.5)   # ties span the whole dist -> midpoint
    assert out["loss_territory"] is False
    # one death IS beyond every winning game here
    bad = anchor_placement(1.0, deaths_anchor, rank_biserial=-0.5)
    assert bad["pct_in_win"] == pytest.approx(0.95)
    assert bad["loss_territory"] is True
    # partial tie block: value sits inside the tied run, midpoint of its quantile span
    lethal = {"win_q": [0.0, 0.0, 0.0, 0.5, 1.0], "loss_q": [0.0, 0.5, 1.0, 1.0, 1.0],
              "quantiles": [0.1, 0.25, 0.5, 0.75, 0.9]}
    mid = anchor_placement(0.0, lethal, rank_biserial=-0.5)
    assert mid["pct_in_win"] == pytest.approx((0.1 + 0.5) / 2)


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


def test_vs_this_comp_placement():
    influence = {
        "anchors": ANCHORS, "screen": SCREEN, "categorical": [],
        "interactions": {"pairs": [], "gbm_h2": []},
        "anchors_by_enemy_archetype": {
            "2melee+healer": {"n": 113, "win_rate": 0.41,
                              # vs melee, winners cast LESS (turtling reads differently)
                              "anchors": {"casts_per_min": {
                                  "win_q": [10.0, 15.0, 20.0, 25.0, 30.0],
                                  "loss_q": [20.0, 25.0, 30.0, 35.0, 40.0],
                                  "quantiles": [0.1, 0.25, 0.5, 0.75, 0.9]}}},
        },
    }
    feats = {"match_id": "abc", "casts_per_min": 21.0,
             "enemy_comp_archetype": "2melee+healer"}
    blob = {"teams": [], "timeline": [], "offensiveWindows": []}
    pack = build_pack(feats, blob, influence, row={"result": "loss", "duration_sec": 200,
                                                   "player_rating": 2400})
    placed = pack["features"]["casts_per_min"]
    # global placement says 21/min is low-in-wins; the comp slice says it's mid-pack
    assert placed["loss_territory"] is True
    vs = placed["vs_this_comp"]
    assert vs["comp_n"] == 113
    assert vs["loss_territory"] is False
    assert 0.4 < vs["pct_in_win"] < 0.7

    # a different archetype (or none) -> no vs_this_comp block, never a wrong-slice one
    feats2 = {"match_id": "abc", "casts_per_min": 21.0,
              "enemy_comp_archetype": "2ranged+healer"}
    pack2 = build_pack(feats2, blob, influence, row={"result": "loss", "duration_sec": 200,
                                                     "player_rating": 2400})
    assert "vs_this_comp" not in pack2["features"]["casts_per_min"]


def test_comp_only_anchor_still_places():
    # a feature anchored ONLY in the comp slice (not in the global top-40 cut) must
    # still appear in the pack, with the comp placement and no invented global one
    influence = {
        "anchors": {}, "screen": [], "categorical": [],
        "interactions": {"pairs": [], "gbm_h2": []},
        "anchors_by_enemy_archetype": {
            "2melee+healer": {"n": 100, "win_rate": 0.5,
                              "anchors": {"pct_time_in_enemy_melee": {
                                  "win_q": [0.1, 0.2, 0.3, 0.4, 0.5],
                                  "loss_q": [0.3, 0.4, 0.5, 0.6, 0.7],
                                  "quantiles": [0.1, 0.25, 0.5, 0.75, 0.9]}}},
        },
    }
    feats = {"match_id": "abc", "pct_time_in_enemy_melee": 0.3,
             "enemy_comp_archetype": "2melee+healer"}
    pack = build_pack(feats, {"teams": [], "timeline": [], "offensiveWindows": []},
                      influence, row={"result": "win", "duration_sec": 200,
                                      "player_rating": 2400})
    entry = pack["features"]["pct_time_in_enemy_melee"]
    assert "pct_in_win" not in entry          # no global anchor -> no global placement
    assert entry["vs_this_comp"]["comp_n"] == 100
    assert entry["vs_this_comp"]["pct_in_win"] == pytest.approx(0.5)


def test_targeting_priors_picks_this_matchs_comp():
    crosstab = [
        {"variable": "enemy_comp_archetype", "level": "2melee+healer", "n": 113,
         "win_rate": 0.41, "n_loss": 60,
         "loss_first_death": {"me": 0.6, "dps_ally": 0.2, "healer_ally": 0.2, "enemy": 0.0},
         "wr_by_first_death": {"me": {"n": 40, "wr": 0.1}}},
        {"variable": "enemy_comp_archetype", "level": "melee+ranged+healer", "n": 90,
         "win_rate": 0.55, "n_loss": 40,
         "loss_first_death": {"me": 0.3, "dps_ally": 0.4, "healer_ally": 0.3, "enemy": 0.0},
         "wr_by_first_death": {}},
        {"variable": "enemy_healer_class", "level": "Paladin", "n": 200, "win_rate": 0.41,
         "n_loss": 118, "loss_first_death": {}, "wr_by_first_death": {}},
        {"variable": "enemy_has_Warrior", "level": "Warrior", "n": 150, "win_rate": 0.45,
         "n_loss": 80, "loss_first_death": {}, "wr_by_first_death": {}},
        {"variable": "enemy_has_Mage", "level": "Mage", "n": 120, "win_rate": 0.50,
         "n_loss": 60, "loss_first_death": {}, "wr_by_first_death": {}},
    ]
    influence = {"anchors": {}, "screen": [], "categorical": [],
                 "targeting_crosstab": crosstab, "interactions": {"pairs": [], "gbm_h2": []}}
    feats = {"match_id": "abc", "enemy_comp_archetype": "2melee+healer",
             "enemy_healer_class": "Paladin", "enemy_has_Warrior": 1.0, "enemy_has_Mage": 0.0}
    pack = build_pack(feats, {"teams": [], "timeline": [], "offensiveWindows": []},
                      influence, row={"result": "loss", "duration_sec": 200, "player_rating": 2400})
    got = {(r["variable"], r["level"]) for r in pack["targeting_priors"]}
    # this match's archetype + healer class + PRESENT classes; never the absent Mage
    # or the other archetype
    assert got == {("enemy_comp_archetype", "2melee+healer"),
                   ("enemy_healer_class", "Paladin"),
                   ("enemy_has_Warrior", "Warrior")}


def test_targeting_priors_absent_when_no_crosstab():
    influence = {"anchors": {}, "screen": [], "categorical": [],
                 "interactions": {"pairs": [], "gbm_h2": []}}
    pack = build_pack({"match_id": "abc"}, {"teams": [], "timeline": [], "offensiveWindows": []},
                      influence, row={"result": "win", "duration_sec": 200, "player_rating": 2400})
    assert pack["targeting_priors"] == []
