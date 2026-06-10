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


def death_atlas_summary(death_atlas: list[dict]) -> list[dict]:
    """Per-map aggregate of MY deaths: where, how pillar-adjacent, how far from the healer."""
    by_map: dict[str, list[dict]] = {}
    for d in death_atlas:
        by_map.setdefault(d["map_name"], []).append(d)
    out = []
    for map_name, ds in sorted(by_map.items(), key=lambda kv: -len(kv[1])):
        voids = [d["voidness"] for d in ds if "voidness" in d]
        hdist = [d["healer_dist_yd"] for d in ds if "healer_dist_yd" in d]
        out.append({
            "map": map_name, "deaths": len(ds),
            "mean_voidness": round(float(np.mean(voids)), 3) if voids else None,
            "mean_healer_dist_yd": round(float(np.mean(hdist)), 1) if hdist else None,
            "pct_beyond_heal_range": round(float(np.mean([h > 40 for h in hdist])), 3) if hdist else None,
        })
    return out


def write_reports(out_dir: Path, label: str, df: pd.DataFrame, screen_df: pd.DataFrame,
                  model_results: list[dict], clusters: list[list[str]],
                  spell_cols: list[str], caveats: list[str],
                  cat_screened: pd.DataFrame | None = None,
                  death_atlas: list[dict] | None = None,
                  transseasonal: set[str] | None = None,
                  interactions: pd.DataFrame | None = None,
                  gbm_h2: pd.DataFrame | None = None) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    y = df["win"]
    sig = screen_df[screen_df["q_raw"] <= 0.10]
    top_anchor_feats = list(sig["feature"].head(40))
    atlas_summary = death_atlas_summary(death_atlas or [])
    ts = transseasonal or set()

    screen_records = screen_df.round(4).to_dict(orient="records")
    for rec in screen_records:
        rec["transseasonal"] = rec["feature"] in ts

    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "label": label,
        "n_matches": int(len(df)),
        "win_rate": round(float(y.mean()), 4),
        # mechanics-free features the coach can trust across season boundaries
        "transseasonal_features": sorted(t for t in ts if t in df.columns),
        "screen": screen_records,
        "categorical": cat_screened.to_dict(orient="records") if cat_screened is not None and not cat_screened.empty else [],
        "models": model_results,
        "correlation_clusters": clusters,
        "anchors": anchors_for(df, top_anchor_feats),
        "death_atlas_summary": atlas_summary,
        "interactions": {
            "pairs": interactions.to_dict(orient="records") if interactions is not None and not interactions.empty else [],
            "gbm_h2": gbm_h2.to_dict(orient="records") if gbm_h2 is not None and not gbm_h2.empty else [],
        },
        "caveats": caveats,
    }
    (out_dir / f"influence-{label}.json").write_text(json.dumps(payload, indent=1), encoding="utf8")
    if death_atlas:
        (out_dir / f"death-atlas-{label}.json").write_text(json.dumps(death_atlas, indent=1), encoding="utf8")

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

    if cat_screened is not None and not cat_screened.empty:
        md.append("## Categorical win rates (maps, comps, target choice, openers)\n")
        md.append("*Fisher exact per level vs the rest; q = BH over every cell screened. "
                  "CI = Wilson 95%.*\n")
        md.append("| variable | level | n | win rate | 95% CI | baseline | q |")
        md.append("|---|---|---|---|---|---|---|")
        for _, r in cat_screened.head(30).iterrows():
            md.append(f"| {r['variable']} | {r['level']} | {r['n']} | {r['win_rate']:.1%} | "
                      f"{r['ci_lo']:.0%}–{r['ci_hi']:.0%} | {r['baseline']:.1%} | {r['q']:.3f} |")
        md.append("")

    if atlas_summary:
        md.append("## Death atlas (where I die, per map)\n")
        md.append("*voidness ≈ pillar-adjacency of the death spot (0 open … 1 inside occluder); "
                  "raw points in death-atlas json for mapping.*\n")
        md.append("| map | my deaths | mean voidness | mean dist to healer | % beyond heal range |")
        md.append("|---|---|---|---|---|")
        for r in atlas_summary:
            md.append(f"| {r['map']} | {r['deaths']} | {r['mean_voidness'] if r['mean_voidness'] is not None else '—'} | "
                      f"{r['mean_healer_dist_yd'] if r['mean_healer_dist_yd'] is not None else '—'} yd | "
                      f"{'' if r['pct_beyond_heal_range'] is None else f'{r['pct_beyond_heal_range']:.0%}'} |")
        md.append("")

    if interactions is not None and not interactions.empty:
        md.append("## Interaction mining (pairwise A×B on top of MMR + A + B)\n")
        survivors = interactions[interactions["q"] <= 0.10]
        if survivors.empty:
            md.append(f"*No pair survived the q ≤ 0.10 FDR gate over {len(interactions)} "
                      "tested pairs — at this n, expect a handful of survivors at best.*\n")
        else:
            md.append("*Cells are median-split win rates: a-side_b-side. Read 'hi_lo' as "
                      "high A AND low B.*\n")
            md.append("| pair | n | q | lo_lo | lo_hi | hi_lo | hi_hi |")
            md.append("|---|---|---|---|---|---|---|")
            for _, r in survivors.iterrows():
                c = r["cells"]
                cells = " | ".join(
                    f"{c[k]['wr']:.0%} (n{c[k]['n']})" if c[k]["wr"] is not None else "—"
                    for k in ("lo_lo", "lo_hi", "hi_lo", "hi_hi"))
                md.append(f"| {r['feature_a']} × {r['feature_b']} | {r['n']} | {r['q']:.3f} | {cells} |")
            md.append("")
        if gbm_h2 is not None and not gbm_h2.empty:
            md.append("*GBM-side (Friedman H², top model features — which pairs the model "
                      "actually uses jointly):* " +
                      "; ".join(f"{r['feature_a']} × {r['feature_b']} ({r['h2']:.2f})"
                                for _, r in gbm_h2.head(5).iterrows()) + "\n")

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
