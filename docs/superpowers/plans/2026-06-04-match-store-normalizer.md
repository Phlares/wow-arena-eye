# Match Store / Normalizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist normalized per-match records (identity + per-combatant/team scalar metrics) into a local SQLite store so many matches can be compared like-to-like — the substrate the comparative scorecard reads.

**Architecture:** A `src/store/` module: `schema.ts` (DDL + migrate), `resolvePlayer.ts` (identify which of the user's characters recorded a match), `metricRows.ts` (pure `MatchMetrics`→tuples), `store.ts` (open DB + idempotent `upsertMatch`). A `src/cli/ingest-db.ts` batch CLI ties parse→metrics→resolve→upsert. Uses Node 22's built-in `node:sqlite` (synchronous), so no new dependency.

**Tech Stack:** TypeScript ESM (NodeNext, local imports end `.js`), `node:sqlite` (needs `--experimental-sqlite`), Vitest, tsx. Spec: `docs/superpowers/specs/2026-06-04-match-store-normalizer-design.md`.

**Commands (this machine):**
- Type-check: `npx tsc --noEmit`
- Pure tests (no sqlite): `npx vitest run test/<file> --no-file-parallelism`
- SQLite tests: `NODE_OPTIONS=--experimental-sqlite npx vitest run test/<file> --no-file-parallelism`
- NEVER bare `npx vitest run` / `npm test` (oversubscribes workers and hangs).

---

## File Structure

- **Create** `src/store/schema.ts` — `SCHEMA_SQL` + `migrate(db)`.
- **Create** `src/store/resolvePlayer.ts` — `resolvePlayerUnitId(rawMatch, registry)`, `PlayerRef`.
- **Create** `src/store/metricRows.ts` — `extractMetricRows`, `compSignatures`, `CombatantRow`, `MetricRow`.
- **Create** `src/store/store.ts` — `openDb`, `upsertMatch`, `UpsertOpts`.
- **Create** `src/cli/ingest-db.ts` — `ingestLogsIntoDb` + `main`.
- **Modify** `src/config.ts` — add `players: PlayerIdentity[]` registry (normalized from `player`/`players`).
- **Modify** `package.json` — add `ingest-db` script.
- **Create** tests: `test/storeSchema.test.ts`, `test/resolvePlayer.test.ts`, `test/metricRows.test.ts`, `test/store.test.ts`, `test/ingestDb.test.ts`, `test/configPlayers.test.ts`.

---

## Task 1: Schema (`schema.ts`)

**Files:**
- Create: `src/store/schema.ts`
- Test: `test/storeSchema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/storeSchema.test.ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/store/schema.js';

describe('store schema', () => {
  it('creates the match/combatant/metric tables and dataset_export view', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const objs = db
      .prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table','view')")
      .all()
      .map((r) => `${(r as { type: string }).type}:${(r as { name: string }).name}`);
    expect(objs).toContain('table:match');
    expect(objs).toContain('table:combatant');
    expect(objs).toContain('table:metric');
    expect(objs).toContain('view:dataset_export');
  });

  it('migrate is idempotent (IF NOT EXISTS)', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    migrate(db); // must not throw
    expect((db.prepare('SELECT count(*) AS c FROM match').get() as { c: number }).c).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `NODE_OPTIONS=--experimental-sqlite npx vitest run test/storeSchema.test.ts --no-file-parallelism`
Expected: FAIL — cannot find `../src/store/schema.js`.

- [ ] **Step 3: Implement `src/store/schema.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';

/** All DDL for the match store. `IF NOT EXISTS` everywhere so migrate() is idempotent. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS match (
  match_id        TEXT PRIMARY KEY,
  start_ms        INTEGER,
  start_iso       TEXT,
  bracket         TEXT,
  zone_id         TEXT,
  duration_sec    REAL,
  result          TEXT,
  player_unit_id  TEXT,
  player_name     TEXT,
  player_spec     TEXT,
  player_team_id  TEXT,
  winning_team_id TEXT,
  ally_comp_sig   TEXT,
  enemy_comp_sig  TEXT,
  player_rating   INTEGER,
  enemy_mmr       INTEGER,
  is_ranked       INTEGER,
  build_version   TEXT,
  video_path      TEXT,
  sidecar_path    TEXT,
  source_file     TEXT,
  ingested_ms     INTEGER,
  lines_unparsed  INTEGER
);
CREATE TABLE IF NOT EXISTS combatant (
  match_id  TEXT,
  unit_id   TEXT,
  name      TEXT,
  realm     TEXT,
  class     TEXT,
  spec      TEXT,
  team      TEXT,
  is_player INTEGER,
  PRIMARY KEY (match_id, unit_id)
);
CREATE TABLE IF NOT EXISTS metric (
  match_id  TEXT,
  scope     TEXT,
  metric_id TEXT,
  value     REAL,
  PRIMARY KEY (match_id, scope, metric_id)
);
CREATE INDEX IF NOT EXISTS ix_match_start     ON match(start_ms);
CREATE INDEX IF NOT EXISTS ix_match_enemycomp ON match(enemy_comp_sig);
CREATE INDEX IF NOT EXISTS ix_match_zone      ON match(zone_id);
CREATE INDEX IF NOT EXISTS ix_metric_lookup   ON metric(metric_id, scope);
CREATE VIEW IF NOT EXISTS dataset_export AS
SELECT m.match_id, m.start_ms, m.bracket, m.zone_id, m.result,
       m.ally_comp_sig, m.enemy_comp_sig, m.player_rating, m.player_spec,
       MAX(CASE WHEN x.metric_id = 'damageDone'        THEN x.value END) AS damageDone,
       MAX(CASE WHEN x.metric_id = 'dps'               THEN x.value END) AS dps,
       MAX(CASE WHEN x.metric_id = 'healingDone'       THEN x.value END) AS healingDone,
       MAX(CASE WHEN x.metric_id = 'deaths'            THEN x.value END) AS deaths,
       MAX(CASE WHEN x.metric_id = 'deathsWhileCcd'    THEN x.value END) AS deathsWhileCcd,
       MAX(CASE WHEN x.metric_id = 'interruptsLanded'  THEN x.value END) AS interruptsLanded,
       MAX(CASE WHEN x.metric_id = 'ccDone.hardCcSec'  THEN x.value END) AS ccDone_hardCcSec,
       MAX(CASE WHEN x.metric_id = 'defensivesIntoBurst' THEN x.value END) AS defensivesIntoBurst
FROM match m
JOIN combatant c ON c.match_id = m.match_id AND c.is_player = 1
JOIN metric x    ON x.match_id = m.match_id AND x.scope = c.unit_id
GROUP BY m.match_id;
`;

/** Create all tables/indices/views if absent. Safe to call repeatedly. */
export function migrate(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `NODE_OPTIONS=--experimental-sqlite npx vitest run test/storeSchema.test.ts --no-file-parallelism`
Expected: PASS (2/2). Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/schema.ts test/storeSchema.test.ts
git commit -m "feat: match-store schema (node:sqlite DDL + idempotent migrate)"
```

---

## Task 2: Player resolution (`resolvePlayer.ts`)

**Files:**
- Create: `src/store/resolvePlayer.ts`
- Test: `test/resolvePlayer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/resolvePlayer.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayerUnitId } from '../src/store/resolvePlayer.js';

const units = {
  'Player-1-AAA': { name: 'Phlares-Stormrage-US' },
  'Player-2-BBB': { name: 'Friendo-Area52-US' },
};

describe('resolvePlayerUnitId', () => {
  it('prefers the parser auto-detected playerId when it exists in units', () => {
    expect(resolvePlayerUnitId({ playerId: 'Player-1-AAA', units }, [])).toBe('Player-1-AAA');
  });
  it('falls back to the registry by GUID when playerId is absent', () => {
    expect(resolvePlayerUnitId({ units }, [{ guid: 'Player-2-BBB' }])).toBe('Player-2-BBB');
  });
  it('falls back to the registry by name+realm prefix (covers any of my characters)', () => {
    expect(resolvePlayerUnitId({ units }, [{ name: 'Phlares', realm: 'Stormrage' }])).toBe('Player-1-AAA');
  });
  it('ignores a stale playerId not present in units, falling through to the registry', () => {
    expect(resolvePlayerUnitId({ playerId: 'Player-9-ZZZ', units }, [{ guid: 'Player-1-AAA' }])).toBe('Player-1-AAA');
  });
  it('returns undefined when nothing matches', () => {
    expect(resolvePlayerUnitId({ units }, [{ guid: 'Player-9-ZZZ' }])).toBeUndefined();
    expect(resolvePlayerUnitId({ units }, [])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/resolvePlayer.test.ts --no-file-parallelism`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/store/resolvePlayer.ts`**

```ts
export interface PlayerRef {
  name?: string;
  realm?: string;
  guid?: string;
}

/**
 * Identify which of the user's characters recorded this match — never hardcoded.
 * Priority:
 *   1. parser auto-detect: rawMatch.playerId (the log's advanced-logging owner), if it is a
 *      GUID present in rawMatch.units — works for any character with no config;
 *   2. registry: the first unit matching a config PlayerRef by GUID, or by name / name-realm
 *      prefix (log names look like "Phlares-Stormrage-US");
 *   3. undefined.
 */
export function resolvePlayerUnitId(rawMatch: unknown, registry: PlayerRef[] = []): string | undefined {
  const m = rawMatch as { playerId?: unknown; units?: Record<string, unknown> };
  const units = m.units ?? {};
  const pid = typeof m.playerId === 'string' ? m.playerId : undefined;
  if (pid && units[pid]) return pid;
  if (!registry.length) return undefined;
  for (const [unitId, u] of Object.entries(units)) {
    const name = String((u as { name?: unknown })?.name ?? '').toLowerCase();
    for (const p of registry) {
      if (p.guid && unitId.toLowerCase() === p.guid.toLowerCase()) return unitId;
      if (p.name) {
        const nm = p.name.toLowerCase();
        const full = p.realm ? `${p.name}-${p.realm}`.toLowerCase() : null;
        if (name === nm || name.startsWith(nm + '-') || (full && name.startsWith(full))) return unitId;
      }
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run test/resolvePlayer.test.ts --no-file-parallelism`
Expected: PASS (5/5). Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/resolvePlayer.ts test/resolvePlayer.test.ts
git commit -m "feat: resolvePlayerUnitId — identify the recording character per match"
```

---

## Task 3: Metric flattening (`metricRows.ts`)

**Files:**
- Create: `src/store/metricRows.ts`
- Test: `test/metricRows.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/metricRows.test.ts
import { describe, it, expect } from 'vitest';
import { extractMetricRows, compSignatures } from '../src/store/metricRows.js';
import type { MatchMetrics, UnitMetrics } from '../src/metrics/types.js';

// Minimal UnitMetrics with every field extractMetricRows reads; override per test.
function mkUnit(over: Partial<UnitMetrics>): UnitMetrics {
  return {
    unitId: 'U', name: 'N', kind: 'player', team: 'friendly', spec: '000',
    casts: 0, topCasts: [], interruptsLanded: 0, interruptsLandedBySpell: [],
    dispels: 0, purges: 0, purgesBySpell: [], cleanses: 0, cleansesBySpell: [],
    spellsteals: 0, spellstealsBySpell: [], deaths: 0, deathTimesSec: [],
    distanceMoved: 0, positionSamples: 0, timeStationarySec: 0, track: [],
    spacing: { meleeRangeSec: 0, isolatedSec: 0 },
    interruptsSuffered: 0, interruptsSufferedBySpell: [], deathsWhileCcd: 0, deathsWhileCcdBySpell: [],
    defensivesUsed: 0, defensivesUsedBySpell: [], defensivesIntoBurst: 0, cdUsage: [],
    ccReceived: { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0, byCategory: [] },
    ccDone: { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0, byCategory: [] },
    immuneReceived: { spellsImmuned: [], ccImmuned: 0, ccImmunedByCategory: [] },
    immuneDone: { spellsImmuned: [], ccImmuned: 0, ccImmunedByCategory: [] },
    damageDone: 0, healingDone: 0, absorbDone: 0, dps: 0, hps: 0,
    ...over,
  };
}

function mkMetrics(): MatchMetrics {
  const me = mkUnit({ unitId: 'P-ME', name: 'Me-Realm', spec: '265', damageDone: 100, deaths: 1, interruptsLanded: 2 });
  const ally = mkUnit({ unitId: 'P-AL', name: 'Ally-Realm', spec: '256' });
  const foe1 = mkUnit({ unitId: 'P-E1', name: 'Foe1-Realm', spec: '270', team: 'enemy' });
  const foe2 = mkUnit({ unitId: 'P-E2', name: 'Foe2-Realm', spec: '258', team: 'enemy' });
  return {
    teams: [
      { team: 'friendly', players: [{ player: me, pets: [], combined: {} as never }, { player: ally, pets: [], combined: {} as never }], unownedPets: [] },
      { team: 'enemy', players: [{ player: foe1, pets: [], combined: {} as never }, { player: foe2, pets: [], combined: {} as never }], unownedPets: [] },
    ],
    timeline: [], coordination: [
      { team: 'friendly', summary: { targetPriority: [], healerPressureDamage: 5, swaps: 3, attackerFocus: [], alignmentFraction: 0.5, alignedTimeSec: 10 } },
    ],
    focusTracks: { stepMs: 0, tickCount: 0, startMs: 0, tracks: [] },
    offensiveWindows: [], positionTracks: [], distanceBands: [],
    lineOfSight: { zoneId: '1825', resolved: true, approximate: false }, losDisruptors: [],
  };
}

describe('extractMetricRows', () => {
  it('flags exactly the player and emits per-unit scalar metrics', () => {
    const { combatants, metrics } = extractMetricRows(mkMetrics(), 'P-ME');
    expect(combatants.filter((c) => c.isPlayer).map((c) => c.unitId)).toEqual(['P-ME']);
    expect(combatants).toHaveLength(4);
    const dmg = metrics.find((r) => r.scope === 'P-ME' && r.metricId === 'damageDone');
    expect(dmg?.value).toBe(100);
    expect(metrics.find((r) => r.scope === 'P-ME' && r.metricId === 'deaths')?.value).toBe(1);
    expect(metrics.find((r) => r.scope === 'P-ME' && r.metricId === 'interruptsLanded')?.value).toBe(2);
  });

  it('emits team-scoped coordination metrics', () => {
    const { metrics } = extractMetricRows(mkMetrics(), 'P-ME');
    expect(metrics.find((r) => r.scope === 'team:friendly' && r.metricId === 'alignmentFraction')?.value).toBe(0.5);
    expect(metrics.find((r) => r.scope === 'team:friendly' && r.metricId === 'swaps')?.value).toBe(3);
  });

  it('builds sorted ally/enemy comp signatures', () => {
    const { combatants } = extractMetricRows(mkMetrics(), 'P-ME');
    expect(compSignatures(combatants)).toEqual({ ally: '256_265', enemy: '258_270' });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/metricRows.test.ts --no-file-parallelism`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/store/metricRows.ts`**

```ts
import type { MatchMetrics, UnitMetrics, Team } from '../metrics/types.js';

export interface CombatantRow { unitId: string; name: string; spec: string; team: Team; isPlayer: boolean; }
export interface MetricRow { scope: string; metricId: string; value: number; }
export interface Extracted { combatants: CombatantRow[]; metrics: MetricRow[]; }

/** Declarative per-unit scalar metric extractors. Add a metric = add one entry. */
const UNIT_METRICS: { id: string; get: (u: UnitMetrics) => number }[] = [
  { id: 'casts', get: (u) => u.casts },
  { id: 'interruptsLanded', get: (u) => u.interruptsLanded },
  { id: 'interruptsSuffered', get: (u) => u.interruptsSuffered },
  { id: 'dispels', get: (u) => u.dispels },
  { id: 'purges', get: (u) => u.purges },
  { id: 'cleanses', get: (u) => u.cleanses },
  { id: 'spellsteals', get: (u) => u.spellsteals },
  { id: 'deaths', get: (u) => u.deaths },
  { id: 'deathsWhileCcd', get: (u) => u.deathsWhileCcd },
  { id: 'distanceMoved', get: (u) => u.distanceMoved },
  { id: 'positionSamples', get: (u) => u.positionSamples },
  { id: 'timeStationarySec', get: (u) => u.timeStationarySec },
  { id: 'defensivesUsed', get: (u) => u.defensivesUsed },
  { id: 'defensivesIntoBurst', get: (u) => u.defensivesIntoBurst },
  { id: 'damageDone', get: (u) => u.damageDone },
  { id: 'healingDone', get: (u) => u.healingDone },
  { id: 'absorbDone', get: (u) => u.absorbDone },
  { id: 'dps', get: (u) => u.dps },
  { id: 'hps', get: (u) => u.hps },
  { id: 'spacing.meleeRangeSec', get: (u) => u.spacing.meleeRangeSec },
  { id: 'spacing.isolatedSec', get: (u) => u.spacing.isolatedSec },
  { id: 'ccDone.timeSec', get: (u) => u.ccDone.timeSec },
  { id: 'ccDone.castDenialSec', get: (u) => u.ccDone.castDenialSec },
  { id: 'ccDone.hardCcSec', get: (u) => u.ccDone.hardCcSec },
  { id: 'ccDone.rootSec', get: (u) => u.ccDone.rootSec },
  { id: 'ccDone.count', get: (u) => u.ccDone.count },
  { id: 'ccReceived.timeSec', get: (u) => u.ccReceived.timeSec },
  { id: 'ccReceived.castDenialSec', get: (u) => u.ccReceived.castDenialSec },
  { id: 'ccReceived.hardCcSec', get: (u) => u.ccReceived.hardCcSec },
  { id: 'ccReceived.rootSec', get: (u) => u.ccReceived.rootSec },
  { id: 'ccReceived.count', get: (u) => u.ccReceived.count },
  { id: 'immuneDone.ccImmuned', get: (u) => u.immuneDone.ccImmuned },
  { id: 'immuneReceived.ccImmuned', get: (u) => u.immuneReceived.ccImmuned },
];

/** Flatten MatchMetrics into combatant identity rows + (scope, metric_id, value) tuples. */
export function extractMetricRows(metrics: MatchMetrics, playerUnitId: string | undefined): Extracted {
  const combatants: CombatantRow[] = [];
  const rows: MetricRow[] = [];
  for (const tg of metrics.teams) {
    for (const pg of tg.players) {
      const u = pg.player;
      combatants.push({ unitId: u.unitId, name: u.name, spec: u.spec ?? '', team: tg.team, isPlayer: u.unitId === playerUnitId });
      for (const ex of UNIT_METRICS) {
        const v = ex.get(u);
        if (typeof v === 'number' && Number.isFinite(v)) rows.push({ scope: u.unitId, metricId: ex.id, value: v });
      }
    }
  }
  for (const c of metrics.coordination) {
    const scope = `team:${c.team}`;
    const s = c.summary;
    rows.push({ scope, metricId: 'alignmentFraction', value: s.alignmentFraction });
    rows.push({ scope, metricId: 'alignedTimeSec', value: s.alignedTimeSec });
    rows.push({ scope, metricId: 'swaps', value: s.swaps });
    rows.push({ scope, metricId: 'healerPressureDamage', value: s.healerPressureDamage });
  }
  return { combatants, metrics: rows };
}

/** Sorted, '_'-joined spec signatures per side (deterministic, so "same comp" is string equality). */
export function compSignatures(combatants: CombatantRow[]): { ally: string; enemy: string } {
  const sig = (team: Team) => combatants.filter((c) => c.team === team).map((c) => c.spec).sort().join('_');
  return { ally: sig('friendly'), enemy: sig('enemy') };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run test/metricRows.test.ts --no-file-parallelism`
Expected: PASS (3/3). Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/metricRows.ts test/metricRows.test.ts
git commit -m "feat: extractMetricRows + compSignatures (MatchMetrics -> store tuples)"
```

---

## Task 4: Idempotent store writer (`store.ts`)

**Files:**
- Create: `src/store/store.ts`
- Test: `test/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/store.test.ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/store/schema.js';
import { upsertMatch } from '../src/store/store.js';
import { resolvePlayerUnitId } from '../src/store/resolvePlayer.js';
import { parseLogFile } from '../src/parser/parserClient.js';
import { computeMatchMetrics } from '../src/metrics/metrics.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

async function fixtureMatch() {
  const { arenaMatches } = await parseLogFile(FIXTURE);
  return arenaMatches[0];
}

describe('upsertMatch (real fixture, :memory:)', () => {
  it('writes one match with correct identity, outcome, and player', async () => {
    const m = await fixtureMatch();
    const db = new DatabaseSync(':memory:');
    migrate(db);
    upsertMatch(db, m, computeMatchMetrics(m), { playerUnitId: resolvePlayerUnitId(m, []) });

    const row = db.prepare('SELECT * FROM match').get() as Record<string, unknown>;
    expect(row.bracket).toBe('3v3');
    expect(row.zone_id).toBe('1825');
    expect(row.result).toBe('win');
    expect(row.player_team_id).toBe('1');
    expect(row.player_name).toBe('Phlares-Stormrage-US');
    expect(row.player_spec).toBe('265');
    expect(row.player_rating).toBe(2425);

    const combatants = db.prepare('SELECT * FROM combatant').all();
    expect(combatants).toHaveLength(6);
    expect(db.prepare('SELECT count(*) AS c FROM combatant WHERE is_player=1').get()).toEqual({ c: 1 });

    const playerId = (db.prepare('SELECT unit_id FROM combatant WHERE is_player=1').get() as { unit_id: string }).unit_id;
    const dmg = db.prepare('SELECT value FROM metric WHERE scope=? AND metric_id=?').get(playerId, 'damageDone');
    expect(dmg).toEqual({ value: 2021381 });

    const exported = db.prepare('SELECT damageDone FROM dataset_export').all();
    expect(exported).toEqual([{ damageDone: 2021381 }]);
  });

  it('is idempotent — re-ingesting the same match does not duplicate rows', async () => {
    const m = await fixtureMatch();
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const metrics = computeMatchMetrics(m);
    const opts = { playerUnitId: resolvePlayerUnitId(m, []) };
    upsertMatch(db, m, metrics, opts);
    const before = ['match', 'combatant', 'metric'].map((t) => (db.prepare(`SELECT count(*) AS c FROM ${t}`).get() as { c: number }).c);
    upsertMatch(db, m, metrics, opts);
    const after = ['match', 'combatant', 'metric'].map((t) => (db.prepare(`SELECT count(*) AS c FROM ${t}`).get() as { c: number }).c);
    expect(after).toEqual(before);
    expect((db.prepare('SELECT count(*) AS c FROM match').get() as { c: number }).c).toBe(1);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `NODE_OPTIONS=--experimental-sqlite npx vitest run test/store.test.ts --no-file-parallelism`
Expected: FAIL — cannot find `../src/store/store.js`.

- [ ] **Step 3: Implement `src/store/store.ts`**

```ts
import { DatabaseSync } from 'node:sqlite';
import type { MatchMetrics } from '../metrics/types.js';
import { migrate } from './schema.js';
import { extractMetricRows, compSignatures } from './metricRows.js';

export interface UpsertOpts {
  playerUnitId?: string;
  sourceFile?: string;
  buildVersion?: string;
  videoPath?: string;
  sidecarPath?: string;
  /** sidecar MMR fallback when the log lacks endInfo MMR. */
  enemyMmrFallback?: number;
  nowMs?: number;
}

type SqlVal = string | number | null;
const s = (v: unknown): SqlVal => (v === undefined || v === null ? null : String(v));
const n = (v: unknown): SqlVal => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const i = (v: unknown): SqlVal => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/** "Phlares-Stormrage-US" -> ["Phlares", "Stormrage-US"]; no dash -> [name, null]. */
function splitNameRealm(full: string): [string, string | null] {
  const dash = full.indexOf('-');
  return dash === -1 ? [full, null] : [full.slice(0, dash), full.slice(dash + 1)];
}

/** Open (or create) the DB at `path` and ensure the schema exists. */
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  migrate(db);
  return db;
}

/** Write one match idempotently (delete-then-insert keyed on match_id, in a transaction). */
export function upsertMatch(db: DatabaseSync, rawMatch: unknown, metrics: MatchMetrics, opts: UpsertOpts): void {
  const m = rawMatch as {
    id?: unknown; startInfo?: Record<string, unknown>; endInfo?: Record<string, unknown>;
    durationInSeconds?: unknown; winningTeamId?: unknown; playerId?: unknown; playerTeamId?: unknown;
    units?: Record<string, { info?: { teamId?: unknown } }>; linesNotParsedCount?: unknown;
  };
  const matchId = String(m.id);
  const si = m.startInfo ?? {};
  const ei = m.endInfo ?? {};
  const pid = opts.playerUnitId;

  const { combatants, metrics: rows } = extractMetricRows(metrics, pid);
  const { ally, enemy } = compSignatures(combatants);
  const playerCombatant = combatants.find((c) => c.isPlayer);

  const rawTeam = pid && m.units?.[pid]?.info?.teamId != null
    ? String(m.units[pid]!.info!.teamId)
    : (pid && m.playerId === pid && m.playerTeamId != null ? String(m.playerTeamId) : null);
  const winning = m.winningTeamId != null ? String(m.winningTeamId) : null;
  const result = rawTeam != null && winning != null ? (rawTeam === winning ? 'win' : 'loss') : 'unknown';

  const mmrFor = (team: string | null) => (team === '0' ? ei.team0MMR : team === '1' ? ei.team1MMR : undefined);
  const playerRating = mmrFor(rawTeam);
  const enemyMmr = mmrFor(rawTeam === '0' ? '1' : rawTeam === '1' ? '0' : null) ?? opts.enemyMmrFallback;
  const startMs = typeof si.timestamp === 'number' ? si.timestamp : null;
  const now = opts.nowMs ?? Date.now();

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM metric WHERE match_id=?').run(matchId);
    db.prepare('DELETE FROM combatant WHERE match_id=?').run(matchId);
    db.prepare('DELETE FROM match WHERE match_id=?').run(matchId);

    db.prepare(
      `INSERT INTO match (match_id,start_ms,start_iso,bracket,zone_id,duration_sec,result,
        player_unit_id,player_name,player_spec,player_team_id,winning_team_id,
        ally_comp_sig,enemy_comp_sig,player_rating,enemy_mmr,is_ranked,build_version,
        video_path,sidecar_path,source_file,ingested_ms,lines_unparsed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      matchId, n(startMs), startMs != null ? new Date(startMs).toISOString() : null,
      s(si.bracket), s(si.zoneId), n(m.durationInSeconds), result,
      s(pid), s(playerCombatant?.name), s(playerCombatant?.spec), rawTeam, winning,
      ally, enemy, i(playerRating), i(enemyMmr), si.isRanked ? 1 : 0, s(opts.buildVersion),
      s(opts.videoPath), s(opts.sidecarPath), s(opts.sourceFile), now, n(m.linesNotParsedCount),
    );

    const ci = db.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)');
    for (const c of combatants) {
      const [name, realm] = splitNameRealm(c.name);
      ci.run(matchId, c.unitId, name, realm, null, c.spec, c.team, c.isPlayer ? 1 : 0);
    }
    const mi = db.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)');
    for (const r of rows) mi.run(matchId, r.scope, r.metricId, r.value);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `NODE_OPTIONS=--experimental-sqlite npx vitest run test/store.test.ts --no-file-parallelism`
Expected: PASS (2/2). Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/store.ts test/store.test.ts
git commit -m "feat: idempotent upsertMatch + openDb (match store writer)"
```

---

## Task 5: Config registry + ingest CLI (`config.ts`, `ingest-db.ts`, `package.json`)

**Files:**
- Modify: `src/config.ts`
- Create: `src/cli/ingest-db.ts`
- Modify: `package.json`
- Test: `test/configPlayers.test.ts`, `test/ingestDb.test.ts`

- [ ] **Step 1: Write the failing config test**

```ts
// test/configPlayers.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

const TMP = 'test-data/tmp-config.json';
function withConfig(obj: unknown): ReturnType<typeof loadConfig> {
  writeFileSync(TMP, JSON.stringify(obj));
  try { return loadConfig(TMP); } finally { rmSync(TMP, { force: true }); }
}
const base = { sampleLogsDir: 'x', outputDir: 'o', player: { name: 'Phlares', realm: 'Stormrage' } };

describe('loadConfig players registry', () => {
  it('normalizes a singular player into a one-element registry', () => {
    expect(withConfig(base).players).toEqual([{ name: 'Phlares', realm: 'Stormrage', guid: undefined }]);
  });
  it('accepts a players array and includes the singular player', () => {
    const cfg = withConfig({ ...base, players: [{ name: 'Altlock', realm: 'Stormrage', guid: 'Player-60-X' }] });
    expect(cfg.players.map((p) => p.name)).toContain('Phlares');
    expect(cfg.players.map((p) => p.name)).toContain('Altlock');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/configPlayers.test.ts --no-file-parallelism`
Expected: FAIL — `players` is undefined on Config.

- [ ] **Step 3: Add the registry to `src/config.ts`**

Add `players` to the `Config` interface (after `player`):
```ts
  player: PlayerIdentity;
  players: PlayerIdentity[];
```
In `loadConfig`, after the `player` object is built, build the registry and add it to the returned object:
```ts
  let extraPlayers: PlayerIdentity[] = [];
  if (raw.players !== undefined) {
    if (!Array.isArray(raw.players)) throw new Error('Config error: "players" must be an array');
    extraPlayers = (raw.players as Record<string, unknown>[]).map((p) => ({
      name: requireString(p, 'name', 'players[].name'),
      realm: requireString(p, 'realm', 'players[].realm'),
      guid: typeof p.guid === 'string' ? p.guid : undefined,
    }));
  }
  // de-dupe by name-realm, keeping the singular player first
  const seen = new Set<string>();
  const players: PlayerIdentity[] = [];
  for (const p of [player, ...extraPlayers]) {
    const key = `${p.name}-${p.realm}`.toLowerCase();
    if (!seen.has(key)) { seen.add(key); players.push(p); }
  }
```
Then add `players,` to the returned object literal.

- [ ] **Step 4: Run config test, verify pass**

Run: `npx vitest run test/configPlayers.test.ts --no-file-parallelism`
Expected: PASS (2/2).

- [ ] **Step 5: Write the failing CLI test**

```ts
// test/ingestDb.test.ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/store/schema.js';
import { ingestLogsIntoDb } from '../src/cli/ingest-db.js';

describe('ingestLogsIntoDb', () => {
  it('ingests a log file into the DB and reports a summary', async () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const summary = await ingestLogsIntoDb(db, ['test-data/fixtures/arena-sample.log'], [], undefined);
    expect(summary.ingested).toBe(1);
    expect(summary.skipped).toBe(0);
    expect((db.prepare('SELECT count(*) AS c FROM match').get() as { c: number }).c).toBe(1);
    // player auto-detected (no registry needed)
    expect((db.prepare("SELECT result FROM match").get() as { result: string }).result).toBe('win');
    expect(summary.noPlayer).toBe(0);
  });
});
```

- [ ] **Step 6: Run it, verify it fails**

Run: `NODE_OPTIONS=--experimental-sqlite npx vitest run test/ingestDb.test.ts --no-file-parallelism`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `src/cli/ingest-db.ts`**

```ts
import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { parseLogFile } from '../parser/parserClient.js';
import { computeMatchMetrics } from '../metrics/metrics.js';
import { resolvePlayerUnitId, type PlayerRef } from '../store/resolvePlayer.js';
import { upsertMatch, openDb } from '../store/store.js';
import { loadConfig } from '../config.js';
import { loadSidecarIndex, type SidecarIndex, type SidecarEntry } from '../sidecar/sidecarIndex.js';

export interface IngestSummary { files: number; ingested: number; skipped: number; noPlayer: number; noSidecar: number; }

const SIDE_WINDOW_MS = 15 * 60 * 1000;
function nearestSidecar(index: SidecarIndex | undefined, startMs: number | undefined): SidecarEntry | undefined {
  if (!index || startMs == null) return undefined;
  let best: SidecarEntry | undefined;
  let bestDelta = SIDE_WINDOW_MS;
  for (const e of index.entries) {
    if (typeof e.startEpochMs !== 'number') continue;
    const d = Math.abs(e.startEpochMs - startMs);
    if (d <= bestDelta) { best = e; bestDelta = d; }
  }
  return best;
}

/** Ingest each log file's arena matches into `db`. Pure of process/argv — testable. */
export async function ingestLogsIntoDb(
  db: DatabaseSync, files: string[], registry: PlayerRef[], sidecar: SidecarIndex | undefined,
): Promise<IngestSummary> {
  const summary: IngestSummary = { files: files.length, ingested: 0, skipped: 0, noPlayer: 0, noSidecar: 0 };
  for (const f of files) {
    let res;
    try { res = await parseLogFile(f); } catch (e) { console.error('skip file', f, String(e)); continue; }
    for (const m of res.arenaMatches) {
      try {
        const metrics = computeMatchMetrics(m);
        const playerUnitId = resolvePlayerUnitId(m, registry);
        if (!playerUnitId) summary.noPlayer += 1;
        const startMs = (m as { startInfo?: { timestamp?: number } }).startInfo?.timestamp;
        const sc = nearestSidecar(sidecar, startMs);
        if (sidecar && !sc) summary.noSidecar += 1;
        upsertMatch(db, m, metrics, {
          playerUnitId, sourceFile: basename(f),
          videoPath: sc?.videoPath, sidecarPath: sc?.sidecarPath,
        });
        summary.ingested += 1;
      } catch (e) { console.error('skip match in', f, String(e)); summary.skipped += 1; }
    }
  }
  return summary;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const dirs = process.argv.slice(2);
  if (!dirs.length) { console.error('usage: npm run ingest-db -- <logsDir...>'); process.exit(1); }
  const files = dirs.flatMap((d) => readdirSync(d).filter((f) => /WoWCombatLog.*\.txt$/i.test(f)).map((f) => join(d, f)));
  const db = openDb(cfg.dbPath ?? './wow-arena-eye.local.db');
  const sidecar = cfg.videoDirs?.length ? loadSidecarIndex(cfg.videoDirs) : undefined;
  const summary = await ingestLogsIntoDb(db, files, cfg.players, sidecar);
  console.log('ingest-db:', JSON.stringify(summary));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
```

NOTE: confirm the field names `videoPath` / `sidecarPath` / `startEpochMs` on `SidecarEntry` by reading `src/sidecar/sidecarIndex.ts`; adjust the accessors if the exported interface differs. If `SidecarEntry` is not exported, export it (one-line change in that file).

- [ ] **Step 8: Add the npm script in `package.json`**

In `"scripts"`, after `view-occupancy`:
```json
"ingest-db": "node --experimental-sqlite --import tsx src/cli/ingest-db.ts",
```

- [ ] **Step 9: Run the CLI test + type-check**

Run: `NODE_OPTIONS=--experimental-sqlite npx vitest run test/ingestDb.test.ts --no-file-parallelism`
Expected: PASS (1/1). Then `npx tsc --noEmit` → clean.

- [ ] **Step 10: Commit**

```bash
git add src/config.ts src/cli/ingest-db.ts package.json test/configPlayers.test.ts test/ingestDb.test.ts
git commit -m "feat: ingest-db CLI + config.players registry (batch normalize logs to SQLite)"
```

---

## After all tasks (controller)

1. Full suite green: `NODE_OPTIONS=--experimental-sqlite npx vitest run --no-file-parallelism` (the flag is harmless for non-sqlite tests), `npx tsc --noEmit` clean.
2. **Gates:** run `/simplify` then `/code-review` on the branch diff; address findings.
3. **Finish:** superpowers:finishing-a-development-branch → push + create PR.
4. (Optional, controller-run, not committed beyond the grids policy) a real ingest:
   `npm run ingest-db -- "C:/Program Files (x86)/World of Warcraft/_retail_/Logs" "E:/Footage/Footage/WoW - Warcraft Recorder/Wow Arena Matches/Logs"` to populate the local DB; the `.local.db` is git-ignored.

## Self-Review

- *Spec coverage:* schema+view (Task 1), player identity / multi-character (Task 2), metric flattening + comp sigs (Task 3), idempotent writer + outcome/MMR/identity columns (Task 4), config registry + batch CLI + sidecar enrichment (Task 5). Timeline/position persistence is the named deferred boundary (not a task). Scorecard queries are sub-project B.
- *Placeholder scan:* none — every step has concrete code/commands/expected output. The one runtime check (sidecar field names) is explicitly flagged with the file to read and the fallback.
- *Type consistency:* `extractMetricRows(metrics, playerUnitId)` / `compSignatures(combatants)` / `upsertMatch(db, rawMatch, metrics, opts)` / `resolvePlayerUnitId(rawMatch, registry)` / `ingestLogsIntoDb(db, files, registry, sidecar)` are used identically across tasks and tests. `metric.scope` vocabulary (`unit_id` / `team:friendly` / `team:enemy` / `match`) and the `combatant.team` (relative) column match the schema. SQLite tests carry `NODE_OPTIONS=--experimental-sqlite`; pure tests do not.
