"""python -m wae --db ../wow-arena-eye.local.db [--bracket 3v3] [--character Phlares]

Builds the feature table from the store, screens every feature against win/loss
(BH-FDR), fits session-grouped CV models, and writes output/analysis/influence-*.{md,json}.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from . import categorical, db, features, features2, interactions, model, report, screen

META_COLS = {"match_id", "win", "session_id"}
CATEGORICAL_SCREEN_COLS = ["map_name", "ally_healer_class", "enemy_healer_class",
                           "my_main_target_class", "opener_pattern",
                           "ally_comp_archetype", "enemy_comp_archetype"]


def build_frame(db_path: str, bracket: str, character: str | None) -> tuple[pd.DataFrame, list[str], list[dict]]:
    rows = db.load_matches(db_path, bracket=bracket, character=character)
    if not rows:
        raise SystemExit(f"no matches for bracket={bracket} character={character}")
    db.assign_sessions(rows)
    metrics = db.metric_pivot(db_path, [r["match_id"] for r in rows])
    specs = db.spec_table()
    arenas = db.arenas_table()
    feats: list[dict] = []
    cast_counters = []
    bigram_counters = []
    durations = []
    death_atlas: list[dict] = []
    by_id = {r["match_id"]: r for r in rows}
    for match_id, blob in db.iter_blobs(db_path, [r["match_id"] for r in rows]):
        row = by_id[match_id]
        zone = str(row.get("zone_id"))
        f, casts, atlas = features.derive(row, metrics.get(match_id, {}), blob, specs,
                                          grid=db.load_occupancy(zone))
        f["map_name"] = arenas.get(zone, zone)
        feats.append(f)
        cast_counters.append(casts)
        bigram_counters.append(features2.midgame_bigrams(blob))
        durations.append(row.get("duration_sec") or 0)
        for entry in atlas:
            death_atlas.append({**entry, "match_id": match_id, "zone_id": zone,
                                "map_name": arenas.get(zone, zone), "win": row["result"] == "win"})
    spell_cols_kept = features.add_spell_rate_columns(feats, cast_counters, durations)
    features.add_bigram_rate_columns(feats, bigram_counters, durations)
    df = pd.DataFrame(feats)
    # presence flags are only written when true - absent means "that class wasn't there", not unknown
    flag_cols = [c for c in df.columns if c.startswith("enemy_has_")]
    df[flag_cols] = df[flag_cols].fillna(0.0)
    spell_cols = [c for c in df.columns if c.startswith("casts_per_min__")]
    print(f"[wae] {len(df)} matches, {df.shape[1]} columns ({len(spell_cols)} spell-mix: {', '.join(spell_cols_kept[:8])}...)")
    return df, spell_cols, death_atlas


def run(db_path: str, bracket: str, character: str | None, out_dir: Path) -> None:
    label = (character or "pooled").lower() + f"-{bracket}"
    df, spell_cols, death_atlas = build_frame(db_path, bracket, character)
    feature_cols = [c for c in df.columns if c not in META_COLS]
    numeric_cols = [c for c in feature_cols if c not in model.CATEGORICAL and c not in model.NON_MODEL_STRINGS]

    screened = screen.screen(df, numeric_cols, features.TIERS)
    cat_screened = categorical.categorical_screen(df, CATEGORICAL_SCREEN_COLS)
    results = [model.run_models(df, feature_cols, features.TIERS, scope) for scope in ("process", "full")]
    clusters = model.correlation_clusters(df, numeric_cols)

    pairs, df_int = interactions.candidate_pairs(df, screened)
    inter = interactions.pair_screen(df_int, pairs)
    n_survive = int((inter["q"] <= 0.10).sum()) if not inter.empty else 0
    print(f"[wae] interaction screen: {len(pairs)} pairs, {n_survive} survive q<=0.10")
    proc_perm = next(r for r in results if r["scope"] == "process")["permutation_importance"]
    h_feats = [r["feature"] for r in proc_perm
               if r["feature"] in numeric_cols][:interactions.H_TOP_K]
    gbm_h2 = interactions.friedman_h(df, h_feats, df["win"].to_numpy()) if len(h_feats) >= 2 else None

    caveats = [
        f"n={len(df)}: only medium+ effects are detectable; absence of significance is not absence of effect.",
        "Correlation is not causation - process features can be confounded by game state (winning enables 'good' behavior).",
        "Matches within a queue session share comp/opponents/MMR; CV is grouped by session, but screening is not.",
        "MMR-adjusted q controls for opponent caliber via a 2-variable logit (the user's caliber-shifts-conditions point).",
        "Solo Shuffle is absent from the store (parser emits standard arena matches only).",
        "Precognition instance-counts-before-60s need a new persisted metric (uptime seconds only today).",
        "Spell-mix, opener, and comp findings are SEASONAL (12.0-only by design of the season-gated "
        "ingest); transseasonal_features lists the mechanics-free subset expected to survive season changes.",
    ]
    # section-B verdict from the 2026-06-10 handoff, parameterized by the run's n
    data_sufficiency = {
        "n": len(df),
        "sufficient_now": [
            "percentile anchors per feature",
            "top-~30 robust correlates (medium+ effects)",
            "calibrated logistic win-probability (see Calibration section)",
            "categorical matchup tables down to ~50-game slices (enemy healer class, "
            "main-target class, maps)",
        ],
        "marginal": [
            "interaction mining (a handful of survivors, not a matrix)",
            "per-map x per-matchup combined slices (<30 games - anchors only, no significance)",
        ],
        "not_sufficient": [
            "deep/sequence models",
            "per-enemy-comp (exact 3-spec) models",
            "causal claims - frame suggestions as correlations",
        ],
        "growth_note": "~40-60 matches/week of play -> interaction power improves "
                       "meaningfully by ~1.5-2k matches; everything re-runs cheaply.",
        "coaching_ceiling": "descriptive-contextual coach (place the match against history, "
                            "name the deviating features, cite matchup priors) - solid and "
                            "honest. Prescriptive 'do X next time' requires causal care.",
    }
    report.write_reports(out_dir, label, df, screened, results, clusters, spell_cols, caveats,
                         cat_screened=cat_screened, death_atlas=death_atlas,
                         transseasonal=features.TRANSSEASONAL,
                         interactions=inter, gbm_h2=gbm_h2,
                         data_sufficiency=data_sufficiency)
    df.to_csv(out_dir / f"features-{label}.csv", index=False)
    print(f"[wae] wrote {out_dir}/influence-{label}.md (+.json, features csv, death atlas)")


def main() -> None:
    ap = argparse.ArgumentParser(prog="wae")
    ap.add_argument("--db", default=str(db.REPO_ROOT / "wow-arena-eye.local.db"))
    ap.add_argument("--bracket", default="3v3")
    ap.add_argument("--character", default=None, help="player-name prefix filter (e.g. Phlares); omit for pooled")
    ap.add_argument("--out", default=str(db.REPO_ROOT / "output" / "analysis"))
    args = ap.parse_args()
    run(args.db, args.bracket, args.character, Path(args.out))


if __name__ == "__main__":
    main()
