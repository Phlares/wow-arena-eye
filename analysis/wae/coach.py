"""C: the coach context pack - the DURABLE artifact of the coach design. Deterministic,
no LLM: places one match's feature vector against the corpus win/loss anchors, attaches
matchup priors and the GO story, and emits a single JSON. The agent layer (Claude
sub-agent today, local model on the 3090 later) is a thin persona over this pack, which
keeps the model swappable - the canonical persona prompt lives in coach_prompt.md.

Run: .venv\\Scripts\\python -m wae.coach [--match latest|<match_id>] [--character X]
     [--influence pooled|phlares|phluglishph]
Emits: output/analysis/coach-context-<matchId>.json
"""
from __future__ import annotations

import json
import numpy as np

from .features import _team_maps
from .targeting import rows_for_match

# editorial threshold for the narrative flag: beyond the win-dist quartile, in the
# losing direction. The agent layer reads the flag; restyle coaching by changing this.
LOSS_TERRITORY_PCT = 0.25
TOP_CORRELATES = 10


def _pct_at(value: float, anchor_vals: list[float], q: list[float]) -> float:
    """Percentile of `value` against quantile knots, tie-safe. Discrete features tie
    their knots (deaths win_q can be all 0) and np.interp misreads ties - here a value
    inside a tied run reads as the MIDPOINT of that run's quantile span. Outside the
    span clamps to 0.05/0.95: "far in the tail", never a false-precision 0 or 1."""
    av = np.asarray(anchor_vals, dtype=float)
    lo = int(np.searchsorted(av, value, side="left"))
    hi = int(np.searchsorted(av, value, side="right"))
    if hi == 0:
        return 0.05
    if lo == len(av):
        return 0.95
    if lo == hi:   # strictly between two distinct knots: ordinary interpolation
        return float(np.interp(value, [av[lo - 1], av[lo]], [q[lo - 1], q[lo]]))
    return (q[lo] + q[hi - 1]) / 2


def anchor_placement(value: float, anchor: dict, rank_biserial: float) -> dict:
    """Where this value sits in the win and loss distributions (percentile interpolated
    over the anchor quantiles), plus the loss-territory flag: beyond the win-dist
    quartile in the direction the screen associates with LOSING."""
    q = anchor["quantiles"]
    pct_win = _pct_at(value, anchor["win_q"], q)
    pct_loss = _pct_at(value, anchor["loss_q"], q)
    if rank_biserial >= 0:   # winners run this HIGH -> low percentile = loss territory
        loss_territory = pct_win < LOSS_TERRITORY_PCT
    else:                    # winners run this LOW -> high percentile = loss territory
        loss_territory = pct_win > 1 - LOSS_TERRITORY_PCT
    return {"pct_in_win": round(pct_win, 3), "pct_in_loss": round(pct_loss, 3),
            "loss_territory": bool(loss_territory)}


def matchup_priors(categorical: list[dict], levels: dict[str, str]) -> dict:
    """The categorical-screen rows matching THIS match's levels (enemy healer class, map,
    main-target class, opener). Variables with no row are omitted - the pack never
    invents a prior."""
    out: dict = {}
    for rec in categorical:
        var = rec.get("variable")
        if levels.get(var) == rec.get("level"):
            out[var] = {k: rec[k] for k in ("level", "n", "win_rate", "ci_lo", "ci_hi",
                                            "baseline", "q") if k in rec}
    return out


def _go_summary(blob: dict, feats: dict) -> dict:
    """The favor/GO story: window counts, lethality, defensives-up - from the blob's
    offensive windows plus the already-derived per-match features."""
    wins = blob.get("offensiveWindows", [])
    enemy = [w for w in wins if w.get("attackingTeam") == "enemy"]
    ours = [w for w in wins if w.get("attackingTeam") == "friendly"]
    team, _spec = _team_maps(blob)
    my_team_deaths = [ev.get("tSec", 0) for ev in blob.get("timeline", [])
                      if ev.get("kind") == "death" and team.get(ev.get("unitId")) == "friendly"]
    lethal = sum(1 for w in enemy
                 if any(w.get("startSec", 0) <= d <= w.get("endSec", 0) for d in my_team_deaths))
    out = {
        "enemy_go_count": len(enemy), "our_go_count": len(ours),
        "lethal_enemy_gos": lethal,
        "enemy_go_windows": [{"start_sec": w.get("startSec"), "end_sec": w.get("endSec"),
                              "team_damage_taken": w.get("teamDamageTaken"),
                              "defensives_available": (w.get("mitigation") or {}).get("available", [])}
                             for w in enemy],
    }
    for k in ("mean_defensives_up_at_enemy_go", "first_enemy_go_sec",
              "mean_enemy_offense_ready_at_go", "mean_our_offense_ready_at_go"):
        if k in feats:
            out[k] = round(float(feats[k]), 3)   # never leak a numpy scalar into the json
    return out


def build_pack(feats: dict, blob: dict, influence: dict, row: dict) -> dict:
    """Assemble the context pack from the derived feature vector, the match blob, the
    influence payload (anchors/screen/categorical/atlas/caveats), and the store row."""
    screen_by_feat = {r["feature"]: r for r in influence.get("screen", [])}
    anchors = influence.get("anchors", {})
    comp_block = influence.get("anchors_by_enemy_archetype", {}).get(
        feats.get("enemy_comp_archetype")) or {}
    comp_anchors = comp_block.get("anchors", {})

    placed: dict = {}
    # both anchor sources place independently - a feature anchored only in the comp slice
    # still gets a (comp-only) entry, so the pack never depends on the global top-40 cut
    for feat in {**anchors, **comp_anchors}:
        v = feats.get(feat)
        if v is None or (isinstance(v, float) and np.isnan(v)):
            continue
        rec = screen_by_feat.get(feat, {})
        rb = rec.get("rank_biserial", 0.0)
        entry = {
            "value": round(float(v), 3),
            "tier": rec.get("tier", "process"),
            "direction": "higher_in_wins" if rb >= 0 else "higher_in_losses",
            "transseasonal": bool(rec.get("transseasonal", False)),
        }
        if feat in anchors:
            entry.update(anchor_placement(float(v), anchors[feat], rb))
        if feat in comp_anchors:   # same-comp placement next to the global one; the
            entry["vs_this_comp"] = {   # persona prefers it for positional reads
                **anchor_placement(float(v), comp_anchors[feat], rb),
                "comp_n": comp_block.get("n"),
            }
        placed[feat] = entry

    levels = {var: feats.get(var) for var in
              ("enemy_healer_class", "my_main_target_class", "map_name", "opener_pattern",
               "ally_comp_archetype", "enemy_comp_archetype")}
    atlas_row = next((r for r in influence.get("death_atlas_summary", [])
                      if r.get("map") == feats.get("map_name")), None)

    top = [
        {"feature": r["feature"], "direction": "higher_in_wins" if r["rank_biserial"] >= 0
         else "higher_in_losses", "rank_biserial": r["rank_biserial"],
         "median_win": r.get("median_win"), "median_loss": r.get("median_loss"),
         "q": r.get("q_raw")}
        for r in influence.get("screen", [])
        if r.get("tier") == "process" and r.get("q_raw", 1) <= 0.10
    ][:TOP_CORRELATES]

    return {
        "match": {"match_id": feats.get("match_id"), "result": row.get("result"),
                  "duration_sec": row.get("duration_sec"), "mmr": row.get("player_rating"),
                  "map": feats.get("map_name"),
                  "enemy_healer_class": feats.get("enemy_healer_class"),
                  "enemy_comp_archetype": feats.get("enemy_comp_archetype"),
                  "opener_pattern": feats.get("opener_pattern")},
        "features": placed,
        "matchup_priors": matchup_priors(influence.get("categorical", []), levels),
        "targeting_priors": rows_for_match(influence.get("targeting_crosstab", []), feats),
        "death_atlas_this_map": atlas_row,
        "go_summary": _go_summary(blob, feats),
        "top_correlates": top,
        "history": {"label": influence.get("label"), "n_matches": influence.get("n_matches"),
                    "win_rate": influence.get("win_rate"),
                    "coaching_ceiling": (influence.get("data_sufficiency") or {}).get("coaching_ceiling")},
        "caveats": influence.get("caveats", []),
    }


def main() -> None:
    import argparse
    from pathlib import Path

    from . import db, features

    ap = argparse.ArgumentParser(prog="wae.coach")
    ap.add_argument("--db", default=str(db.REPO_ROOT / "wow-arena-eye.local.db"))
    ap.add_argument("--match", default="latest", help="'latest' or a match_id")
    ap.add_argument("--character", default=None, help="restrict 'latest' to this character")
    ap.add_argument("--influence", default="pooled",
                    help="anchor source label (pooled|phlares|...): pooled anchors with a "
                         "--character match is deliberate cross-history placement")
    ap.add_argument("--out", default=str(db.REPO_ROOT / "output" / "analysis"))
    args = ap.parse_args()

    rows = db.load_matches(args.db, character=args.character)
    if not rows:
        raise SystemExit("no matches in store")
    db.assign_sessions(rows)
    row = rows[-1] if args.match == "latest" else next(
        (r for r in rows if r["match_id"] == args.match), None)
    if row is None:
        raise SystemExit(f"match {args.match} not found")

    influence_path = Path(args.out) / f"influence-{args.influence}-3v3.json"
    if not influence_path.exists():
        raise SystemExit(f"influence file not found: {influence_path} (run python -m wae first)")
    influence = json.loads(influence_path.read_text(encoding="utf8"))

    metrics = db.metric_pivot(args.db, [row["match_id"]])
    blob = next(b for _mid, b in db.iter_blobs(args.db, [row["match_id"]]))
    zone = str(row.get("zone_id"))
    feats, _casts, _atlas = features.derive(row, metrics.get(row["match_id"], {}), blob,
                                            db.spec_table(), grid=db.load_occupancy(zone))
    feats["map_name"] = db.arenas_table().get(zone, zone)

    pack = build_pack(feats, blob, influence, row)
    out_path = Path(args.out) / f"coach-context-{row['match_id']}.json"
    out_path.write_text(json.dumps(pack, indent=1), encoding="utf8")
    print(f"[wae.coach] wrote {out_path} ({out_path.stat().st_size // 1024}KB, "
          f"{len(pack['features'])} placed features, "
          f"{sum(1 for f in pack['features'].values() if f.get('loss_territory'))} in loss territory)")


if __name__ == "__main__":
    main()
