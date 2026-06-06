# Per-Match Detail — Timeline View (Sub-project B) — Design Spec

**Status:** design locked (2026-06-06)
**Sub-project:** **B** of the Arena Match Viewer (after **A**, the viewer foundation, PR #18, and the
Match-Browser-v2 / metrics increments, PRs #19–#20). Sibling **C** (baselines & comparison) stays
deferred.
**Depends on:** the metric battery (`src/metrics/`), the match store (`src/store/`), the viewer
(`src/viewer/`, `web/`) — all on master.

## Goal

Click a match → a full, native-React **timeline detail view**: one continuous horizontal timeline
for the match, with enemy **GO (offensive) windows** as the visual anchor, event lanes beneath, and
a **range line** (distance to the primary threat over time). Makes the entire GO-analysis battery —
cooldowns, positioning, line-of-sight, CC/immune, focus — visible per match for the first time
(today the drawer only teases "full detail coming in B").

Two layers:
- **Data substrate** (metrics + store + ingest; one-time re-ingest): a small **timeline
  extension** (so the CC and kicks-taken lanes have timed data) + persist the **full
  `MatchMetrics`** per match (the DB currently holds only scalar aggregates).
- **Viewer** (read-only): a detail endpoint + a timeline detail view in the SPA.

## Locked design decisions

### A0. Timeline extension (metrics)

The current `timeline: TimelineEvent[]` carries only `cast | interrupt | dispel | steal | death`,
records only the **actor** (for interrupts, the kicked spell — not the target), and has **no CC**.
The summary `ccReceived`/`ccDone`/`interruptsSuffered` fields have no timestamps. So two wireframe
lanes (CC done/taken, kicks-taken) need timed events that don't exist yet. Extend `buildTimeline`
minimally:

0a. `TimelineEvent` gains optional `targetId?`/`targetName?`. Interrupt (and CC) events record the
    **target**, so "you got kicked" / "CC on you" are derivable.
0b. `TimelineKind` gains `'cc'`. `buildTimeline` emits a `cc` event per **player-on-player** CC
    application (`SPELL_AURA_APPLIED` where `ccInfo(spellId)` is a real CC and both ends resolve to
    players, reusing the existing player-on-player rules), carrying `spell`, the DR `category` in
    `extra`, and source/target. Pet-cast CC rolls to the owner (consistent with `ccSides`).

This flows into the persisted blob (below), so the lanes are pure reads. No other metric changes —
CC *summary* fields, scorecard, etc. are untouched.

### A. Data substrate (persist full MatchMetrics)

1. **New table** `match_detail(match_id TEXT PRIMARY KEY REFERENCES match(match_id), metrics_json TEXT NOT NULL)`.
   Kept separate from `match` so the (large) blob is lazy-loaded only by the detail endpoint and the
   browse/list queries stay lean.
2. `upsertMatch` already receives the computed `MatchMetrics`; it writes
   `JSON.stringify(metrics)` into `match_detail` inside the **same delete-then-insert transaction**
   (idempotent; a re-ingest overwrites). Additive — no change to existing tables/columns.
3. The stored blob is the **full** `MatchMetrics` (incl. `positionTracks`), so the range lane works
   now and a future 2-D spatial replay is unblocked. (Position tracks dominate the size; acceptable
   for a personal tool — low MB/match at most.)
4. **Re-ingest** required once to backfill `match_detail` for existing matches (now a bare
   `npm run ingest-db`, per PR #20).

### B. Detail API

5. `GET /api/matches/:id/detail` → looks up `match_detail.metrics_json`; returns
   `{ metrics: MatchMetrics, rangeSeries: RangePoint[] }` where
   `RangePoint = { tSec: number; dist: number | null }`.
6. **Range series is computed server-side** from the stored `positionTracks` using the existing
   `distanceAt(track, tSec)`: the recording player's distance to the **primary threat** — the enemy
   *player* unit with the highest `damageDone` — sampled at a fixed step (e.g. 0.5 s) across the
   match. `null` where either position is unknown (honest gaps, never a fabricated 0). Done in the
   viewer (Node) layer so the spatial math stays in shared `src/metrics` code, not reimplemented in
   the browser.
7. **404** when there is no `match_detail` row (a match ingested before this change) so the SPA can
   render a "re-ingest to view detail" state rather than a broken view.

### C. Timeline detail view (web)

8. **Entry point:** the drawer's existing "Open full detail →" affordance becomes active and opens
   the detail as a **full-width overlay** over the viewer (the table is too narrow for a timeline).
   Closing returns to the browse table with selection intact.
9. **Shared time axis** spanning `0 … matchEnd` (seconds; the whole match fits the width — no
   zoom/pan in v1). Everything below shares this axis.
10. **GO-window bands** (the anchor): one translucent band per `offensiveWindows` entry from
    `startSec`→`endSec`, spanning all lanes. **Color** = *lethal* (red) if a friendly **death**
    (`timeline` `death` event for a `defendingTeam` unit) falls within the window, else *handled*
    (green). Label shows the window index.
11. **Event lanes** (from the extended `timeline: TimelineEvent[]` + `losDisruptors`), positioned by
    `tSec`:
    - **You · casts** (kind `cast`, recording player),
    - **Kicks** (kind `interrupt`): landed-by-you (`unitId` = you/your pet) vs. you-got-kicked
      (`targetId` = you) — distinct markers, now that interrupts carry a target,
    - **CC** (kind `cc`): done by you (`unitId` = you) vs. taken (`targetId` = you), colored by DR
      `category`,
    - **LoS / smoke** (`losDisruptors`),
    - **Deaths** (kind `death`).
    The **CD/defensive timing** that the wireframe sketched as its own lane is folded into the
    GO-window panel ("mitigation available vs used") rather than a separate v1 lane — that's where
    "did you press a defensive during the GO" is most legible. A dedicated CD lane is deferred.
12. **Range lane:** a continuous line of `rangeSeries` (distance to primary threat), with a **melee
    reference line at 8 yd**; gaps where `dist` is null are not interpolated.
13. **Interaction:** clicking a GO-window band opens a **detail panel** (below the timeline) for that
    window — severity (`teamDamageTaken`, `damageByTarget`), mitigation `available` vs `used`,
    `counterPlay`, `positioning`, `lineOfSight`. Hovering any event marker shows a **tooltip**
    (time, unit, spell). Selection of a window is local view state.

## Architecture

```
ingest: computeMatchMetrics ──► upsertMatch ──► match_detail(metrics_json)   [re-ingest]
                                                       │
viewer:  GET /api/matches/:id/detail ── loadMatchDetail(db,id) ─┐
           • parse metrics_json                                  │ distanceAt over positionTracks
           • build rangeSeries (player ↔ primary threat) ────────┘
           → { metrics, rangeSeries }
                                                       │
web/ SPA:  drawer "Open full detail" ──► DetailView overlay
             • TimelineAxis  • GoWindowBands  • EventLanes  • RangeLane  • WindowPanel + tooltips
```

- **`src/metrics/timeline.ts` + `types.ts`** — `TimelineKind` gains `'cc'`; `TimelineEvent` gains
  `targetId?`/`targetName?`; `buildTimeline` records interrupt/CC targets and emits player-on-player
  `cc` events.
- **`src/store/schema.ts`** — `match_detail` table (additive; `migrate()` already idempotent).
- **`src/store/store.ts`** — write `metrics_json` in `upsertMatch`'s transaction.
- **`src/viewer/queries.ts`** — `loadMatchDetail(db, id)`; `buildRangeSeries(metrics)` helper using
  `distanceAt`.
- **`src/viewer/server.ts`** — route `GET /api/matches/:id/detail` (404 when absent).
- **`web/src/api.ts`** — `fetchMatchDetail(id)`; `MatchDetail`/`RangePoint` types mirrored.
- **`web/src/components/DetailView.tsx`** (+ small lane/band/panel subcomponents) — the overlay.
  `SummaryDrawer.tsx` wires its "Open full detail" affordance to open it.

## Data flow & error handling

- Select match → drawer → **Open full detail** → `fetchMatchDetail(id)` → render overlay. Loading
  and fetch-error states surfaced (consistent with the foundation's API-error handling).
- **No detail row** (pre-re-ingest match) → 404 → overlay shows "Re-ingest to view this match's
  detail (`npm run ingest-db`)".
- **Sparse positions** → range line shows gaps (null), not zeros. Windows with no `positioning`/
  `lineOfSight` simply omit those panel rows.
- **Empty timeline / no windows** → axis still renders; lanes show "no events".

## Testing (TDD throughout)

- **Metrics:** `buildTimeline` emits `cc` events for player-on-player CC (with target + category),
  records interrupt targets, and rolls pet-cast CC to the owner; non-player / pet-target CC is
  excluded — mirroring the `ccSides` rules.
- **Store (sqlite-flagged):** `upsertMatch` persists `match_detail.metrics_json`; re-upsert
  overwrites (idempotent); round-trips back to an equal object.
- **Viewer (sqlite-flagged):** `loadMatchDetail` returns the parsed metrics; `buildRangeSeries`
  picks the top-damage enemy and produces `{tSec,dist}` with nulls on gaps; the endpoint returns
  `{metrics, rangeSeries}` and **404** when no detail row exists.
- **Web (jsdom):** GO-window bands render from `offensiveWindows` with lethal/handled coloring;
  event lanes place markers by `tSec`; the range line + 8-yd reference render; clicking a window
  opens its panel with the right numbers; hovering an event shows a tooltip; the 404 → "re-ingest"
  empty state renders.

SQLite-touching tests use `NODE_OPTIONS=--experimental-sqlite … --no-file-parallelism`; web tests
run inside `web/`.

## Explicitly NOT in this increment (deferred)

- **2-D spatial replay** (positions are now stored, but the map render + occupancy overlay is its
  own project).
- **Zoom/pan / time scrubbing** (v1 fits the whole match to the panel width).
- A separate **enemy-casts** lane and per-enemy range lines (v1 = one range line vs. the primary
  threat).
- Sub-project **C** (baselines & comparison) and the **GO verdict-synthesis** capstone.

## Self-review notes

- *Placeholders:* none — the table, the endpoint shape, the range definition (top-damage enemy via
  `distanceAt`), the lanes (mapped to `TimelineEvent.kind` / `losDisruptors`), the band coloring
  rule (friendly death within window), and the test surfaces are concrete.
- *Consistency:* all timeline data is `tSec`/`startSec`-based (no ms/sec mixing); the detail blob is
  the same `MatchMetrics` the report and `--replay` already serialize; the viewer stays read-only
  apart from the additive `match_detail` write.
- *Scope:* one increment over the existing store + viewer; replay, zoom, and comparison are
  explicitly deferred. The substrate (re-ingest) and the view are separable and will phase in the
  plan.
- *Ambiguity:* "primary threat" = highest-`damageDone` enemy player; "handled vs lethal" = a
  friendly death inside the window; "full detail" opens as a full-width overlay — each stated
  explicitly.
