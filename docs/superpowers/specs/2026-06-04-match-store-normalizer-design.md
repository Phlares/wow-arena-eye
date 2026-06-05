# Match Store / Normalizer — Design Spec

**Status:** approved (brainstorm 2026-06-04)
**Sub-project:** A of 2 (the comparative scorecard is sub-project B, a later cycle)
**Builds on:** the per-match metrics pipeline (`computeMatchMetrics`, PRs #12–#15)

## Goal

Persist normalized, queryable per-match records into a local SQLite database so that
many matches can be compared like-to-like. This is the substrate the **comparative
scorecard** (next cycle) reads to show "you're playing better/worse/average, and winning
better/worse/average" vs the player's own history — sliced by same map, same enemy comp,
rating band, time of day, season window, and win-vs-loss.

This spec covers **only the store + ingest**. The scorecard's query/baseline/delta/render
logic is sub-project B.

## Scope & explicit boundary

**In scope:** a SQLite store of `match`, `combatant`, and a long/narrow `metric` table,
plus a `dataset_export` view; an idempotent batch-ingest CLI; player identification;
sidecar enrichment.

**Known v1 boundary (acknowledged):** the store holds **scalar per-match / per-combatant
aggregates only**. The per-moment **timeline and position-sample** data is *not* persisted
— so per-moment comparison ("where was I at second 30 vs my average") is not yet possible.
This is the deliberate "no raw events" deferral; it is a *planned* future extension (a
`sample`/`event` table feeding off the same `match_id`), not an oversight. `start_ms` is
stored, so date / season / **time-of-day** slices are all derivable without it.

**Out of scope (sub-project B and beyond):** the scorecard queries and rendering; defining
"season"; raw event/position persistence; AI prose; external benchmarks.

## Architecture

A new `src/store/` module, three single-responsibility units, plus one CLI:

- **`src/store/schema.ts`** — owns the schema. Exports `SCHEMA_SQL` (DDL) and
  `migrate(db)` that runs it (`CREATE TABLE/INDEX/VIEW IF NOT EXISTS`). The one place
  table shape is defined.
- **`src/store/metricRows.ts`** — pure: `extractMetricRows(metrics, playerUnitId)` →
  `{ combatants: CombatantRow[]; metrics: MetricRow[] }`. Flattens `MatchMetrics` /
  `UnitMetrics` into `(scope, metric_id, value)` tuples and combatant identity. No DB, no
  I/O — the testable heart.
- **`src/store/resolvePlayer.ts`** — pure: `resolvePlayerUnitId(rawMatch, registry) → string | undefined`.
  Identifies *which of the user's characters* recorded this log (see "Player identification"
  below). No DB, no I/O.
- **`src/store/store.ts`** — `openDb(path)` (wraps `node:sqlite` `DatabaseSync` + `migrate`)
  and `upsertMatch(db, rawMatch, metrics, opts)` which writes one match idempotently in a
  transaction. `opts` carries the resolved player unit id and optional sidecar enrichment.
- **`src/cli/ingest-db.ts`** — `npm run ingest-db -- <dir...>`: for each `WoWCombatLog*.txt`
  in each dir, parse → `computeMatchMetrics` → resolve the recording character via
  `resolvePlayerUnitId(match, config.players)` → `upsertMatch`. Prints an ingest summary.
  Runs under `--experimental-sqlite`.

The existing `view` / `ingest` per-log paths are untouched.

### Why node:sqlite

Built into Node 22 (verified working here), synchronous (ideal for a CLI batch writer),
zero new dependencies (the project keeps a deliberately tiny dep surface). It is still
flagged experimental, so the npm script sets `--experimental-sqlite` and the one-line
warning is accepted. The schema is plain SQL, so swapping the binding later (e.g. to
better-sqlite3) would touch only `store.ts`'s `openDb`.

## Schema

```sql
CREATE TABLE IF NOT EXISTS match (
  match_id        TEXT PRIMARY KEY,   -- parser canonical hash (idempotency key)
  start_ms        INTEGER,
  start_iso       TEXT,
  bracket         TEXT,               -- '3v3' | '2v2' | 'Rated Solo Shuffle' | ...
  zone_id         TEXT,
  duration_sec    REAL,
  result          TEXT,               -- 'win' | 'loss' | 'unknown' (player's perspective)
  player_unit_id  TEXT,               -- the recording character's GUID this match
  player_name     TEXT,               -- e.g. 'Phlares-Stormrage-US' (which of my chars)
  player_spec     TEXT,               -- recording char's specId (per-class slicing)
  player_team_id  TEXT,
  winning_team_id TEXT,
  ally_comp_sig   TEXT,               -- sorted spec signature of player's team
  enemy_comp_sig  TEXT,               -- sorted spec signature of enemy team
  player_rating   INTEGER,            -- player team MMR (endInfo) or sidecar
  enemy_mmr       INTEGER,
  is_ranked       INTEGER,
  build_version   TEXT,               -- log BUILD_VERSION when available (patch stamp)
  video_path      TEXT,
  sidecar_path    TEXT,
  source_file     TEXT,               -- provenance: log filename
  ingested_ms     INTEGER,
  lines_unparsed  INTEGER             -- data-quality signal
);
CREATE TABLE IF NOT EXISTS combatant (
  match_id  TEXT, unit_id TEXT,       -- unit_id = in-game GUID
  name      TEXT, realm TEXT, class TEXT, spec TEXT,
  team      TEXT,                     -- 'friendly' | 'enemy' | 'neutral' (relative to me,
                                      --   from MatchMetrics.teams; raw teamId is junk-prone)
  is_player INTEGER,                  -- 1 = the recording character this match
  PRIMARY KEY (match_id, unit_id)
);
CREATE TABLE IF NOT EXISTS metric (
  match_id  TEXT,
  scope     TEXT,                     -- unit_id | 'team:friendly' | 'team:enemy' | 'match'
  metric_id TEXT,
  value     REAL,
  PRIMARY KEY (match_id, scope, metric_id)
);
CREATE INDEX IF NOT EXISTS ix_match_start    ON match(start_ms);
CREATE INDEX IF NOT EXISTS ix_match_enemycomp ON match(enemy_comp_sig);
CREATE INDEX IF NOT EXISTS ix_match_zone     ON match(zone_id);
CREATE INDEX IF NOT EXISTS ix_metric_lookup  ON metric(metric_id, scope);
-- dataset_export: one wide row per match for the recording player (identity + outcome +
-- pivoted player metrics). Column list grows as metrics are added; the metric TABLE never
-- changes shape. Defined with MAX(CASE WHEN metric_id=... ) over metric joined to the
-- player's combatant row.
```

The long/narrow `metric` table is the key decision: a new metric is one new `metric_id`
string, never a schema migration. `scope` distinguishes per-combatant, per-team, and
match-level values.

## Ingest pipeline

1. **Resolve the recording character** (`resolvePlayerUnitId(rawMatch, registry)`). The user
   plays many characters (several warlocks), so identity is **not** a hardcoded name — it is
   *whoever recorded this log*, resolved in priority order:
   1. **Parser auto-detect** — `rawMatch.playerId`, if it's a GUID present in `rawMatch.units`.
      The parser derives this from the advanced-logging owner, so it correctly identifies
      whichever character recorded the log, with zero config. (Verified on the fixture:
      `playerId = Player-60-0E38D99F`, name `Phlares-Stormrage-US`.)
   2. **Registry match** — else, the first unit whose GUID, or `name`/`name-realm`, appears in
      `config.players` (the user's known characters). This is the fallback for a log whose
      auto-detect is absent, and the guard that a stray non-user log isn't scored as "me".
   3. Else `undefined` → still ingested, flagged "no-player-found" in the summary; `is_player`
      is 0 for all and `result` falls to `'unknown'`.
   The resolved unit id is passed to `extractMetricRows` (sets `is_player`) and stored as
   `match.player_unit_id`; its `name`/`spec` populate `match.player_name`/`player_spec`.
2. **Outcome, computed from the raw teams (not the parser's player-relative `result` field).**
   `player_team_id` = the resolved player unit's raw `info.teamId`
   (`rawMatch.units[id].info.teamId`, fallback `rawMatch.playerTeamId` when the id is the
   auto-detected one); `result` = `'win'` iff `winning_team_id === player_team_id`, else
   `'loss'`, else `'unknown'` when either is missing. Robust regardless of the parser's own
   `result` enum. (Verified: fixture player teamId `1` === winningTeamId `1` → `win`.)
3. **Comp signatures.** `ally_comp_sig` / `enemy_comp_sig` = the sorted, joined spec list
   of each team (friendly vs hostile relative to the player), so "same enemy comp" is a
   string equality.
4. **MMR / rating.** From `endInfo` team MMRs by team id; fall back to sidecar when absent.
5. **Metric extraction.** `extractMetricRows` flattens `UnitMetrics` scalars per combatant
   (`damageDone`, `dps`, `casts`, `interruptsLanded`, `dispels`, `purges`, `spellsteals`,
   `ccDone.hardCcSec`/`ccDone.rootSec`/`ccDone.count`, `ccReceived.*`, `deaths`,
   `deathsWhileCcd`, `immuneReceived`, `meleeRangeSec`, `isolatedSec`, `distanceMoved`,
   `timeStationarySec`, `defensivesIntoBurst`, …) → `scope = unit_id`; team coordination
   (`alignmentFraction`, `alignedTimeSec`, `swaps`, `healerPressureDamage`) →
   `scope = team:friendly` / `team:enemy`; match-level → `scope = 'match'`.
   Nested fields flatten with dotted ids (`ccDone.hardCcSec`). The exact metric set is a
   declarative extractor list in `metricRows.ts` (one entry per metric id), so adding a
   metric is a one-line change.
6. **Sidecar enrichment.** Reuse `loadSidecarIndex(config.videoDirs)` once per run; for
   each match attach the nearest entry by `start_ms` within ±15 min → `video_path`,
   `sidecar_path`, and MMR if the log lacked it. Missing sidecar → null columns, never fatal.
7. **Idempotent upsert.** Keyed on `match_id`. In one transaction: `DELETE` this match's
   rows from `metric`, `combatant`, `match`, then `INSERT` fresh. Re-ingesting a directory
   never duplicates and always reflects the latest compute.
8. **Errors / summary.** Malformed or parse-failed matches are logged and skipped (never
   abort the run). The CLI prints: files scanned, matches ingested, skipped (malformed),
   no-player-found, no-sidecar. `lines_unparsed` stored per match as a data-quality signal.

## What the store enables for the scorecard (sub-project B)

All like-to-like slices the scorecard needs are columns or derivable here, confirming the
schema is sufficient:
- **same map** → `match.zone_id`; **same enemy comp** → `match.enemy_comp_sig`;
  **rating band** → `match.player_rating` bucketed; **win-vs-loss** → `match.result`;
  **time of day** → `HOUR(start_ms)` derived; **season window** → `start_ms` /
  `build_version` (season definition itself deferred to B).
- Per-metric baselines → `SELECT value FROM metric WHERE metric_id=? AND scope=<player>`
  joined to `match` filtered by the slice; the scorecard computes avg / season-best / split
  and the current-match delta. `dataset_export` gives the same as a convenient wide row.
- **Multi-character slicing** → `match.player_spec` lets the scorecard compare like-class
  ("my warlock matches") and `match.player_name` lets it go per-character; querying across
  all of them ("me, on anything") is just no character filter. The recording character is
  always identified per match (parser auto-detect + registry), never assumed.

## Testing

TDD, golden-style against the committed fixture (`test-data/fixtures/arena-sample.log`,
zone 1825). No private corpus; paths via config/env only.

- **`resolvePlayerUnitId`** — pure: a synthetic match with `playerId` set returns it
  (auto-detect path); with `playerId` absent but a unit GUID in the registry returns that
  (registry path); with neither returns `undefined`. Proves identification is character-
  agnostic, not hardcoded.
- **`extractMetricRows`** — pure unit tests on a synthetic `MatchMetrics` (full control of
  unit ids): assert specific tuples (a unit's `damageDone`, `deaths`), correct `scope`
  values, exactly one combatant flagged `isPlayer` for the given playerUnitId, a
  `team:friendly`-scoped `alignmentFraction` row, and `compSignatures` producing sorted
  ally/enemy spec strings.
- **`schema` / `store`** — ingest the real fixture into an in-memory `:memory:` DB (player
  resolved via auto-detect):
  - one `match` row: `bracket='3v3'`, `zone_id='1825'`, `result='win'`, `player_team_id='1'`,
    `player_name='Phlares-Stormrage-US'`, `player_spec='265'`, `player_rating=2425`;
  - 6 `combatant` rows, exactly one `is_player=1`;
  - the player's `damageDone` metric row = `2021381`;
  - `dataset_export` returns one row for the match with `damageDone=2021381`;
  - **idempotency**: ingesting the same match twice leaves all three tables' row counts
    unchanged.
- Type-check `npx tsc --noEmit`. Tests that touch `node:sqlite` (`schema`, `store`) run with
  the flag: `NODE_OPTIONS=--experimental-sqlite npx vitest run <file> --no-file-parallelism`
  (full `vitest run` oversubscribes/hangs). Pure tests (`resolvePlayer`, `metricRows`) need
  no flag.

## Self-review notes

- *Placeholders:* none — schema, ingest steps, and tests are concrete.
- *Consistency:* result is computed from `winning_team_id` vs the player's raw team
  everywhere; comp signatures defined once (sorted specs); `scope` vocabulary fixed
  (`unit_id`/`team:friendly`/`team:enemy`/`match`).
- *Player identity:* never hardcoded — resolved per match (parser auto-detect → registry →
  none), covering all of the user's characters. `config.player` (singular) is generalized to
  a `config.players` registry; `loadConfig` accepts either and normalizes to a list
  (a singular `player` becomes a one-element registry, so existing configs keep working).
- *Scope:* one subsystem (store + ingest); scorecard queries and "season" definition are
  explicitly sub-project B. The timeline/position gap is named as a deliberate boundary.
- *Ambiguity:* "result" precedence (team-computed, not parser `result`) and the idempotency
  strategy (delete-then-insert in a txn on `match_id`) are stated explicitly.
