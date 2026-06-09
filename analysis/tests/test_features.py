import numpy as np
from wae import features
from wae.db import assign_sessions


def synthetic_blob():
    """2v2: me (Aff lock) + resto druid healer vs mage + disc priest. Straight-line tracks."""
    def track(unit, x0, step):
        return {"unitId": unit, "samples": [{"tSec": t, "x": x0 + step * t, "y": 0.0} for t in range(0, 101, 2)]}
    return {
        "playerUnitId": "ME",
        "teams": [
            {"team": "friendly", "players": [
                {"player": {"unitId": "ME", "team": "friendly", "spec": "265"}},
                {"player": {"unitId": "HEAL", "team": "friendly", "spec": "105"}},
            ]},
            {"team": "enemy", "players": [
                {"player": {"unitId": "E1", "team": "enemy", "spec": "63"}},
                {"player": {"unitId": "E2", "team": "enemy", "spec": "256"}},
            ]},
        ],
        "timeline": [
            {"tSec": 5, "unitId": "ME", "targetId": "E1", "kind": "cc", "spell": "Fear"},
            {"tSec": 18, "unitId": "HEAL", "targetId": "E2", "kind": "cc", "spell": "Cyclone"},
            {"tSec": 25, "unitId": "ME", "targetId": "E1", "kind": "cc", "spell": "Fear"},
            {"tSec": 40, "unitId": "E1", "targetId": "ME", "kind": "cc", "spell": "Poly"},  # enemy cc, not ours
            {"tSec": 12, "unitId": "ME", "targetId": "E1", "kind": "interrupt", "spell": "Spell Lock"},
            {"tSec": 30, "unitId": "E1", "targetId": "ME", "kind": "interrupt", "spell": "Counterspell"},
            {"tSec": 80, "unitId": "E2", "unitName": "x", "kind": "death"},
            {"tSec": 33, "unitId": "ME", "kind": "cast", "spell": "Agony"},
            {"tSec": 34, "unitId": "ME", "kind": "cast", "spell": "Agony"},
            {"tSec": 35, "unitId": "ME", "kind": "cast", "spell": "Malefic Rapture"},
        ],
        "offensiveWindows": [
            {"attackingTeam": "enemy", "startSec": 20, "endSec": 35, "teamDamageTaken": 60000,
             "mitigation": {"available": [{"name": "a"}, {"name": "b"}]}, "attackerOffenseAvailableCount": 1},
            {"attackingTeam": "friendly", "startSec": 70, "endSec": 90, "teamDamageTaken": 90000,
             "mitigation": {"available": []}, "attackerOffenseAvailableCount": 2},
        ],
        "coordination": [
            {"team": "friendly", "summary": {"alignmentFraction": 0.8, "swaps": 4}},
            {"team": "enemy", "summary": {"alignmentFraction": 0.5, "swaps": 10}},
        ],
        # me at x=0 fixed; healer drifts away 1 yd/s => >40yd after t=40 (60% of 0..100)
        "positionTracks": [
            {"unitId": "ME", "samples": [{"tSec": t, "x": 0.0, "y": 0.0} for t in range(0, 101, 2)]},
            track("HEAL", 0, 1.0),
            track("E1", 5, 0.0),   # constant 5yd => always in melee range
            track("E2", 50, 0.0),
        ],
    }


def test_timeline_features():
    out, casts = features.timeline_features(synthetic_blob(), minutes=100 / 60)
    assert out["our_cc_on_enemy_first20s"] == 2.0    # Fear@5 + Cyclone@18; Fear@25 outside, enemy cc never
    assert out["our_cc_on_enemy_first30s"] == 3.0
    assert out["first_kick_by_us_sec"] == 12
    assert out["first_kick_on_us_sec"] == 30
    assert out["first_death_ours"] == 0.0            # enemy died first
    assert casts["Agony"] == 2 and casts["Malefic Rapture"] == 1


def test_go_window_features():
    out = features.go_window_features(synthetic_blob(), minutes=100 / 60)
    assert out["first_enemy_go_sec"] == 20
    assert out["mean_defensives_up_at_enemy_go"] == 2.0
    assert out["mean_enemy_offense_ready_at_go"] == 1.0
    assert out["mean_our_offense_ready_at_go"] == 2.0
    assert out["lethal_enemy_go_frac"] == 0.0        # only an ENEMY died, in OUR window
    assert abs(out["enemy_go_dmg_per_min"] - 60000 / (100 / 60)) < 1e-6


def test_position_features():
    out = features.position_features(synthetic_blob())
    # healer crosses 40yd at t=40 => ~60% of samples beyond heal range
    assert 0.5 < out["pct_time_beyond_heal_range"] < 0.7
    assert out["pct_time_in_enemy_melee"] == 1.0     # E1 pinned at 5yd
    assert abs(out["median_dist_nearest_enemy_yd"] - 5.0) < 1e-6


def test_comp_features():
    spec_table = {"265": {"className": "Warlock"}, "105": {"className": "Druid"},
                  "63": {"className": "Mage"}, "256": {"className": "Priest"}}
    out = features.comp_features(synthetic_blob(), spec_table)
    assert out["ally_healer_class"] == "Druid"
    assert out["enemy_healer_class"] == "Priest"
    assert out["enemy_has_Mage"] == 1.0


def test_sessions_split_on_gap():
    rows = [
        {"player_name": "A", "start_ms": 0, "duration_sec": 300},
        {"player_name": "A", "start_ms": 400_000, "duration_sec": 300},      # 100s gap -> same session
        {"player_name": "A", "start_ms": 10_000_000, "duration_sec": 300},   # huge gap -> new session
        {"player_name": "B", "start_ms": 410_000, "duration_sec": 300},      # other character -> own session
    ]
    assign_sessions(rows)
    assert rows[0]["session_id"] == rows[1]["session_id"] != rows[2]["session_id"]
    assert rows[3]["session_id"] not in (rows[0]["session_id"], rows[2]["session_id"])
    assert [r["game_in_session"] for r in rows] == [1, 2, 1, 1]


def test_spell_rate_columns_presence_gate():
    rows = [{}, {}, {}, {}]
    counters = [features.Counter({"Agony": 10}), features.Counter({"Agony": 5}),
                features.Counter({"Agony": 2, "Rare": 1}), features.Counter()]
    kept = features.add_spell_rate_columns(rows, counters, [60.0, 60.0, 60.0, 0.0], min_presence=0.5)
    assert kept == ["Agony"]                          # Rare present in 25% < 50% gate
    assert rows[0]["casts_per_min__Agony"] == 10.0
    assert rows[1]["casts_per_min__Agony"] == 5.0
    assert np.isnan(rows[3].get("casts_per_min__Agony"))  # zero-duration match -> unknown, not 0
