"""Multivariate models with session-grouped CV + held-out permutation importance.

Two model scopes per run:
  full         - all tiers (the predictive ceiling; outcome features dominate it)
  process-only - process + context tiers (the coachable model the user cares about)
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

CATEGORICAL = ["map_id", "character", "ally_healer_class", "enemy_healer_class", "my_main_target_class"]
# string columns screened categorically (win-rate + Fisher) but kept OUT of the models
# (opener_pattern cardinality would just become noise one-hots)
NON_MODEL_STRINGS = ["opener_pattern", "map_name"]
N_SPLITS = 5
PERM_REPEATS = 8
RNG = 7


def _pipelines(numeric: list[str], categorical: list[str]) -> dict[str, Pipeline]:
    pre = ColumnTransformer([
        ("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]), numeric),
        ("cat", OneHotEncoder(handle_unknown="ignore", min_frequency=10), categorical),
    ])
    return {
        "logistic_en": Pipeline([
            ("pre", pre),
            ("clf", LogisticRegression(solver="saga", l1_ratio=0.5,
                                       C=0.1, max_iter=8000, random_state=RNG)),
        ]),
        "gbm": Pipeline([
            ("pre", pre),
            ("clf", HistGradientBoostingClassifier(max_depth=3, learning_rate=0.06,
                                                   max_iter=250, l2_regularization=1.0,
                                                   random_state=RNG)),
        ]),
    }


def run_models(df: pd.DataFrame, feature_cols: list[str], tiers: dict[str, str],
               scope: str) -> dict:
    """CV one scope ('full' | 'process'). Returns AUC/Brier per model + permutation
    importance (held-out folds only, GBM) aggregated as mean +/- std."""
    keep_tiers = {"process", "context"} if scope == "process" else {"process", "context", "outcome"}
    numeric = [c for c in feature_cols
               if tiers.get(c, "process") in keep_tiers and c not in CATEGORICAL and c not in NON_MODEL_STRINGS]
    categorical = [c for c in CATEGORICAL if c in df.columns and tiers.get(c, "context") in keep_tiers]
    X = df[numeric + categorical]
    y = df["win"].to_numpy()
    groups = df["session_id"].to_numpy()

    cv = StratifiedGroupKFold(n_splits=N_SPLITS, shuffle=True, random_state=RNG)
    results: dict = {"scope": scope, "n": len(df), "n_features": len(numeric) + len(categorical), "models": {}}
    imp_acc: dict[str, list[float]] = {}

    for name, pipe in _pipelines(numeric, categorical).items():
        aucs, briers = [], []
        for train, test in cv.split(X, y, groups):
            pipe.fit(X.iloc[train], y[train])
            prob = pipe.predict_proba(X.iloc[test])[:, 1]
            aucs.append(roc_auc_score(y[test], prob))
            briers.append(brier_score_loss(y[test], prob))
            if name == "gbm":
                pi = permutation_importance(pipe, X.iloc[test], y[test], scoring="roc_auc",
                                            n_repeats=PERM_REPEATS, random_state=RNG)
                for col, imp in zip(X.columns, pi.importances_mean):
                    imp_acc.setdefault(col, []).append(float(imp))
        results["models"][name] = {
            "auc_mean": float(np.mean(aucs)), "auc_std": float(np.std(aucs)),
            "brier_mean": float(np.mean(briers)),
        }

    results["permutation_importance"] = sorted(
        ({"feature": c, "tier": tiers.get(c, "context" if c in CATEGORICAL else "process"),
          "importance_mean": float(np.mean(v)), "importance_std": float(np.std(v))}
         for c, v in imp_acc.items()),
        key=lambda r: r["importance_mean"], reverse=True,
    )
    return results


def correlation_clusters(df: pd.DataFrame, feature_cols: list[str], threshold: float = 0.7) -> list[list[str]]:
    """Greedy clusters of |Spearman rho| > threshold - correlated features split
    permutation importance, so the report shows them together."""
    numeric = [c for c in feature_cols if c not in CATEGORICAL]
    sub = df[numeric].apply(pd.to_numeric, errors="coerce")
    keep = [c for c in numeric if sub[c].notna().sum() >= 30 and sub[c].std() > 0]
    if len(keep) < 2:
        return []
    corr = sub[keep].corr(method="spearman").abs()
    clusters, used = [], set()
    for col in keep:
        if col in used:
            continue
        members = [c for c in keep if c not in used and corr.loc[col, c] > threshold]
        if len(members) > 1:
            clusters.append(members)
            used.update(members)
    return clusters
