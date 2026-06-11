"""Categorical win-rate screening: per level of a categorical column, win rate with a
Wilson interval and a Fisher exact test (level vs rest), BH-FDR across every level of
every screened column (one family - honest about how many cells were looked at)."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats

from .screen import bh_qvalues

MIN_LEVEL_N = 15


def iter_levels(df: pd.DataFrame, col: str, min_n: int, skip_none: bool = False):
    """(level, sub-frame) pairs of a categorical column - NaN folded into 'none', levels
    under min_n dropped. The one slicing idiom shared by the categorical screen, the
    targeting cross-tab, and the comp-conditioned anchors."""
    if col not in df.columns:
        return
    values = df[col].fillna("none").astype(str)
    for level, sub in df.groupby(values):
        if len(sub) >= min_n and not (skip_none and level == "none"):
            yield level, sub


def wilson_interval(wins: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = wins / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


def categorical_screen(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    """One row per (column, level): n, win rate + Wilson CI, Fisher exact vs the rest,
    BH q over all rows screened here."""
    y = df["win"].to_numpy()
    total_w, total_n = int(y.sum()), len(y)
    rows = []
    for col in columns:
        for level, sub in iter_levels(df, col, MIN_LEVEL_N):
            n = len(sub)
            w = int(sub["win"].sum())
            lo, hi = wilson_interval(w, n)
            table = [[w, n - w], [total_w - w, (total_n - n) - (total_w - w)]]
            p = float(stats.fisher_exact(table).pvalue)
            rows.append({
                "variable": col, "level": level, "n": n,
                "win_rate": round(w / n, 3), "ci_lo": round(lo, 3), "ci_hi": round(hi, 3),
                "baseline": round(total_w / total_n, 3), "p_fisher": p,
            })
    out = pd.DataFrame(rows)
    if not out.empty:
        out["q"] = bh_qvalues(out["p_fisher"].to_numpy())
        out = out.sort_values("p_fisher").reset_index(drop=True)
    return out
