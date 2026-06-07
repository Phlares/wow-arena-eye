# Baselines + Comparative Scorecard in the Viewer (Sub-project C1) — Design Spec

**Status:** design locked (2026-06-07)
**Sub-project:** **C1** — the first slice of **C (baselines & comparison)**, after the viewer
foundation (A, #18), browser-v2 (#19), metrics increment (#20), and the timeline detail view
(B, #21). C2 (trend charts) and C3 (two-match diff) are separate later slices.
**Depends on:** the scorecard (`src/scorecard/`), the metric battery (`src/metrics/`), the store
(`src/store/`), and the viewer (`src/viewer/`, `web/`) — all on master.

## Goal

Bring the comparative scorecard — currently CLI-only (`npm run scorecard`) — **into the viewer**,
inside the per-match detail overlay, with a configurable **"Compare against"** baseline control.
Brainstormed with the real viewer + a panel mockup; the locked shape:

- **Baseline model:** a "Compare against" control with a **mode** (Overall / Past N games [incl.
  **All**] / Past N sessions) plus composable **filters** (same comp, same map, rating ±band,
  time-of-day, season).
- **Fair verdicting:** length-dependent metrics are verdicted on their **per-minute rate**, not raw
  totals, so long matches don't skew short ones.
- **Win/loss lean for descriptive metrics:** neutral metrics (Precognition, the new healer
  distance) keep a `· info` verdict but now get a **data-driven win/loss lean**.
- **New metric:** **average distance from the friendly healer** over the match.

A one-time **re-ingest** is required (the new healer-distance metric).

## Locked design decisions

### A. Baseline model (scorecard layer)

1. Extend `Scope` (`src/scorecard/types.ts`) with two recency modes (mutually exclusive; absent =
   Overall): `lastNGames?: number` and `lastNSessions?: number`. The existing attribute filters
   (`map`, `comp`, `ratingBand`, `timeOfDayHours`, `season`) **compose on top** of any mode.
2. **Recency is relative to the target match** — only games *before* the target count, so a baseline
   never includes games played after the match being graded.
   - `lastNGames = N`: the N most-recent matches (same character + bracket, already enforced by
     `filterCohort`) with `startMs < target.startMs`. `N = All` ⇒ omit the field (≡ Overall).
   - `lastNSessions = N`: the matches falling in the **N queue-sessions before the target's
     session**, using the existing `sessionize` model (`src/store/sessions.ts`). The target's own
     session is excluded.
3. `filterCohort` applies recency after the attribute filters: filter to the matching cohort, then
   (for `lastNGames`) sort by `startMs` desc among `< target.startMs` and take N; (for
   `lastNSessions`) keep matches whose session index is within the N sessions preceding the
   target's. Default (no recency) is unchanged from today.

### B. Fair verdicting — rate-normalize length-dependent metrics

4. Add an optional `rate?: true` flag to `SCORECARD_METRICS` entries. For a `rate` metric, the
   scorecard computes **everything** (target value, cohort mean/stdev, z, verdict, win-likeness,
   season-best) on the **per-minute value** = `value * 60 / durationSec`. Matches with null/zero
   `durationSec` are dropped from that metric's cohort (and the target value shows `—` if its own
   duration is missing). Non-rate metrics are unchanged.
5. `PlayerMatch` gains `durationSec: number | null`; `loadPlayerMatches` selects `m.duration_sec`.
6. `rate: true` applies to the accumulating metrics: `damageDone`, `healingDone`,
   `interruptsLanded`, `interruptsSuffered`, `ccDone.hardCcSec`, `ccReceived.hardCcSec`,
   `ccReceived.timeSec`, `spacing.isolatedSec`, `spacing.meleeRangeSec`, `precognitionUptimeSec`,
   `enemyPrecognitionUptimeSec`. Because rate-normalized `damageDone` (per-minute) is the same
   quantity as the existing per-second `dps` row, the standalone **`dps` entry is dropped** from
   `SCORECARD_METRICS` (one throughput row, fairly compared). Bounded outcomes (`deaths`,
   `deathsWhileCcd`, `defensivesIntoBurst`) stay non-rate.
7. The panel labels rate metrics with a **`/min`** unit so the value and the "vs avg" column are
   consistent (both rates).

### C. Win/loss lean for descriptive metrics

8. Remove the `neutral`-polarity short-circuit added in #20 that forced `winLikeness = 'neutral'`.
   `winLikenessFor` (nearer the cohort's win-mean vs loss-mean) is now computed for **all** metrics,
   including `neutral` ones. The verdict for a `neutral` metric stays `descriptive` (`· info`) — we
   still don't assert good/bad — but the data-driven win/loss lean is shown.

### D. New metric — average distance from the friendly healer

9. New `UnitMetrics` field `avgHealerDistanceYd: number | null`: the mean distance from the unit to
   its **own-team healer** over the match, sampled at `STEP_SEC` ticks where both positions resolve;
   `null` when the team has no healer or no resolvable samples. Computed in the positioning layer
   (`spacing.ts`) reusing `positionTracks` + `distanceAt` + `HEALER_SPEC_IDS` (`registry.ts`) to pick
   the healer (a friendly player whose spec ∈ HEALER_SPEC_IDS; if multiple, the nearest-on-average or
   the first — pick one rule and state it: **first by unit order**).
10. Persisted via a new `metricRows.ts` `UNIT_METRICS` entry `avgHealerDistanceYd` (no `combine`),
    and added to the `dataset_export` view. Added to `SCORECARD_METRICS` as a **descriptive**
    (`neutral` polarity) metric — it gets the win/loss lean (per C) but no asserted good/bad — and it
    is **not** a `rate` metric (already an average). Requires re-ingest.

### E. Scorecard endpoint

11. `GET /api/matches/:id/scorecard` with query params `mode` (`overall|games|sessions`), `n`
    (number; ignored/`All` for overall), and the filter flags `comp`, `map`, `ratingBand`,
    `timeOfDay`, `season` → look up the match's character, `loadPlayerMatches(db, character)`, build a
    `Scope` from the params, run `buildScorecard(matches, id, { scope, seasons: cfg.seasons })`, and
    return the `Scorecard` object. **404** if the match isn't in the store.

### F. Viewer — comparative scorecard panel

12. A new `ComparePanel` rendered in the **detail overlay**, below the timeline. It holds the
    **"Compare against"** control — a segmented mode (Overall / Past games / Past sessions), an `N`
    selector (10 / 20 / 50 / All for games; 1 / 2 / 3 / All for sessions), and toggle chips for the
    filters (same comp, same map, rating ±band, time-of-day, season) — and the **scorecard table**:
    metric · this match (with `/min` on rate metrics) · verdict (color: better/worse/average, `· info`
    for descriptive) · vs avg · win/loss lean (color) · `★` baseline-best · plus a baseline summary
    line (`Past 20 games · same comp · n=14 (9W–5L)`). Changing any control re-fetches `/scorecard`.
13. **Cohort gate:** when the baseline has fewer than `MIN_COHORT` (5) matches, the table shows the
    `insufficient` verdict and a "small baseline (n=…)" note rather than misleading verdicts.

## Architecture

```
store (match + combatant + metric, now + avgHealerDistanceYd) ─┐
                                                                │ loadPlayerMatches (+ durationSec)
viewer:  GET /api/matches/:id/scorecard?mode&n&filters ─────────┤ buildScorecard(scope, seasons)
           • Scope from params (recency mode + filters)         │   • filterCohort recency (games/sessions)
           • cfg.seasons                                        │   • rate-normalize per-minute
           → Scorecard JSON                                     │   • win-likeness for all metrics
                                                                ▼
web/ SPA:  DetailView overlay → ComparePanel
             • CompareControl (mode + N + filter chips)  • ScorecardTable
```

- **`src/scorecard/{types,cohort,scorecard,loadMatches}.ts`** — `Scope` recency fields; `filterCohort`
  recency (games + sessions, reusing `sessionize`); `rate` flag + per-minute normalization in
  `buildScorecard`; win-likeness for all; `PlayerMatch.durationSec`.
- **`src/metrics/{spacing,types}.ts`** + **`src/store/{metricRows,schema}.ts`** — `avgHealerDistanceYd`
  metric + persistence + export-view column.
- **`src/viewer/{server,queries}.ts`** — `/scorecard` route + a `buildScorecardFor(db, id, scope)`
  helper.
- **`web/src/api.ts`** + **`web/src/components/{ComparePanel,CompareControl,ScorecardTable}.tsx`**
  (+ `DetailView` renders `ComparePanel`).

## Data flow & error handling

- overlay → ComparePanel default baseline (Overall) → fetch `/scorecard` → render; loading /
  fetch-error / insufficient-cohort states.
- Match not in store (pre-store) → 404 → "not in store" message.
- `durationSec` null on the target → rate metrics show `—` for that match (can't normalize).
- No healer on the team (e.g. no healer spec present) → `avgHealerDistanceYd` null → row shows `—`.
- `lastNSessions` when the target has no session (unsessioned `∅`) → empty cohort → insufficient.

## Testing (TDD)

- **Scorecard (sqlite-flagged + pure):** `filterCohort` recency — `lastNGames` takes the N most-recent
  before-target (excludes later games); `lastNSessions` takes matches in the N prior sessions;
  filters compose with recency. `buildScorecard` rate-normalization — a long match and a short match
  with equal *rates* verdict the same; raw-total skew is gone; null-duration matches dropped from the
  cohort. Win-likeness now computed for `neutral` metrics (verdict still `descriptive`).
- **Metrics (root):** `avgHealerDistanceYd` = mean player→healer distance over resolved ticks; null
  when no healer / no samples; persisted id present in `dataset_export`.
- **Viewer (sqlite-flagged):** `/scorecard` parses mode/n/filters into a `Scope`, returns a
  `Scorecard`, 404 when absent.
- **Web (jsdom):** `CompareControl` emits the right params on mode/N/filter changes; `ScorecardTable`
  renders rate metrics with `/min`, color-codes verdicts and the win/loss lean, shows `★` and the
  insufficient-cohort note.

SQLite tests run with `NODE_OPTIONS=--experimental-sqlite … --no-file-parallelism`; web tests inside `web/`.

## Explicitly NOT in this increment (deferred)

- **This-session-vs-previous-session** aggregate comparison (a different mode — aggregate vs
  aggregate, not match-vs-cohort).
- **Past X days** recency (games + sessions cover the need for now).
- **C2** trend-over-time charts; **C3** two-match diff.
- The "Mitigation up" spellId→name table (separate polish).

## Self-review notes

- *Placeholders:* none — recency semantics (before-target, games/sessions), the `rate` rule + its
  metric list + the `dps` de-dup, the win-likeness change, the healer-distance computation, the
  endpoint params, and the panel are all concrete.
- *Consistency:* recency composes with attribute filters everywhere; rate-normalization is defined
  once (per-minute via `durationSec`) and applied by the `rate` flag; `neutral` = descriptive verdict
  + data-driven win/loss lean (one rule) for Precognition and healer distance alike.
- *Scope:* one slice (C1); session-vs-prev, trend, and two-match diff are explicitly deferred. The
  metric (re-ingest) and the viewer panel are separable and the plan will phase them.
- *Ambiguity:* "Compare against" modes (Overall / Past N games incl. All / Past N sessions), "rate"
  (per-minute), "healer" (first friendly unit with a healer spec), and "win/loss lean for descriptive"
  are each made explicit.
