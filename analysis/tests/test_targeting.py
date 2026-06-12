"""Targeting cross-tab: who dies first under which enemy comp, and at what win rate.
Descriptive priors (Wilson CI on win rates) - deliberately no FDR family; these feed
the coach pack's targeting_priors, they are not discovery claims."""
import numpy as np
import pandas as pd

from wae.targeting import first_death_crosstab


def _df():
    # 20 matches vs 2melee+healer: 5 wins, 15 losses; of the losses, I die first in 9,
    # dps in 3, healer in 3. 4 matches vs melee+ranged+healer (below the n gate).
    rows = []
    for i in range(5):
        rows.append({"win": 1.0, "first_death_role": "enemy",
                     "enemy_comp_archetype": "2melee+healer", "enemy_healer_class": "Paladin",
                     "enemy_has_Warrior": 1.0})
    for role, k in (("me", 9), ("dps_ally", 3), ("healer_ally", 3)):
        for i in range(k):
            rows.append({"win": 0.0, "first_death_role": role,
                         "enemy_comp_archetype": "2melee+healer", "enemy_healer_class": "Paladin",
                         "enemy_has_Warrior": 1.0})
    for i in range(4):
        rows.append({"win": 1.0, "first_death_role": "enemy",
                     "enemy_comp_archetype": "melee+ranged+healer", "enemy_healer_class": "Paladin",
                     "enemy_has_Warrior": 0.0})
    return pd.DataFrame(rows)


def _row(out, variable, level):
    return next(r for r in out if r["variable"] == variable and r["level"] == level)


def test_crosstab_loss_shares_and_win_rates():
    out = first_death_crosstab(_df(), min_level_n=15)
    r = _row(out, "enemy_comp_archetype", "2melee+healer")
    assert r["n"] == 20 and r["n_loss"] == 15
    assert r["win_rate"] == 0.25
    assert r["ci_lo"] < 0.25 < r["ci_hi"]
    assert r["loss_first_death"]["me"] == 0.6          # 9 of 15 losses
    assert r["loss_first_death"]["dps_ally"] == 0.2
    assert r["loss_first_death"]["healer_ally"] == 0.2
    assert r["loss_first_death"]["enemy"] == 0.0       # no loss where we got first kill
    # when I die first we never won; when the enemy lost a player first we always did
    assert r["wr_by_first_death"]["me"] == {"n": 9, "wr": 0.0}
    assert r["wr_by_first_death"]["enemy"] == {"n": 5, "wr": 1.0}


def test_crosstab_gates_small_levels():
    out = first_death_crosstab(_df(), min_level_n=15)
    assert not any(r["level"] == "melee+ranged+healer" for r in out)
    # but a lower gate lets it through
    out_lo = first_death_crosstab(_df(), min_level_n=3)
    assert _row(out_lo, "enemy_comp_archetype", "melee+ranged+healer")["n"] == 4


def test_crosstab_class_presence_flags():
    out = first_death_crosstab(_df(), min_level_n=15)
    r = _row(out, "enemy_has_Warrior", "Warrior")
    assert r["n"] == 20                                # only the flag==1 rows
    assert r["loss_first_death"]["me"] == 0.6


def test_crosstab_ignores_unknown_roles():
    df = _df()
    df.loc[df.index[:3], "first_death_role"] = np.nan  # 3 wins lose their role
    out = first_death_crosstab(df, min_level_n=15)
    r = _row(out, "enemy_comp_archetype", "2melee+healer")
    assert r["n"] == 20                                # slice size unchanged
    assert r["wr_by_first_death"]["enemy"]["n"] == 2   # role-known rows only


def test_crosstab_n_loss_counts_all_losses():
    # a loss with no recorded death (role unknown) still counts as a loss: n_loss stays
    # consistent with n/win_rate, and the unknown loss is in every share's denominator
    df = _df()
    me_loss = df[(df["win"] == 0.0) & (df["first_death_role"] == "me")].index[0]
    df.loc[me_loss, "first_death_role"] = np.nan
    r = _row(first_death_crosstab(df, min_level_n=15), "enemy_comp_archetype", "2melee+healer")
    assert r["n_loss"] == 15                           # all losses, not role-known losses
    assert r["loss_first_death"]["me"] == round(8 / 15, 3)


def test_crosstab_keeps_real_none_healer_level():
    # 'none' enemy_healer_class is a REAL level (double-DPS comps), not folded NaN
    df = _df()
    rows = [{"win": float(i % 2), "first_death_role": "enemy" if i % 2 else "me",
             "enemy_comp_archetype": "2melee", "enemy_healer_class": "none",
             "enemy_has_Warrior": 0.0} for i in range(16)]
    df = pd.concat([df, pd.DataFrame(rows)], ignore_index=True)
    out = first_death_crosstab(df, min_level_n=15)
    assert _row(out, "enemy_healer_class", "none")["n"] == 16
