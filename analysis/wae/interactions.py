"""A.1 interaction mining - "this metric AND this metric together".

Explicit screen: per feature pair, LR-test the A*B term in logit(win ~ MMR + A + B + A*B)
(deviance difference ~ chi2(1)), BH-FDR over every pair conducted, and a 2x2 median-split
win-rate table per pair for the readable form ("high A AND low B -> 71% WR").

Model side: Friedman's H^2 statistic (Friedman & Popescu 2008, eq. 44) over the top GBM
features via partial dependence - which pairs the model actually uses jointly. Chosen over
SHAP interaction values: no new dependency, and TreeExplainer interaction support for
sklearn's HistGradientBoosting is unreliable.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import partial_dependence

from .model import GBM_PARAMS, RNG
from .screen import bh_qvalues, lr_test_p

MIN_N = 60          # a pair needs this many complete rows to be testable
H_TOP_K = 10        # GBM pairs screened = C(H_TOP_K, 2)
H_GRID = 16         # partial-dependence grid resolution per axis

KITING_METRICS = ("distanceMoved_per_min", "timeStationarySec_per_min",
                  "pct_time_in_enemy_melee", "median_dist_nearest_enemy_yd",
                  "center_dist_frac_mean", "edge_proximity_frac", "map_area_coverage_frac")


def lr_interaction_p(y: np.ndarray, mmr: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    """p-value for the A*B term on top of logit(y ~ mmr + A + B). NaN-complete rows only;
    NaN when the pair is untestable (too few rows, degenerate variance, one-class y)."""
    mask = ~(np.isnan(a) | np.isnan(b) | np.isnan(mmr) | np.isnan(y))
    if mask.sum() < MIN_N:
        return float("nan")
    aa, bb, mm, yy = a[mask], b[mask], mmr[mask], y[mask]
    if np.std(aa) == 0 or np.std(bb) == 0 or len(np.unique(yy)) < 2:
        return float("nan")
    aa = (aa - aa.mean()) / aa.std()
    bb = (bb - bb.mean()) / bb.std()
    mm = (mm - mm.mean()) / (mm.std() or 1)
    base = np.column_stack([mm, aa, bb])
    return lr_test_p(base, np.column_stack([base, aa * bb]), yy)


def median_2x2(y: np.ndarray, a: np.ndarray, b: np.ndarray) -> dict:
    """Win rate + n in the four median-split cells: keys lo_lo, lo_hi, hi_lo, hi_hi
    (a-side first). Binary 0/1 features split naturally (median in (0,1])."""
    hi_a = a > np.nanmedian(a)
    hi_b = b > np.nanmedian(b)
    cells = {}
    for ka, ma in (("lo", ~hi_a), ("hi", hi_a)):
        for kb, mb in (("lo", ~hi_b), ("hi", hi_b)):
            m = ma & mb
            cells[f"{ka}_{kb}"] = {"n": int(m.sum()),
                                   "wr": float(y[m].mean()) if m.any() else None}
    return cells


def pair_screen(df: pd.DataFrame, pairs: list[tuple[str, str]]) -> pd.DataFrame:
    """LR-test every pair; one BH family over all tests CONDUCTED (NaN p excluded from
    rows but penalized in the correction, mirroring screen.py)."""
    y = pd.to_numeric(df["win"], errors="coerce").to_numpy(dtype=float)
    mmr = pd.to_numeric(df["mmr"], errors="coerce").to_numpy(dtype=float)
    rows = []
    n_conducted = 0
    for fa, fb in pairs:
        a = pd.to_numeric(df[fa], errors="coerce").to_numpy(dtype=float)
        b = pd.to_numeric(df[fb], errors="coerce").to_numpy(dtype=float)
        n_conducted += 1
        p = lr_interaction_p(y, mmr, a, b)
        if np.isnan(p):
            continue
        mask = ~(np.isnan(a) | np.isnan(b) | np.isnan(y))
        rows.append({"feature_a": fa, "feature_b": fb, "n": int(mask.sum()), "p": p,
                     "cells": median_2x2(y[mask], a[mask], b[mask])})
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out["q"] = bh_qvalues(out["p"].to_numpy(), n_tests=n_conducted)
    return out.sort_values("p").reset_index(drop=True)


def candidate_pairs(df: pd.DataFrame, screen_df: pd.DataFrame, top_k: int = 25,
                    min_group_n: int = 80) -> tuple[list[tuple[str, str]], pd.DataFrame]:
    """The pair list: top-K process features all-pairs, plus the user-named candidates
    (duration x character, MMR-band x top-K, map x kiting, enemy-healer x kill-target).
    Categorical sides become 0/1 indicator columns added to a COPY of df (returned)."""
    d = df.copy()
    top = [f for f in screen_df[screen_df["tier"] == "process"]["feature"]
           if f in d.columns][:top_k]
    pairs = [(top[i], top[j]) for i in range(len(top)) for j in range(i + 1, len(top))]

    mmr = pd.to_numeric(d["mmr"], errors="coerce")
    d["mmr_band_hi"] = (mmr > mmr.median()).astype(float)
    pairs += [("mmr_band_hi", f) for f in top]

    if d["character"].nunique() > 1:
        d["is_main_character"] = (d["character"] == d["character"].mode()[0]).astype(float)
        pairs.append(("is_main_character", "duration_sec"))

    if "map_name" in d.columns:
        for m, n in d["map_name"].value_counts().items():
            if n < min_group_n:
                continue
            col = f"map_is__{m.replace(' ', '_')}"
            d[col] = (d["map_name"] == m).astype(float)
            pairs += [(col, k) for k in KITING_METRICS if k in d.columns]

    if "enemy_healer_class" in d.columns and "my_main_target_is_healer" in d.columns:
        for cls, n in d["enemy_healer_class"].value_counts().items():
            if n < min_group_n or cls == "none":
                continue
            col = f"enemy_healer_is__{cls.replace(' ', '_')}"
            d[col] = (d["enemy_healer_class"] == cls).astype(float)
            pairs.append((col, "my_main_target_is_healer"))

    # dedup, keep order
    seen, uniq = set(), []
    for p in pairs:
        key = tuple(sorted(p))
        if key not in seen and p[0] != p[1]:
            seen.add(key)
            uniq.append(p)
    return uniq, d


def friedman_h(df: pd.DataFrame, features: list[str], y: np.ndarray) -> pd.DataFrame:
    """Friedman's H^2 per feature pair on a GBM fit to `features`: the fraction of the
    joint partial dependence's variance not explained by the two univariate PDs.
    H^2 = sum((PD_jk - PD_j - PD_k)^2) / sum(PD_jk^2), all PDs centered."""
    # float throughout: a NaN-free count column would otherwise stay int64, which
    # partial_dependence rejects outright
    X = df[features].apply(pd.to_numeric, errors="coerce").astype(float)
    X = X.fillna(X.median())
    gbm = HistGradientBoostingClassifier(**GBM_PARAMS, random_state=RNG).fit(X, y)

    def centered_pd(idx: tuple[int, ...]) -> np.ndarray:
        pd_ = partial_dependence(gbm, X, [idx], grid_resolution=H_GRID, kind="average")
        avg = pd_["average"][0]
        return avg - avg.mean()

    uni = {i: centered_pd((i,)) for i in range(len(features))}
    rows = []
    for i in range(len(features)):
        for j in range(i + 1, len(features)):
            joint = centered_pd((i, j))
            additive = uni[i][:, None] + uni[j][None, :]
            if joint.shape != additive.shape:
                continue  # per-feature grids should agree between calls; if not, skip honestly
            denom = float((joint ** 2).sum())
            h2 = float(((joint - additive) ** 2).sum() / denom) if denom > 0 else 0.0
            rows.append({"feature_a": features[i], "feature_b": features[j], "h2": round(h2, 4)})
    return pd.DataFrame(rows).sort_values("h2", ascending=False).reset_index(drop=True)
