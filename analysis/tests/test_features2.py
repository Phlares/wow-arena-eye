import numpy as np
from wae import features2
from wae.categorical import categorical_screen, wilson_interval
import pandas as pd

BLOB = {
    "playerUnitId": "ME",
    "teams": [
        {"team": "friendly", "players": [
            {"player": {"unitId": "ME", "team": "friendly", "spec": "265", "name": "Me-R"}},
            {"player": {"unitId": "HEAL", "team": "friendly", "spec": "105", "name": "Healz-R"}},
        ]},
        {"team": "enemy", "players": [
            {"player": {"unitId": "E1", "team": "enemy", "spec": "253", "name": "Hunt-R"}},   # BM hunter
            {"player": {"unitId": "E2", "team": "enemy", "spec": "1468", "name": "Evo-R"}},   # pres evoker
        ]},
    ],
    "focusTracks": {"stepMs": 500, "tracks": [
        {"attacker": "ME", "team": "friendly", "ticks": ["E1", "E1", "E1", "E2", None, "E1"]},
    ]},
    "coordination": [
        {"team": "enemy", "summary": {"targetPriority": [
            {"name": "Me-R", "damageTaken": 600_000},
            {"name": "Healz-R", "damageTaken": 200_000},
            {"name": "SomePet", "damageTaken": 999_999},   # not one of our players -> ignored
        ]}},
    ],
    "timeline": [
        {"tSec": 2, "unitId": "ME", "kind": "cast", "spell": "Agony"},
        {"tSec": 4, "unitId": "ME", "kind": "cast", "spell": "Corruption"},
        {"tSec": 6, "unitId": "ME", "kind": "cast", "spell": "Unstable Affliction"},
        {"tSec": 9, "unitId": "ME", "kind": "cast", "spell": "Haunt"},
        {"tSec": 14, "unitId": "ME", "targetId": "E1", "kind": "cc", "spell": "Fear", "extra": "disorient"},
        {"tSec": 20, "unitId": "HEAL", "targetId": "E1", "kind": "cc", "spell": "Cyclone", "extra": "disorient"},  # 6s after Fear -> DR'd
        {"tSec": 50, "unitId": "ME", "targetId": "E1", "kind": "cc", "spell": "Fear", "extra": "disorient"},        # 30s later -> fresh
        {"tSec": 60, "unitId": "ME", "kind": "death"},
    ],
    "positionTracks": [
        {"unitId": "ME", "samples": [{"tSec": t, "x": 0.0, "y": 0.0} for t in range(0, 101, 2)]},
        {"unitId": "HEAL", "samples": [{"tSec": t, "x": 30.0, "y": 40.0} for t in range(0, 101, 2)]},  # 50yd away
    ],
}

GRID = {"bounds": {"minX": -50, "minY": -50, "maxX": 50, "maxY": 50},
        "cellSize": 10, "cols": 10, "rows": 10,
        "voidness": [0.9 if i == 55 else 0.1 for i in range(100)]}  # high voidness at center cell


def test_targeting_features():
    out = features2.targeting_features(BLOB, {"253": {"className": "Hunter"}, "1468": {"className": "Evoker"}})
    assert out["my_main_target_class"] == "Hunter"
    assert abs(out["my_time_on_main_target_frac"] - 4 / 5) < 1e-9   # 4 of 5 non-null ticks
    assert out["my_main_target_is_healer"] == 0.0
    assert abs(out["my_time_on_enemy_healer_frac"] - 1 / 5) < 1e-9  # E2 is the healer spec


def test_enemy_pressure_features():
    out = features2.enemy_pressure_features(BLOB)
    assert abs(out["enemy_dmg_share_on_me"] - 0.75) < 1e-9          # 600k of 800k on players
    assert abs(out["enemy_dmg_share_on_our_healer"] - 0.25) < 1e-9
    assert abs(out["enemy_dmg_concentration"] - (0.75**2 + 0.25**2)) < 1e-9


def test_opener_features():
    out = features2.opener_features(BLOB)
    assert out["opener_pattern"] == "Agony > Corruption > Unstable Affliction"
    assert out["dots_cast_first10s"] == 4.0      # all four are DoT-ramp spells
    assert out["time_to_first_haunt_sec"] == 9
    assert out["my_first_cc_sec"] == 14.0


def test_dr_cc_features():
    out = features2.dr_cc_features(BLOB, minutes=100 / 60)
    # 3 friendly cc casts on enemies; Cyclone@20 is within 18s of Fear@14 on same target+category
    assert abs(out["our_cc_casts_per_min"] - 3 / (100 / 60)) < 1e-9
    assert abs(out["our_drd_cc_per_min"] - 1 / (100 / 60)) < 1e-9
    assert abs(out["our_drd_cc_frac"] - 1 / 3) < 1e-9


def test_death_context_and_voidness():
    assert features2.voidness_at(GRID, 5, 5) == 0.9                 # center cell (row5,col5)
    assert features2.voidness_at(GRID, -45, -45) == 0.1
    assert features2.voidness_at(GRID, 999, 0) == 0.0               # out of bounds
    out, atlas = features2.death_context(BLOB, GRID)
    assert out["my_death_voidness"] == 0.9                          # I die at (0,0) = center
    assert out["my_death_dist_to_healer_yd"] == 50.0                # 30-40-50 triangle
    assert len(atlas) == 1 and atlas[0]["tSec"] == 60


def test_categorical_screen():
    rng = np.random.default_rng(1)
    n = 300
    maps = rng.choice(["A", "B"], n)
    # map B is a 70% win-rate map, A is 40%
    win = np.where(maps == "B", rng.random(n) < 0.7, rng.random(n) < 0.4).astype(float)
    df = pd.DataFrame({"win": win, "map_name": maps})
    out = categorical_screen(df, ["map_name"])
    b = out[out.level == "B"].iloc[0]
    assert b.win_rate > 0.6 and b.q < 0.05
    lo, hi = wilson_interval(70, 100)
    assert lo < 0.7 < hi and hi - lo < 0.2
