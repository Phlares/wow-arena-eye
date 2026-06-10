"""python -m wae --db ../wow-arena-eye.local.db [--bracket 3v3] [--character Phlares]

Builds the feature table from the store, screens every feature against win/loss
(BH-FDR), fits session-grouped CV models, and writes output/analysis/influence-*.{md,json}.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from . import categorical, db, features, model, report, screen

META_COLS = {"match_id", "win", "session_id"}
CATEGORICAL_SCREEN_COLS = ["map_name", "ally_healer_class", "enemy_healer_class",
                           "my_main_target_class", "opener_pattern"]


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
        durations.append(row.get("duration_sec") or 0)
        for entry in atlas:
            death_atlas.append({**entry, "match_id": match_id, "zone_id": zone,
                                "map_name": arenas.get(zone, zone), "win": row["result"] == "win"})
    spell_cols_kept = features.add_spell_rate_columns(feats, cast_counters, durations)
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

    caveats = [
        f"n={len(df)}: only medium+ effects are detectable; absence of significance is not absence of effect.",
        "Correlation is not causation - process features can be confounded by game state (winning enables 'good' behavior).",
        "Matches within a queue session share comp/opponents/MMR; CV is grouped by session, but screening is not.",
        "MMR-adjusted q controls for opponent caliber via a 2-variable logit (the user's caliber-shifts-conditions point).",
        "Solo Shuffle is absent from the store (parser emits standard arena matches only).",
        "Precognition instance-counts-before-60s need a new persisted metric (uptime seconds only today).",
    ]
    report.write_reports(out_dir, label, df, screened, results, clusters, spell_cols, caveats,
                         cat_screened=cat_screened, death_atlas=death_atlas)
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
