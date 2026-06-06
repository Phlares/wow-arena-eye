# Match Browser v2 + Data-Quality Fixes — Design Spec

**Status:** design locked (2026-06-05)
**Sub-project:** the next increment of the **Arena Match Viewer** (after sub-project A,
match-viewer foundation, PR #18). Folds in direct user feedback after running the viewer on
real data. The full per-match **detail view** (originally "sub-project B") is deferred to a
later increment — this feedback does not touch it.
**Depends on:** the match store (`src/store/`), the scorecard (`src/scorecard/`), and the
viewer foundation (`src/viewer/`, `web/`), all merged to master.

## Goal

Make the match browser genuinely useful on real data, and fix the data-quality gaps that
running it surfaced. Two layers:

- **Data substrate** (store + ingest; requires a one-time re-ingest): capture the player's
  **true rating (CR)**, capture **build_version**, and persist **pet-attributed metrics** so a
  warlock's pet Spell Lock counts as the player's kick (also corrects the scorecard).
- **Browser features** (viewer only): rating deltas computed **chronologically** (not relative
  to the filter), **sort within folds**, a **sum + average totals** footer over the filtered
  scope, an inclusive **class→spec comp filter** (ally + enemy), and a top-level
  **game-version fold**.

This stays **read-only over the store** apart from the additive schema columns and the ingest
write-path; no breaking changes to existing tables.

## Findings that motivate the data layer (verified on the 160-match corpus)

- **"Kicks = 0" is a pet-attribution gap, not a viewer bug.** The recording warlock's own
  `interruptsLanded` is 0 because Spell Lock is cast by the **Felhunter pet**; the store
  persists only the player *unit's* metrics. The grouped `computeMatchMetrics` already computes
  combined player+pet totals — they just aren't what `extractMetricRows` persists.
- **The displayed "rating" is MMR, not CR.** `match.player_rating` is stored from the log's
  end-of-match **team MMR** (e.g. 2110). The player's true rating is the combatant's
  `info.personalRating` (e.g. 1834) — ~276 points lower. `playerTeamRating` from the parser is
  *also* MMR, so it is not the CR source.
- **`build_version` is NULL for every match** — `ingest-db` never passes it. The parser does
  parse it from the log header (`COMBAT_LOG_VERSION,…,BUILD_VERSION,<v>,…`); these logs are
  `"12.0.5"` (major patch granularity — exactly right for the fold).
- **`combatant` rows carry each player's `spec` and `team` (friendly/enemy)**; class is
  derivable from spec via `specs.json`. So the class→spec filter needs no new ingestion.

## Locked design decisions

### A. Data substrate (store + ingest, then re-ingest)

1. **CR.** Add `match.player_cr INTEGER` — the recording player's `info.personalRating`.
   `player_rating` is **kept as the team MMR** (with a clarifying comment) and `enemy_mmr` as
   theirs. Each match thus carries CR + MMR. CR is best-effort: if `personalRating` is absent or
   0 (unrated/skirmish), `player_cr` is null and the viewer omits CR for that match.
2. **build_version.** Add `match.build_version` capture: thread the parser's parsed build into
   `ingest-db` → `upsertMatch` opts (the column already exists in the schema; only the ingest
   wiring is missing).
3. **Pet-attributed metrics.** For the recording player's persisted metric rows, use the
   **combined player+pet** values from the grouped `MatchMetrics` (the model already decides the
   per-metric combine rules — throughput and interrupts include pets; deaths stay player-only).
   This corrects `interruptsLanded` (and any other pet-contributed metric) in the store, the
   viewer, **and** the scorecard simultaneously. Implementation lives in `metricRows.ts` /
   `store.ts`; the grouped model is the source of truth for what "combined" means per metric.
4. **Re-ingest.** `upsertMatch` is idempotent (delete-then-insert keyed on match id), so
   re-running `npm run ingest-db -- <logs>` backfills CR, build_version, and corrected metrics
   with no duplicates. No migration script beyond the additive `player_cr` column (the schema's
   `IF NOT EXISTS` / `ALTER TABLE ADD COLUMN` handles it).

### B. Rating model (CR + MMR, chronological deltas)

5. The viewer shows **CR** and **MMR** columns, each with a **delta**.
6. **Delta semantics:** computed against **the previous game by the same character in the same
   bracket**, chronologically, over **full history — independent of the active filters**. If
   there is no such prior game (the first game for that character+bracket), the delta is
   **omitted** (not rendered as a swing). This applies to both CR and MMR.
7. This moves delta computation out of the generic `loadViewerMatches` (where it was
   filter-relative) into a dedicated, (character, bracket)-keyed chronological enrichment over
   full history.

### C. Comp filter (class→spec, inclusive, ally + enemy)

8. Replaces the exact `myComp`/`enemyComp` dropdowns. Two **popover** trees in the rail —
   **My team** and **Enemy** — each a class→spec checkbox tree **organized by class**, populated
   only with classes/specs present in the data.
9. A **class** checkbox means "any spec of this class"; an expanded **spec** checkbox means that
   spec. Selecting more = **wider** net (OR / union), within and across classes.
10. **Query:** a match qualifies if a combatant on the relevant team (`friendly` for My team,
    `enemy` for Enemy) has a spec in the selected set:
    `EXISTS (SELECT 1 FROM combatant c2 WHERE c2.match_id = m.match_id AND c2.team = ? AND c2.spec IN (…))`.
    The server **expands a checked class to its specs** via `specs.json` and unions them with the
    checked specs. New filter params replace `myComp`/`enemyComp`: `allySpecs`, `allyClasses`,
    `enemySpecs`, `enemyClasses` (comma-separated). Ally and enemy are independent filters.
11. The class→spec tree options come from `GET /api/filters` as the distinct (class, spec) pairs
    present in the store's combatant rows, grouped by class.

### D. Sort, totals, folds (viewer)

12. **Sort within folds.** Clickable column headers (When, CR, MMR, Dmg, DPS, Kicks, …) reorder
    **rows within each fold**, client-side (no pagination, so all rows are present). Folds stay;
    a neutral header state restores chronological order. Click toggles asc/desc.
13. **Totals footer (sum + average, filtered scope).** A two-line footer over the current
    filtered set: a **Σ (sum)** row and an **avg** row across numeric columns (Dmg, DPS, Kicks).
    CR/MMR show **avg only** (a sum is meaningless). The result column shows the **W–L record**.
14. **Game-version fold.** A top-level **collapsible group by `build_version`** (e.g. "12.0.5"),
    with the existing **session** sub-headers nested inside (a session never spans a patch, so it
    nests cleanly). The version header shows the build plus a games/date summary; collapsing
    folds away a whole patch. Sessions remain inline separators within a version group.

## Architecture

```
LOG ──parser──► ingest-db ──► upsertMatch (CR + build_version + combined player+pet metrics)
                                   │
  store: match(+player_cr,         ▼
   build_version), combatant ──► src/viewer/queries.ts ──/api──► web/ SPA
   (spec, team), metric            • comp-filter EXISTS + class→spec expansion       FilterRail
                                    • chronological CR/MMR deltas (char+bracket)      + CompFilterTree (popover)
                                    • CR/MMR/build_version on MatchSummary            MatchTable (version fold,
                                    • class→spec tree in filter options                session folds, sortable,
                                                                                       totals footer)
```

- **`src/store/schema.ts`** — add `player_cr` column (additive; `ALTER TABLE … ADD COLUMN` guard
  for existing DBs). `dataset_export` view unchanged in shape (it already reads the player
  combatant's metric rows, which now carry combined player+pet values).
- **`src/store/metricRows.ts` / `store.ts`** — persist combined player+pet metrics for the
  recording player; capture `player_cr` from the player combatant's `info.personalRating`.
- **`src/cli/ingest-db.ts`** — thread the parser's build version into `upsertMatch` opts.
- **`src/viewer/queries.ts`** — add CR/MMR/build_version to `MatchSummary`; replace the exact
  comp filters with the `EXISTS`-based class→spec filter (class expansion via `specs.json`);
  move ratingDelta to a dedicated chronological (character, bracket) enrichment over full
  history; extend `loadFilterOptions` with the grouped class→spec tree.
- **`src/viewer/server.ts`** — parse the new comp-filter params.
- **`web/`** — `CompFilterTree` popover component; sortable `MatchTable` headers (sort within
  folds); sum+avg totals footer; version-fold grouping wrapping sessions; CR + MMR columns with
  deltas.

## Data flow notes

- **ratingDelta** is no longer part of `loadViewerMatches`'s per-row output for the wire. It is
  computed by a `enrichRatingDeltas(db, matches)` step that, per (character, bracket), looks up
  each match's chronological predecessor over full history and attaches CR/MMR deltas. Filters
  never affect it.
- **Comp filter** is the only filter that joins beyond the `match` row; it uses a correlated
  `EXISTS` per team so multiple selected specs widen (the `IN` set grows).

## Error handling

- CR absent/0 → `player_cr` null; the viewer shows "—" for CR and omits its delta.
- A spec id with no `specs.json` entry → shown under an "Unknown" class bucket in the tree; the
  filter still matches by raw spec id.
- Empty comp-filter selection → no comp constraint (all matches), same as today's "All".
- Re-ingest over already-present matches → idempotent overwrite (no duplicates).

## Testing

TDD throughout (project rule). Two surfaces, same as the foundation:

- **Store/query (root Vitest, sqlite-flagged):** `player_cr` capture and combined player+pet
  metric persistence (seed a match with a pet unit, assert the player's persisted
  `interruptsLanded` includes the pet's); `build_version` capture; the `EXISTS` class→spec comp
  filter (ally + enemy, class-expansion, union semantics); the chronological (character, bracket)
  CR/MMR delta enrichment (incl. the no-prior-game → omitted case and filter-independence); the
  class→spec tree in filter options. SQLite-touching tests run with
  `NODE_OPTIONS=--experimental-sqlite … --no-file-parallelism`.
- **Web (web/ Vitest + jsdom):** `CompFilterTree` (class checkbox = any-spec, spec checkbox,
  union, ally/enemy separation, emits the right params); sortable headers reorder within folds;
  the sum+avg totals footer; the version fold wrapping session folds; CR + MMR columns render
  with chronological deltas (and omit when absent).

## Explicitly NOT in this increment (deferred)

Full per-match **detail view** (native-React rendering of `MatchMetrics`); the recency/session
**baseline comparison** (scorecard-vs-baseline, two-match diff, trend); enemy CR (the log
exposes the player's reliably; enemy personal ratings are out of scope); switching the
**scorecard's** rating-band scope from MMR to CR (a separate scorecard decision — only the
pet-kick correction flows there automatically); pagination (so `q`+limit interaction stays
moot).

## Self-review notes

- *Placeholders:* none — schema columns, the metric-combine source, the filter query, the delta
  rule, and the test surfaces are concrete.
- *Consistency:* `player_rating` = MMR everywhere (documented), `player_cr` = CR; ratingDelta is
  defined once (character+bracket, chronological, filter-independent) and used for both CR and
  MMR; the comp filter's "more = wider" union is stated once and applied to both teams.
- *Scope:* one increment over the existing store + viewer; the detail view and baseline
  comparison are explicitly deferred. The data layer (re-ingest) and the viewer layer are
  separable and the plan will likely phase them.
- *Ambiguity:* "rating" (CR vs MMR, both shown), "previous game" (same character + same bracket,
  chronological, ignoring filters), "wider net" (OR/union over selected specs+expanded classes),
  and "fold" (version wraps session, version collapsible) are each made explicit.
```
