# Match Viewer — Foundation + Browser — Design Spec

**Status:** design locked (2026-06-05)
**Sub-project:** A of 3 in the **Arena Match Viewer** effort (a GUI to browse, inspect,
and compare ingested arena matches — replacing the command-line scorecard for everyday use).
**Depends on:** the match store (PR #16 — `src/store/`, `node:sqlite`) and the comparative
scorecard (PR #17 — `src/scorecard/`), both merged to master.

## The larger effort (decomposition)

A full wowarenalogs-style viewer decomposes into three independently-shippable sub-projects,
each with its own spec → plan → build:

- **A — Foundation + match browser (THIS SPEC).** React+Vite SPA scaffold, a Node API server
  over the store, session detection, and a filterable/sortable match list grouped by
  queue-session. End state: launch the viewer and browse/filter your history.
- **B — Full per-match detail.** A detail endpoint (on-demand re-parse of a match's source log
  → structured `MatchMetrics` JSON) + full **native-React** rendering of every metric (teams,
  timeline, CC, cooldowns, positioning, LoS). Sits on A's shell.
- **C — Baselines & comparison.** A recency/session **baseline** model that generalises the
  scorecard cohort (last N matches, past X days, this-session-vs-previous, same-comp-yesterday-
  vs-today, time-of-day) + interactive scorecard-vs-baseline, two-match side-by-side diff, and
  metric trend-over-time. Reuses A's `sessionize` module.

B and C are independent of each other; both build on A. Spatial replay (map playback of
positions/LoS) is a separate, later project and is out of scope for all three.

## Goal (sub-project A)

Stand up a local web app that lists the recording characters' ingested matches from the store,
lets the user filter/sort them and see them grouped into **queue-sessions**, and shows a
lightweight per-match summary on selection. This is a **read-only** view over the existing
store — no new ingestion, no schema changes. It is the shell that B (detail) and C (comparison)
extend.

## Locked design decisions

1. **App shape.** Local web app: a **Node API server** that reads the store, plus a **React +
   Vite SPA** for the UI. The SPA's toolchain (Vite, JSX, DOM `tsconfig`) is isolated under
   `web/` so the existing buildless Node code (`tsc`/Vitest over `src/`) is unaffected.
2. **Frontend stack.** React 18 + Vite + TypeScript, hand-rolled CSS dark theme (no UI
   framework in v1). Per-match detail (sub-project B) will be full native React — so v1 lays
   the SPA foundation it builds on.
3. **Server.** Node built-in `http` (≈4 endpoints; no Express). Runs via tsx with
   `--experimental-sqlite` (same pattern as `ingest-db`). Serves `web/dist` in production; in
   dev, Vite serves the UI and proxies `/api` to this server.
4. **Sessions.** A **queue-session** is a maximal run of one character's matches where the idle
   gap between the **end of one match and the start of the next** is below a threshold. End of a
   match = `start_ms + duration_sec * 1000`. Default threshold **30 minutes**, configurable in
   `config.json` (`sessionGapMinutes`). Sessions are computed **per character** over that
   character's whole history, so session identity is stable and a session header always reflects
   its **full** record even when the visible rows are filtered.
5. **Browser columns.** Headline columns are discriminating scalars: When, Result (W/L), My
   comp, Enemy comp, Map, Rating (+Δ), Damage, DPS, Kicks. **Deaths is deliberately excluded** —
   a death is essentially a restatement of the result (whoever scored the kill won), except the
   rare cross-kill, so it carries almost no information beyond W/L. (This is also a signal for
   sub-project C: deaths is a weak "how did I play" discriminator because it is
   outcome-determined.)
6. **Layout.** Dense table + persistent left filter rail (wowarenalogs-like). Sessions appear as
   separator/header rows within the table (not collapsible groups in v1). Clicking a row opens a
   right-side **summary drawer** of the scalar stats the store already holds; "Open full detail"
   (B) and "Compare to history" (C) are visible-but-inert affordances in A.

## Architecture

```
                       config.json (dbPath, sessionGapMinutes)
                                  │
  SQLite store ──openDb──► src/viewer/server.ts ──/api──► web/ (React+Vite SPA)
  (match, combatant,        (Node http, read-only)         FilterRail · MatchTable
   metric, dataset_export)        │                         SessionSeparator · SummaryDrawer
                                  ├── sessionize()  (src/store/sessions.ts, pure)
                                  ├── query builder (filters → SQL params)
                                  └── label resolvers (specs.ts, arenas.ts)
```

- **`web/`** — the React + Vite + TS app. Own `package.json`, `tsconfig` (jsx, DOM, bundler
  resolution), `vite.config.ts`. Builds to `web/dist`. Has its own Vitest + Testing
  Library/jsdom setup.
- **`src/viewer/server.ts`** — the Node API server. Built-in `http`; opens the store via the
  existing `openDb`; serves `web/dist` statically in production.
- **`src/store/sessions.ts`** — `sessionize(matches, gapMs)` pure module (shared so C reuses it).
- **`src/metadata/specs.ts`**, **`src/metadata/arenas.ts`** — pure label lookups.
- **Scripts** (root `package.json`):
  - `viewer` — build `web` then run the server serving `web/dist` + `/api`; prints the localhost
    URL. (`node --experimental-sqlite --import tsx src/viewer/server.ts`, with a prior `vite build`.)
  - `viewer:dev` — a small `scripts/viewer-dev.mjs` that spawns the API server (tsx) and `vite`
    together (Vite dev server proxies `/api` → API port). No `concurrently` dependency.

## Data & session model

- **Source.** The `match` table + the existing `dataset_export` view (already exposes result,
  `ally_comp_sig`/`enemy_comp_sig`, `player_rating`, `zone_id`, `damageDone`, `dps`,
  `interruptsLanded`, `ccDone_hardCcSec`, etc.) plus `duration_sec` and `player_name` from
  `match`. No new ingestion or schema change.
- **`sessionize(matches, gapMs): Session[]`** — pure. Input is one character's matches (it is
  called per character). Sort by `start_ms`; walk in order; start a new session when
  `nextStartMs − prevEndMs > gapMs`, where `prevEndMs = prevStartMs + prevDurationSec*1000`
  (fall back to `prevStartMs` when duration is null). Each `Session`:
  `{ id, character, startMs, endMs, count, wins, losses, ratingStart, ratingEnd, comps: string[] }`
  (`id` = the session's first match id; `ratingStart/End` = first/last non-null rating;
  `comps` = distinct ally comp labels in the session). Matches carry their `sessionId`.
- **Global identity.** Sessions are computed over the character's **full** match list, then the
  filtered match set is grouped under those sessions; a session header shows the session's full
  `wins/losses/ratingDelta`, independent of the active filters.

## Backend API (read-only)

- `GET /api/filters[?character=]` → values to populate the rail:
  `{ characters[], brackets[], myComps[], enemyComps[], maps[], seasons[], ratingRange:{min,max}, dateRange:{minMs,maxMs} }`.
  Comps/maps returned as `{ value, label }` (raw sig/id + resolved label).
- `GET /api/matches?character&bracket&myComp&enemyComp&map&result&minRating&maxRating&season&from&to&q&sort&order&limit&offset`
  → `{ matches: MatchSummary[], sessions: SessionSummary[], total }`.
  - `MatchSummary = { matchId, startMs, durationSec, bracket, character, mapId, mapName,
    allyComp, allyCompLabel, enemyComp, enemyCompLabel, rating, ratingDelta, result, sessionId,
    damageDone, dps, interruptsLanded }`. `ratingDelta` = this match's rating − the previous
    match's rating for that character (null if unknown).
  - `SessionSummary` mirrors `Session` above.
  - Filtering, sorting, and pagination happen in SQL (parameterised — no string interpolation of
    user input). `q` is a free-text match over comp labels / map name / enemy names.
- `GET /api/matches/:id` → the full scalar set for the summary drawer (all `dataset_export`
  columns for that match + duration + matchup labels). 404 if absent.
- **Static:** in production the server serves `web/dist` for non-`/api` paths (SPA fallback to
  `index.html`).

## Frontend (`web/` SPA)

- One screen in A: the browser, composed of `FilterRail`, `MatchTable` (interleaving
  `SessionSeparator` header rows), and `SummaryDrawer`. Routing is minimal (a single route);
  B/C add routes.
- **Filter state is held in the URL query** so a filtered view is shareable and back/forward
  works. Components fetch from `/api` and render; sorting is a column-header toggle that updates
  the query.
- **Styling:** hand-rolled CSS, dark theme consistent with the existing report. No component
  library in v1.

## Labeling (generated metadata + pure resolvers, unit-tested)

Spec and map names are sourced from authoritative WoW client **DB2 tables** (via wago.tools),
using the project's existing metadata-generator pattern — a script reads the DB2 CSV and writes
committed JSON, refreshed per patch like `import-cc-categories.mjs` / `import-cooldowns.mjs`.
They are **not** hand-curated lists.

- **Comp signatures → labels.** `comp_sig` is a sorted, `_`-joined list of **spec id** strings
  (WoW specialization ids, e.g. `265` = Affliction). `scripts/import-specs.mjs` reads wago.tools
  DB2 — `ChrSpecialization` (`/db2/ChrSpecialization/csv?build=<build>` → spec id, `Name_lang`,
  `ClassID`) joined with `ChrClasses` (class `Name_lang`) — and writes committed
  `src/metadata/specs.json` (`specId → { classId, className, specName }`). Runtime
  `src/metadata/specs.ts` is a pure lookup over that JSON and derives the short display form; a
  comp label is the joined per-spec short names (e.g. `Affli·RSham·Balance`). Refresh per patch:
  `WAE_DB2_BUILD=<build> node scripts/import-specs.mjs`. Exact CSV column names are confirmed at
  generator-build time. Well-known comp **nicknames** (RMP/TSG/WLS/…) remain an optional thin
  overlay and may be deferred.
- **Zone id → arena name.** Likewise generated, not curated: `scripts/import-maps.mjs` reads the
  DB2 `Map` table (`/db2/Map/csv?build=<build>`, `MapName_lang`) → committed
  `src/metadata/arenas.json`, read by a pure `src/metadata/arenas.ts`. Unknown id → render the
  raw id. (The generator can be scoped to the arena map ids we have / encounter; it expands as
  new arenas appear.)

## Error handling

- Empty or missing store → endpoints return empty arrays; the UI shows an empty state
  ("No matches yet — run `npm run ingest-db -- <logsDir>`").
- Server started without `--experimental-sqlite` → fail fast with a clear message (the store
  loader already requires the flag).
- Unknown/garbage filter params → ignored or clamped; never a 500.
- A match id not present on `GET /api/matches/:id` → 404 with a short JSON error.

## Testing

TDD throughout (per the project's global rule). Two test surfaces:

- **Server/logic (root Vitest).** `sessionize` (end-to-start gap grouping, per-character,
  session summaries, null-duration fallback); the **query builder** (each filter → correct
  parameterised SQL, injection-safe, sort/order/pagination); the **label resolvers**
  (`specs.ts`, `arenas.ts`, unknown-value fallthrough); the **endpoint handlers** seeded against
  an in-memory `:memory:` store (filters, session grouping, drawer payload, 404). SQLite-touching
  tests run with `NODE_OPTIONS=--experimental-sqlite npx vitest run <file> --no-file-parallelism`;
  never a bare `npx vitest run` (it oversubscribes workers and hangs).
- **Frontend (`web/` Vitest + Testing Library/jsdom).** Component tests: filter change → query
  update, session-grouped rendering, summary-drawer open/content, empty state.

## Explicitly NOT in v1 (deferred)

Full native-React per-match detail (sub-project B); scorecard-vs-baseline, two-match diff,
trend-over-time, and the recency/session **baseline cohort** that extends the scorecard
(sub-project C, which reuses A's `sessionize`); comp nickname dictionary beyond a thin optional
overlay; spatial replay (separate project); any write path or schema change.

## Self-review notes

- **Placeholders:** none — modules, endpoints, the session rule, columns, and the test surfaces
  are concrete.
- **Consistency:** read-only over the existing store; sessions defined once (end-to-start gap,
  30 min default, per character, global identity) and used by both the list grouping and the API;
  comp/map labels resolved server-side in one place; the `web/` toolchain is isolated from the
  Node build.
- **Scope:** one coherent sub-project (foundation + browser). Detail (B) and comparison (C) are
  explicitly deferred and named, and A ships the `sessionize` module C depends on.
- **Ambiguity:** "session" (end-to-start idle gap, configurable, per character), "deaths
  excluded" (outcome-determined), and "global session identity vs filtered rows" are each made
  explicit.
