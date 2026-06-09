"""Univariate screening: every numeric feature vs win/loss, with effect sizes,
MMR-adjusted p-values, and Benjamini-Hochberg FDR across the whole screen."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss


def bh_qvalues(pvals: np.ndarray) -> np.ndarray:
    """Benjamini-Hochberg q-values (monotone step-up)."""
    p = np.asarray(pvals, dtype=float)
    n = len(p)
    order = np.argsort(p)
    ranked = p[order] * n / (np.arange(n) + 1)
    # enforce monotonicity from the largest rank down
    ranked = np.minimum.accumulate(ranked[::-1])[::-1]
    q = np.empty(n)
    q[order] = np.clip(ranked, 0, 1)
    return q


def rank_biserial(wins: np.ndarray, losses: np.ndarray) -> float:
    """Rank-biserial correlation from the Mann-Whitney U (positive = higher in wins)."""
    if len(wins) == 0 or len(losses) == 0:
        return float("nan")
    u = stats.mannwhitneyu(wins, losses, alternative="two-sided").statistic
    return float(2 * u / (len(wins) * len(losses)) - 1)


def mmr_adjusted_p(feature: np.ndarray, mmr: np.ndarray, y: np.ndarray) -> float:
    """Likelihood-ratio test for the feature on top of MMR: logit(y ~ mmr) vs
    logit(y ~ mmr + feature). Deviance difference ~ chi2(1)."""
    mask = ~(np.isnan(feature) | np.isnan(mmr))
    if mask.sum() < 30 or len(np.unique(y[mask])) < 2:
        return float("nan")
    f, m, yy = feature[mask], mmr[mask], y[mask]
    if np.nanstd(f) == 0:
        return float("nan")
    f = (f - f.mean()) / (f.std() or 1)
    m = (m - m.mean()) / (m.std() or 1)
    base = LogisticRegression(C=np.inf, max_iter=1000).fit(m.reshape(-1, 1), yy)
    full = LogisticRegression(C=np.inf, max_iter=1000).fit(np.column_stack([m, f]), yy)
    ll_base = -log_loss(yy, base.predict_proba(m.reshape(-1, 1))[:, 1], normalize=False)
    ll_full = -log_loss(yy, full.predict_proba(np.column_stack([m, f]))[:, 1], normalize=False)
    lr = max(0.0, 2 * (ll_full - ll_base))
    return float(stats.chi2.sf(lr, df=1))


def screen(df: pd.DataFrame, feature_cols: list[str], tiers: dict[str, str]) -> pd.DataFrame:
    """One row per feature: coverage, win/loss medians, MW p, rank-biserial,
    MMR-adjusted p, and BH q-values over BOTH p-value families."""
    y = df["win"].to_numpy()
    mmr = pd.to_numeric(df["mmr"], errors="coerce").to_numpy(dtype=float)
    rows = []
    for col in feature_cols:
        v = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float)
        mask = ~np.isnan(v)
        wins, losses = v[mask & (y == 1)], v[mask & (y == 0)]
        if len(wins) < 15 or len(losses) < 15 or np.nanstd(v) == 0:
            continue
        p_mw = float(stats.mannwhitneyu(wins, losses, alternative="two-sided").pvalue)
        rows.append({
            "feature": col,
            "tier": tiers.get(col, "process"),
            "n": int(mask.sum()),
            "median_win": float(np.median(wins)),
            "median_loss": float(np.median(losses)),
            "rank_biserial": rank_biserial(wins, losses),
            "p_raw": p_mw,
            "p_mmr_adj": mmr_adjusted_p(v, mmr, y),
        })
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out["q_raw"] = bh_qvalues(out["p_raw"].to_numpy())
    adj = out["p_mmr_adj"].to_numpy(dtype=float)
    finite = ~np.isnan(adj)
    q_adj = np.full(len(out), np.nan)
    if finite.sum():
        q_adj[finite] = bh_qvalues(adj[finite])
    out["q_mmr_adj"] = q_adj
    return out.sort_values("p_raw").reset_index(drop=True)
