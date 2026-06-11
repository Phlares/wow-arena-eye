"""Emit the influence report: a human markdown + a machine JSON ('data anchors') the
future AI coach consumes to place a live match against history."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ANCHOR_QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9]

# features whose MEANING shifts with the enemy comp (melee uptime vs a melee comp is
# pressure on me; vs casters it can be access to a kill target) - these get per-archetype
# anchors so the coach places them against same-comp history, not the global pool
COMP_SENSITIVE_FEATURES = [
    "pct_time_in_enemy_melee", "median_dist_nearest_enemy_yd",
    "spacing_meleeRangeSec_per_min", "spacing_isolatedSec_per_min",
    "median_dist_to_healer_yd", "pct_time_beyond_heal_range",
    "distanceMoved_per_min", "timeStationarySec_per_min",
    "center_dist_frac_mean", "edge_proximity_frac", "own_half_time_frac",
    "map_area_coverage_frac", "damageDone_per_min", "my_time_on_enemy_healer_frac",
    "our_go_per_min", "enemy_go_per_min",
]
ARCHETYPE_ANCHOR_MIN_N = 50   # the sufficiency verdict's categorical-slice floor


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


def anchors_by_archetype(df: pd.DataFrame, features: list[str] = COMP_SENSITIVE_FEATURES,
                         min_n: int = ARCHETYPE_ANCHOR_MIN_N) -> dict:
    """Comp-conditioned anchors: anchors_for over each enemy_comp_archetype slice with
    n >= min_n (anchors_for's own >=15-win/>=15-loss per-feature gate still applies).
    Archetypes whose slice yields no anchors are omitted - the pack never places a
    feature against an anchor the data couldn't support."""
    if "enemy_comp_archetype" not in df.columns:
        return {}
    out: dict = {}
    cols = [f for f in features if f in df.columns]
    for archetype, sub in df.groupby(df["enemy_comp_archetype"].fillna("none").astype(str)):
        if archetype == "none" or len(sub) < min_n:
            continue
        anchors = anchors_for(sub, cols)
        if anchors:
            out[archetype] = {"n": int(len(sub)),
                              "win_rate": round(float(sub["win"].mean()), 4),
                              "anchors": anchors}
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
                  gbm_h2: pd.DataFrame | None = None,
                  data_sufficiency: dict | None = None,
                  targeting_crosstab: list[dict] | None = None) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    y = df["win"]
    sig = screen_df[screen_df["q_raw"] <= 0.10]
    # comp-sensitive features are always anchored, significant or not - without a global
    # anchor the pack can't place them, and vs_this_comp placement hangs off that entry
    top_anchor_feats = list(sig["feature"].head(40))
    top_anchor_feats += [f for f in COMP_SENSITIVE_FEATURES
                         if f in df.columns and f not in top_anchor_feats]
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
        "anchors_by_enemy_archetype": anchors_by_archetype(df),
        "death_atlas_summary": atlas_summary,
        "interactions": {
            "pairs": interactions.to_dict(orient="records") if interactions is not None and not interactions.empty else [],
            "gbm_h2": gbm_h2.to_dict(orient="records") if gbm_h2 is not None and not gbm_h2.empty else [],
        },
        "targeting_crosstab": targeting_crosstab or [],
        "data_sufficiency": data_sufficiency or {},
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

    proc_logit = next((r["models"].get("logistic_en") for r in model_results
                       if r["scope"] == "process"), None)
    if proc_logit and proc_logit.get("calibration"):
        md.append("## Calibration (process-scope logistic, CV held-out predictions)\n")
        md.append("*Honest win-probability requires predicted ≈ observed per bin.*\n")
        md.append("| predicted (bin mean) | observed win rate | n |")
        md.append("|---|---|---|")
        for b in proc_logit["calibration"]:
            md.append(f"| {b['pred_mean']:.2f} | {b['obs_rate']:.2f} | {b['n']} |")
        md.append("")

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

    if targeting_crosstab:
        md.append("## Kill-target / first-death profile by enemy comp\n")
        md.append("*Descriptive priors (no FDR family). 'losses: ...' = of losses vs this "
                  "comp, who died first; 'WR me-first' = win rate when I die first.*\n")
        md.append("| comp variable | level | n | win rate | losses: me / dps / healer / enemy-first | WR me-first |")
        md.append("|---|---|---|---|---|---|")
        for r in targeting_crosstab[:20]:
            lf = r["loss_first_death"]
            shares = (" / ".join(f"{lf[k]:.0%}" if lf.get(k) is not None else "—"
                                 for k in ("me", "dps_ally", "healer_ally", "enemy"))
                      + f" (n={r['n_loss']})")
            me = r["wr_by_first_death"].get("me")
            md.append(f"| {r['variable']} | {r['level']} | {r['n']} | {r['win_rate']:.1%} | "
                      f"{shares} | {f'{me['wr']:.0%} (n={me['n']})' if me else '—'} |")
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

    if data_sufficiency:
        md.append("## Data sufficiency (what this n can and cannot support)\n")
        for key, title in [("sufficient_now", "Sufficient NOW"), ("marginal", "Marginal"),
                           ("not_sufficient", "NOT sufficient")]:
            items = data_sufficiency.get(key) or []
            if items:
                md.append(f"**{title}:** " + "; ".join(items) + "\n")
        if data_sufficiency.get("growth_note"):
            md.append(f"*Growth:* {data_sufficiency['growth_note']}\n")
        if data_sufficiency.get("coaching_ceiling"):
            md.append(f"*Coaching ceiling today:* {data_sufficiency['coaching_ceiling']}\n")

    md.append("## Caveats\n")
    for c in caveats:
        md.append(f"- {c}")
    (out_dir / f"influence-{label}.md").write_text("\n".join(md), encoding="utf8")
