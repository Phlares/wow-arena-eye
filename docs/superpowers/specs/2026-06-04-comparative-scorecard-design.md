# Comparative Scorecard — Design Spec

**Status:** design locked for fresh-session execution (2026-06-04)
**Sub-project:** B of 2 (A = match store / Normalizer, PR #16)
**Depends on:** the match store (PR #16 — `src/store/`, `node:sqlite`). Execution must
happen after #16 is merged to master (or with feat/scorecard rebased onto it).

## Goal

Score one arena match for the recording character against that character's own history,
answering two questions at a glance: **"am I playing better / worse / about average?"** and
**"am I playing like I do when I win, or when I lose?"** — sliced like-to-like (same map,
same enemy comp, rating band, time of day) and against my season-best.

This is a **read-only** feature over the store. No new ingestion, no schema changes.

## Locked design decisions (open items from sub-project A, now settled)

1. **"Season".** A season is config-driven: optional `config.seasons: [{ name, startMs }]`.
   The *current season* for a scored match = the season with the greatest `startMs ≤
   match.start_ms`. If `seasons` is absent/empty, **all history is one season** (so
   "season-best" degrades to all-time best — still meaningful). No patch/date guessing.
2. **Metric set.** A curated, declarative `SCORECARD_METRICS` list (~12 indicators), each
   with a **polarity** (`higher-better` | `lower-better`) — polarity is required to turn a
   delta into "better/worse". Tuned for a ranged caster (the user's Affliction main);
   polarity is per-entry so it stays editable and can become spec-aware later. Adding a
   metric = one list entry. The metric ids must exist in the store's `metric` table (they
   are a subset of `metricRows.ts`'s `UNIT_METRICS`).
3. **Baselines + small-sample.** Each baseline is the mean/stdev/count of the character's
   own past values for a metric over a *cohort*. A cohort with fewer than `MIN_COHORT = 5`
   matches is flagged `insufficient` (shown, but not used to declare better/worse). The
   target match itself is excluded from its own baseline.
4. **Grain.** **Per-match** in v1 (target = one match). Per-session aggregation (scoring a
   night's worth at once) is a documented, straightforward extension, deferred.
5. **Output.** A CLI command (`npm run scorecard`) that prints a readable aligned table and,
   with `--json`, the same data as structured JSON (the hook for any later UI). No HTML in v1
   (the existing report HTML is per-log single-match; the scorecard is a cross-history view).
6. **Verdict semantics.** Per metric, against a cohort with `n ≥ MIN_COHORT` and `stdev > 0`:
   `z = (value − mean) / stdev`; `|z| < 0.5` → `average`, else the sign combined with
   polarity → `better` / `worse`. `stdev = 0` → compare raw value to mean. `n < MIN_COHORT`
   → `insufficient`. **Win-likeness:** with both win- and loss-cohorts present, compare the
   value to the win-mean and loss-mean; whichever it is closer to → `win-like` / `loss-like`
   (`neutral` when equidistant or a side is missing). This is the "winning better/worse"
   signal.

## Architecture

A new read-only `src/scorecard/` module (pure core + thin CLI), reusing the store:

- **`src/scorecard/loadMatches.ts`** — `loadPlayerMatches(db, characterName?) → PlayerMatch[]`.
  One query joining `match` ⨝ `combatant(is_player=1)` ⨝ `metric(scope=unit_id)`, pivoted in
  JS into per-match records. The player's lifetime match count is modest (hundreds–low
  thousands), so loading into memory and filtering there is simplest and fast.
  `PlayerMatch = { matchId, startMs, bracket, zoneId, allyComp, enemyComp, rating, result,
  character, metrics: Record<string, number> }`.
- **`src/scorecard/cohort.ts`** — pure cohort selection + stats. `filterCohort(matches,
  target, scope)` applies the active slice (bracket always; optional same-map / same-comp /
  rating-band / time-of-day / season), excluding the target. `stats(values) → { mean,
  stdev, n, min, max }`. `seasonOf(seasons, startMs) → name | null`.
- **`src/scorecard/scorecard.ts`** — pure `buildScorecard(matches, targetMatchId, opts) →
  Scorecard`. For each `SCORECARD_METRICS` entry: the target value, cohort stats, `verdict`,
  `seasonBest` + `isNewBest`, and `winLikeness`. Plus a header (match identity, result,
  cohort description, sample sizes). Holds `SCORECARD_METRICS`.
- **`src/scorecard/render.ts`** — `renderScorecardText(scorecard) → string` (aligned table)
  and the JSON shape is just the `Scorecard` object.
- **`src/cli/scorecard.ts`** — wire: `openDb`, `loadPlayerMatches`, resolve the target
  (`--match <id>`, else latest match for the character), apply scope flags, build, print
  text or `--json`. Runs under `--experimental-sqlite`.
- **`src/config.ts`** — add optional `seasons: { name: string; startMs: number }[]`
  (defaults to `[]`).

The existing store, ingest, view, and occupancy code are untouched.

## CLI

```
npm run scorecard -- [--match <id>] [--character "Name-Realm-US"]
                     [--map] [--comp] [--rating-band <n>] [--time-of-day <hours>]
                     [--season] [--json]
```
- **Target:** `--match <id>`, else the most recent match in the store for the character
  (`--character`, else the character of the most recent match overall).
- **Scope flags** narrow the baseline cohort to like-to-like: `--map` (same `zone_id`),
  `--comp` (same `enemy_comp_sig`), `--rating-band <n>` (within ±n of target rating, default
  150 when the flag is given), `--time-of-day <hours>` (within ±hours of the target's
  local hour, default ±2), `--season` (only the target's current season). Bracket is always
  matched (you don't compare 2v2 to 3v3). Flags compose (e.g. `--map --comp`).
- A narrowed cohort below `MIN_COHORT` prints a `thin sample (n=X)` note and the verdicts in
  that cohort read `insufficient`.

## Data flow

```
store (SQLite) ──openDb──► loadPlayerMatches(db, character) ──► PlayerMatch[]
                                                                   │
                              resolve target match (id | latest) ──┤
                                                                   ▼
                  buildScorecard(matches, targetId, {scope, seasons, minCohort})
                     per metric: value, cohort stats, verdict, season-best, win-likeness
                                                                   ▼
                          renderScorecardText  ──►  CLI table   (or --json → Scorecard)
```

## Error handling

- No DB / empty store → clear message ("no matches ingested; run `npm run ingest-db`"), exit 1.
- Target match id not found → error listing how to pick (latest / a valid id), exit 1.
- Character has only the one match (no history) → render the card with all verdicts
  `insufficient` and a one-line note, exit 0 (not an error).
- A metric absent from a match's stored rows → treated as missing for that match (excluded
  from that cohort's stats), never `NaN`.

## Testing

TDD, pure-core first. Tests seed an in-memory `:memory:` DB via the store's own
`migrate` + `upsertMatch` (or insert rows directly) — no private corpus.

- **`cohort.ts`** — pure: `stats` (mean/stdev/n on known arrays, incl. n=0 and stdev=0);
  `filterCohort` (same-map / same-comp / rating-band / time-of-day include & exclude, target
  excluded, bracket enforced); `seasonOf` (picks latest season ≤ startMs; null before first;
  all-history when empty).
- **`scorecard.ts`** — pure: a synthetic `PlayerMatch[]` with known values → assert per
  metric the `verdict` (better/worse/average/insufficient honoring polarity — e.g. a
  high-deaths match reads `worse` because deaths is lower-better), `seasonBest`/`isNewBest`,
  and `winLikeness` (a match whose value matches the win-mean → `win-like`). Assert the
  `MIN_COHORT` gate flips a verdict to `insufficient`.
- **`loadMatches.ts` / CLI** — integration on a `:memory:` DB seeded with a few upserted
  matches (reuse the store + the real fixture for one, synthetic rows for the rest): assert
  `loadPlayerMatches` pivots correctly and `buildScorecard` on the latest match returns a
  populated card; assert `--json` shape.
- **`render.ts`** — a built `Scorecard` → assert the text contains the metric labels, the
  verdict glyphs, and the cohort/sample-size header (string-contains, not exact layout).
- Type-check `npx tsc --noEmit`. SQLite-touching tests run with
  `NODE_OPTIONS=--experimental-sqlite npx vitest run <file> --no-file-parallelism`; pure
  tests (`cohort`, `scorecard`, `render`) need no flag. Never bare `npx vitest run`.

## Explicitly NOT in v1 (deferred)

Per-session aggregate scorecards; HTML/replay-UI rendering; external benchmarks; AI prose;
spec-aware metric polarity; the verdict-synthesis capstone (combining cooldowns + positioning
+ LoS into a single GO judgment) — that remains the next north-star step after this.

## Self-review notes

- *Placeholders:* none — modules, signatures, CLI flags, verdict math, and tests are concrete.
- *Consistency:* polarity drives every better/worse call; `MIN_COHORT` gate stated once and
  applied everywhere; cohort always enforces bracket; target always excluded from its baseline.
- *Scope:* one read-only subsystem over the existing store. Session grain and the capstone are
  explicitly deferred. "Season" is now concretely defined (config + all-history fallback).
- *Ambiguity:* "better/worse/average" (z-band + polarity), "win-likeness" (nearer win- vs
  loss-mean), and "current season" (latest start ≤ match) are each defined explicitly.
