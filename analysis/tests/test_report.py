"""Comp-conditioned anchors: per enemy_comp_archetype slice, win/loss quantile anchors
for the comp-sensitive features (positional metrics whose meaning flips with the enemy
comp - melee uptime vs a melee comp is not melee uptime vs casters)."""
import numpy as np
import pandas as pd

from wae.report import COMP_SENSITIVE_FEATURES, anchors_by_archetype


def _df():
    rng = np.random.default_rng(7)
    rows = []
    # 60 vs 2melee+healer, 30W/30L - enough for per-feature anchors (>=15 each side)
    for i in range(60):
        rows.append({"win": 1.0 if i < 30 else 0.0, "enemy_comp_archetype": "2melee+healer",
                     "pct_time_in_enemy_melee": (0.2 if i < 30 else 0.6) + rng.uniform(0, 0.1)})
    # 55 vs melee+2ranged but only 10 losses - slice passes min_n, anchors gate empties it
    for i in range(55):
        rows.append({"win": 1.0 if i < 45 else 0.0, "enemy_comp_archetype": "melee+2ranged",
                     "pct_time_in_enemy_melee": rng.uniform(0, 1)})
    # 20 vs 2ranged+healer - below the slice gate entirely
    for i in range(20):
        rows.append({"win": 0.5 > rng.uniform(0, 1), "enemy_comp_archetype": "2ranged+healer",
                     "pct_time_in_enemy_melee": rng.uniform(0, 1)})
    return pd.DataFrame(rows)


def test_pct_time_in_enemy_melee_is_comp_sensitive():
    assert "pct_time_in_enemy_melee" in COMP_SENSITIVE_FEATURES


def test_anchors_by_archetype_slices_and_gates():
    out = anchors_by_archetype(_df(), min_n=50)
    assert set(out) == {"2melee+healer"}        # 2ranged+healer under min_n;
                                                # melee+2ranged emptied by the 15/15 gate
    block = out["2melee+healer"]
    assert block["n"] == 60
    assert block["win_rate"] == 0.5
    anchor = block["anchors"]["pct_time_in_enemy_melee"]
    # winners kept melee uptime low IN THIS SLICE - the win dist sits below the loss
    # dist, and the slice carries its OWN direction for the coach's placement
    assert anchor["win_q"][2] < anchor["loss_q"][2]
    assert anchor["rank_biserial"] < -0.5


def test_anchors_by_archetype_without_column():
    out = anchors_by_archetype(pd.DataFrame({"win": [1.0, 0.0]}), min_n=1)
    assert out == {}
