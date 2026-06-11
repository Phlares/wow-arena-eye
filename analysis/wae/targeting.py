"""Targeting cross-tab: first_death_role profiled by enemy comp (archetype, healer
class, class presence). Descriptive matchup priors - Wilson CI on win rates, no FDR
family (these contextualize, they don't discover). Feeds influence.json
`targeting_crosstab` and the coach pack's `targeting_priors`."""
from __future__ import annotations

import pandas as pd

from .categorical import MIN_LEVEL_N, iter_levels, wilson_interval

ROLES = ("me", "dps_ally", "healer_ally", "enemy")
CROSSTAB_VARS = ("enemy_comp_archetype", "enemy_healer_class")


def _slice_row(variable: str, level: str, sub: pd.DataFrame) -> dict:
    """One cross-tab record for a (variable, level) slice of the match frame."""
    y = sub["win"].to_numpy()
    w, n = int(y.sum()), len(y)
    lo, hi = wilson_interval(w, n)
    roled = sub[sub["first_death_role"].isin(ROLES)]
    losses = roled[roled["win"] == 0.0]
    return {
        "variable": variable, "level": level, "n": n,
        "win_rate": round(w / n, 3), "ci_lo": round(lo, 3), "ci_hi": round(hi, 3),
        "n_loss": len(losses),
        "loss_first_death": {
            r: round(float((losses["first_death_role"] == r).mean()), 3)
            for r in ROLES} if len(losses) else {},
        "wr_by_first_death": {
            r: {"n": int(m.sum()), "wr": round(float(roled.loc[m, "win"].mean()), 3)}
            for r in ROLES
            if (m := roled["first_death_role"] == r).any()},
    }


def first_death_crosstab(df: pd.DataFrame, min_level_n: int = MIN_LEVEL_N) -> list[dict]:
    """Per (conditioning variable, level): n, win rate + Wilson CI, the first-death-role
    distribution among LOSSES, and the win rate conditioned on each first-death role.
    Conditioning variables: enemy_comp_archetype / enemy_healer_class levels, plus each
    enemy_has_<Class> presence flag (level = the class name)."""
    if "first_death_role" not in df.columns:
        return []
    rows = []
    for var in CROSSTAB_VARS:
        rows += [_slice_row(var, level, sub)
                 for level, sub in iter_levels(df, var, min_level_n, skip_none=True)]
    for col in sorted(c for c in df.columns if c.startswith("enemy_has_")):
        sub = df[df[col] == 1.0]
        if len(sub) >= min_level_n:
            rows.append(_slice_row(col, col.removeprefix("enemy_has_"), sub))
    return sorted(rows, key=lambda r: -r["n"])


def rows_for_match(crosstab: list[dict], feats: dict) -> list[dict]:
    """The cross-tab rows describing ONE match's enemy comp: the exact archetype +
    healer-class levels, plus every class actually present (enemy_has_* == 1). Lives
    here so the matching convention stays next to the row constructor; same never-invent
    rule as coach.matchup_priors - no row, no prior."""
    def relevant(rec: dict) -> bool:
        var = rec.get("variable", "")
        if var.startswith("enemy_has_"):
            return feats.get(var) == 1.0
        return feats.get(var) == rec.get("level")
    return [rec for rec in crosstab if relevant(rec)]
