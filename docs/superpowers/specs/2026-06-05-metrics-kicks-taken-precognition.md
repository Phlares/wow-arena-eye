# Metrics Increment: Kicks-Taken, Precognition Uptime, Ingest Default — Design Spec

**Status:** design locked (2026-06-05)
**Sub-project:** a small follow-up increment after **Match Browser v2** (PR #19). Folds in
three user requests gathered while reviewing #19. Branches off `master` **after #19 merges**
(it extends the v2 viewer + the metric substrate).
**Depends on:** the metric battery (`src/metrics/`), the match store (`src/store/`), the
scorecard (`src/scorecard/`), and the viewer (`src/viewer/`, `web/`), all on master (+ #19).

## Goal

Three independent, user-requested additions:

1. **Surface "kicks taken"** in the match browser. `interruptsSuffered` is already computed and
   persisted (it even drives the scorecard's "Own casts kicked") — it just isn't shown in the
   viewer. **No re-ingest needed** for this part.
2. **Track Precognition uptime**, two-sided like kicks: **on me** (the recording player's own
   Precognition buff) and **across all enemies** (summed over enemy players). A brand-new
   aura-uptime metric — **requires a one-time re-ingest**.
3. **No-arg `npm run ingest-db`** defaults to the configured log dir instead of erroring with a
   usage string (a previously-approved convenience; pairs nicely with the re-ingest above).

## Grounding (verified)

- **`interruptsSuffered`** is a `UnitMetrics` field (`perUnit.ts`), persisted via
  `metricRows.ts` `UNIT_METRICS`, and read by `SCORECARD_METRICS`. The viewer's
  `loadViewerMatches` pivot (`src/viewer/queries.ts`) does **not** yet select it.
- **Precognition** is a single shared PvP-talent self-buff. Confirmed in real combat logs as
  **spell id `377362`**, applied to the caster (`SPELL_AURA_APPLIED … 377362,"Precognition",…,BUFF`,
  `srcId == destId`) and removed via `SPELL_AURA_REMOVED` — e.g. up `22:12:18.824` →
  `22:12:22.827` ≈ 4.0 s. Same id across specs (a warlock and a priest both emit `377362`).
- The aura-uptime primitive already exists: `auraState.intervalsOn(unitId)` →
  `unionSeconds(windows)` (`ccTime.ts`), with a per-instance `MAX_INSTANCE` clamp for
  applied-but-never-removed auras (the established robustness pattern).
- The scorecard's `loadPlayerMatches` (`src/scorecard/loadMatches.ts`) pivots **every** metric id
  generically (`pm.metrics[metric_id] = value`), so a new persisted metric reaches the scorecard
  with **no loader change** — only a `SCORECARD_METRICS` entry.
- `config.ts`: `sampleLogsDir` (required) and `liveLogsDir?` (optional).

## Locked design decisions

### A. Precognition metric (store + metrics; re-ingest required)

1. **Aura id is curated, refreshable metadata.** New `src/metadata/precognition.ts`:
   `PRECOGNITION_AURA_ID = 377362` (sourced from the vendored DB, verified on real logs) and
   `PRECOGNITION_MAX_INSTANCE_SEC = 8` (a generous cap over the ~4 s real duration, for
   unclosed auras — same idea as the CC model's `MAX_INSTANCE_MS`).
2. **Computation lives in a dedicated module**, mirroring `ccSides.ts`/`targeting.ts`. New
   `src/metrics/precognition.ts` `computePrecognition(units, auras, endMs)` →
   `Map<unitId, { selfSec: number; enemySec: number }>`:
   - `selfSec[u]` = `unionSeconds` of `intervalsOn(u)` filtered to `spellId === PRECOGNITION_AURA_ID`,
     each window's end clamped to `min(end, endMs, start + PRECOGNITION_MAX_INSTANCE_SEC*1000)`.
   - `enemySec[u]` = **sum** of `selfSec[v]` over all units `v` where `unitTeam(v) !== unitTeam(u)`
     **and** `unitKind(v) === 'player'` (Precognition is a player buff; pets/totems excluded).
     The **sum-across-enemies** convention matches how `ccDone` already aggregates across targets.
3. **`UnitMetrics` gains two fields:** `precognitionUptimeSec` (self) and
   `enemyPrecognitionUptimeSec` (enemy-team sum). `perUnit.ts` reads them from the map (player-only
   meaning when read for the recording player; values are computed for every unit but only the
   recording player's row is surfaced downstream). **No pet `combine`** — Precognition is never on
   a pet.
4. **Persisted** via two new `metricRows.ts` `UNIT_METRICS` entries (no `combine` flag):
   `precognitionUptimeSec`, `enemyPrecognitionUptimeSec`. Added to the `dataset_export` view's
   `MAX(CASE …)` columns for export completeness (alongside `interruptsSuffered`, which is also
   missing from the view today).
5. **Re-ingest** backfills the new metric idempotently (delete-then-insert by match id), same as
   the v2 batch.

### B. Viewer — kicks taken + Precognition (mostly no re-ingest)

6. **"Taken" column.** `interruptsSuffered` is threaded through: the `loadViewerMatches` pivot →
   `MatchSummary.interruptsSuffered` (+ `web/src/api.ts` mirror) → a new **sortable `Taken`**
   column in `MatchTable` immediately after `Kicks`, with its own Σ/avg footer entries and a
   "Kicks taken" row in `SummaryDrawer`. Needs **no re-ingest** (already persisted).
7. **Precognition in the drawer (not a table column).** `MatchSummary` also carries
   `precognitionUptimeSec` and `enemyPrecognitionUptimeSec` (pivoted from the store), surfaced only
   in `SummaryDrawer` as two rows — e.g. **"Precognition (you): 6.2s"** and
   **"Precognition (enemy): 12.4s"**. The dense browse table stays uncluttered. These values are
   null/`—` until the re-ingest runs.
8. **Sort/footer:** the `Taken` column participates in within-fold sort and the sum+avg footer
   exactly like the other numeric columns (it reuses the existing `COLS`/`sortRows`/footer
   machinery, including the session-fold reordering shipped in #19).

### C. Scorecard — descriptive Precognition (neutral polarity)

9. **New `neutral` polarity.** Extend `Polarity` to `'higher-better' | 'lower-better' | 'neutral'`
   and `Verdict` with `'descriptive'`. A `neutral` metric:
   - reports `value`, `mean`, `stdev`, and `z` (for context) but `verdictFor` returns
     `{ verdict: 'descriptive', z }` — never `better`/`worse`;
   - has `seasonBest = null` and `isNewBest = false` (no "best" direction);
   - is **excluded from win-likeness** (`winLikeness` forced to `'neutral'`).
   The CLI render shows the value + z with no good/bad styling.
10. **Two new `SCORECARD_METRICS` entries**, both `neutral`:
    `{ id: 'precognitionUptimeSec', label: 'Precognition uptime (s)', polarity: 'neutral' }` and
    `{ id: 'enemyPrecognitionUptimeSec', label: 'Enemy Precognition uptime (s)', polarity: 'neutral' }`.
    (`interruptsSuffered` is already a scorecard metric — unchanged.)

### D. Ingest convenience (no re-ingest)

11. **No-arg `ingest-db` defaults to config.** In `src/cli/ingest-db.ts` `main()`, when
    `process.argv.slice(2)` is empty, default to `[cfg.liveLogsDir ?? cfg.sampleLogsDir]` (prefer
    the live retail Logs, fall back to the sample corpus) instead of printing the usage string and
    exiting 1. An explicit `<dirs...>` argument still overrides. `ingestLogsIntoDb` itself is
    unchanged (already pure of argv). This makes the §A re-ingest a bare `npm run ingest-db`.

## Architecture

```
LOG ──parser──► metrics ──► store(metric rows) ──► queries ──/api──► web/ SPA
                  │                                  │                  MatchTable: + Taken col
   precognition.ts (self + enemy-sum uptime)         │                  SummaryDrawer: + Precog rows
   perUnit.ts: 2 new UnitMetrics fields              ▼
   metricRows.ts: 2 new persisted ids        scorecard/loadMatches (generic pivot — no change)
   metadata/precognition.ts: id 377362 + cap        │
                                                     ▼
                                          SCORECARD_METRICS: + 2 neutral entries
```

- **New files:** `src/metadata/precognition.ts` (curated id + cap), `src/metrics/precognition.ts`
  (`computePrecognition`).
- **Edited:** `src/metrics/{types,perUnit}.ts` (2 fields), `src/store/{metricRows,schema}.ts`
  (2 persisted ids + view CASEs), `src/viewer/{types,queries}.ts` (pivot `interruptsSuffered` +
  2 precog fields), `web/src/api.ts` + `web/src/components/{MatchTable,SummaryDrawer}.tsx`
  (Taken column + Precog drawer rows), `src/scorecard/{types,scorecard,render}.ts` (neutral
  polarity + 2 metrics), `src/cli/ingest-db.ts` (default dirs).

## Error handling

- **Precognition absent** (no buff this match) → `selfSec`/`enemySec` = 0 (a real "0 s"), not null.
- **Unclosed Precog aura** → clamped by `PRECOGNITION_MAX_INSTANCE_SEC`, same as the CC model.
- **Pre-re-ingest matches** (no precog metric row) → the viewer/scorecard see the id absent;
  `MatchSummary` precog fields are `null` and render `—`; the scorecard reports `insufficient`
  until re-ingested. (`interruptsSuffered`/Taken column work immediately, no re-ingest.)
- **No-arg ingest with no `liveLogsDir` and no `sampleLogsDir`** → `sampleLogsDir` is required by
  config, so the fallback is always defined; the usage error path is removed.

## Testing (TDD throughout)

- **Metrics (root Vitest):** `computePrecognition` — self uptime = union of the player's `377362`
  intervals (incl. the unclosed-aura clamp); enemy uptime = **sum** over enemy *player* units
  (pets/totems excluded; ally precog excluded); a match with no Precognition → 0/0. Wire-through:
  `perUnit` populates both `UnitMetrics` fields.
- **Store (sqlite-flagged):** the two precog ids persist on the player's metric rows; the
  `dataset_export` view exposes `interruptsSuffered` + both precog columns.
- **Viewer (sqlite-flagged):** `loadViewerMatches` pivots `interruptsSuffered` + both precog fields
  into `MatchSummary`.
- **Web (web/ Vitest + jsdom):** `MatchTable` renders a sortable `Taken` column with footer
  totals; `SummaryDrawer` shows "Precognition (you)" and "Precognition (enemy)" rows (and `—`
  when null).
- **Scorecard (sqlite-flagged):** a `neutral` metric yields a `descriptive` verdict, `seasonBest`
  null, `isNewBest` false, and `neutral` win-likeness; the two precog metrics appear.
- **CLI (root Vitest):** `ingestLogsIntoDb` already covered; add a unit test that the no-arg
  default selects `liveLogsDir ?? sampleLogsDir` (extract the dir-resolution into a tiny pure
  helper so it's testable without spawning a process).

SQLite-touching tests run with `NODE_OPTIONS=--experimental-sqlite … --no-file-parallelism`.

## Explicitly NOT in this increment (deferred)

- **Precognition as a main-table column** (drawer + scorecard only, per decision B7).
- **Per-target / per-enemy Precognition breakdown** (only the player's own + the enemy-team sum;
  a per-enemy table is out of scope).
- **camelCase spec-label fix** carried over from #19 (`BeastMastery` renders unspaced; needs an
  explicit override map because a blanket split mangles `Brewmaster`).
- The full per-match **detail view** and **baseline comparison** (still their own future specs).

## Self-review notes

- *Placeholders:* none — the aura id, the cap, the metric ids/labels, the polarity extension, the
  pivot wiring, the default-dir rule, and the test surfaces are all concrete.
- *Consistency:* "kicks taken" = `interruptsSuffered` everywhere; Precognition is two-sided
  (self + enemy-team **sum**, matching `ccDone`'s cross-target sum); `neutral` polarity is defined
  once and applied to both precog metrics. `player_rating` = MMR convention from #19 is untouched.
- *Scope:* one small increment; no schema breakage beyond additive metric rows; the viewer and
  scorecard reuse existing pivots/footer/sort machinery.
- *Ambiguity:* "across all enemies" is fixed as the **sum** over enemy *player* units; "time" is
  union-seconds with the standard unclosed-aura clamp; the no-arg ingest default prefers
  `liveLogsDir`.
