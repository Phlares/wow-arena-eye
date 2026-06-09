"""Emit the influence report: a human markdown + a machine JSON ('data anchors') the
future AI coach consumes to place a live match against history."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ANCHOR_QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9]


def anchors_for(df: pd.DataFrame, features: list[str]) -> dict:
    """Per-feature win/loss distribution quantiles - the coach's context anchors."""
    out = {}
    y = df["win"].to_numpy()
    for col in features:
        v = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float)
        win, loss = v[(y == 1) & ~np.isnan(v)], v[(y == 0) & ~np.isnan(v)]
        if len(win) < 15 or len(loss) < 15:
            continue
        out[col] = {
            "win_q": [round(float(q), 3) for q in np.quantile(win, ANCHOR_QUANTILES)],
            "loss_q": [round(float(q), 3) for q in np.quantile(loss, ANCHOR_QUANTILES)],
            "quantiles": ANCHOR_QUANTILES,
        }
    return out


def _fmt_row(r: pd.Series) -> str:
    direction = "higher in WINS" if r["rank_biserial"] > 0 else "higher in LOSSES"
    return (f"| {r['feature']} | {direction} | {r['rank_biserial']:+.2f} | "
            f"{r['median_win']:.2f} vs {r['median_loss']:.2f} | {r['q_raw']:.3f} | "
            f"{'' if np.isnan(r['q_mmr_adj']) else f'{r['q_mmr_adj']:.3f}'} |")


def write_reports(out_dir: Path, label: str, df: pd.DataFrame, screen_df: pd.DataFrame,
                  model_results: list[dict], clusters: list[list[str]],
                  spell_cols: list[str], caveats: list[str]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    y = df["win"]
    sig = screen_df[screen_df["q_raw"] <= 0.10]
    top_anchor_feats = list(sig["feature"].head(40))

    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "label": label,
        "n_matches": int(len(df)),
        "win_rate": round(float(y.mean()), 4),
        "screen": screen_df.round(4).to_dict(orient="records"),
        "models": model_results,
        "correlation_clusters": clusters,
        "anchors": anchors_for(df, top_anchor_feats),
        "caveats": caveats,
    }
    (out_dir / f"influence-{label}.json").write_text(json.dumps(payload, indent=1), encoding="utf8")

    md = [f"# Win/Loss influence report — {label}",
          f"\n*{len(df)} matches · win rate {y.mean():.1%} · generated {payload['generated'][:16]}*\n"]

    md.append("## Model ceilings (5-fold CV, grouped by queue session)\n")
    md.append("| scope | model | ROC-AUC | Brier |")
    md.append("|---|---|---|---|")
    for res in model_results:
        for mname, m in res["models"].items():
            md.append(f"| {res['scope']} ({res['n_features']} feats) | {mname} | "
                      f"{m['auc_mean']:.3f} ± {m['auc_std']:.3f} | {m['brier_mean']:.3f} |")
    md.append("\nAUC 0.5 = coin flip. The gap between *full* and *process* scope is how much "
              "of the predictability is just outcome restatement (deaths etc.).\n")

    for tier, title in [("process", "Coachable correlates (process tier)"),
                        ("context", "Context correlates (map/comp/MMR/duration)"),
                        ("outcome", "Outcome-adjacent (sanity tier — not coachable)")]:
        tier_rows = sig[sig["tier"] == tier]
        md.append(f"## {title}\n")
        if tier_rows.empty:
            md.append("*Nothing passed the q ≤ 0.10 FDR gate in this tier.*\n")
            continue
        md.append("| feature | direction | rank-biserial | median W vs L | q (FDR) | q (MMR-adj) |")
        md.append("|---|---|---|---|---|---|")
        for _, r in tier_rows.iterrows():
            md.append(_fmt_row(r))
        md.append("")

    proc = next((r for r in model_results if r["scope"] == "process"), None)
    if proc:
        md.append("## Top model importances (process scope, held-out permutation)\n")
        md.append("| feature | tier | ΔAUC mean | ± |")
        md.append("|---|---|---|---|")
        for row in proc["permutation_importance"][:20]:
            md.append(f"| {row['feature']} | {row['tier']} | {row['importance_mean']:.4f} | {row['importance_std']:.4f} |")
        md.append("")

    if clusters:
        md.append("## Correlated feature clusters (|ρ|>0.7 — importances split across these)\n")
        for cl in clusters[:12]:
            md.append(f"- {', '.join(cl)}")
        md.append("")

    if spell_cols:
        md.append(f"## Spell-mix columns screened ({len(spell_cols)})\n")
        md.append(", ".join(s.replace("casts_per_min__", "") for s in spell_cols) + "\n")

    md.append("## Caveats\n")
    for c in caveats:
        md.append(f"- {c}")
    (out_dir / f"influence-{label}.md").write_text("\n".join(md), encoding="utf8")
