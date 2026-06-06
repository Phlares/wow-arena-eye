# Metrics Increment: Kicks-Taken, Precognition Uptime, Ingest Default — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface "kicks taken" in the viewer, add two-sided Precognition uptime (self + enemy-team sum) to the metric battery/store/viewer/scorecard, and default a no-arg `ingest-db` to the configured log dir.

**Architecture:** Precognition is an aura-uptime metric computed in a new `src/metrics/precognition.ts` (mirrors `ccSides.ts`), persisted as two new metric ids, exposed via the `dataset_export` view → viewer `MatchSummary` (drawer only) and the scorecard (a new `neutral` polarity). "Kicks taken" reuses the already-persisted `interruptsSuffered`. The ingest default is a pure dir-resolution helper.

**Tech Stack:** TypeScript ESM (NodeNext), node:sqlite (`--experimental-sqlite`), Vitest (root + `web/` jsdom), React 18 + Vite.

**Spec:** `docs/superpowers/specs/2026-06-05-metrics-kicks-taken-precognition.md`

**Conventions:**
- SQLite-touching root tests run with `NODE_OPTIONS=--experimental-sqlite npx vitest run <file> --no-file-parallelism`. Pure tests run without the flag. NEVER bare `npx vitest run` at root.
- `web/` tests run from inside `web/`: `cd web && npx vitest run <file> --no-file-parallelism`.
- Local imports end in `.js`. Additive changes only — do not rename existing fields.
- Commit after each task. Commit bodies end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Phase 1 — Precognition metric (data layer)

### Task 1: Precognition metadata constants

**Files:**
- Create: `src/metadata/precognition.ts`
- Test: `test/precognitionMeta.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/precognitionMeta.test.ts
import { describe, it, expect } from 'vitest';
import { PRECOGNITION_AURA_ID, PRECOGNITION_MAX_INSTANCE_SEC } from '../src/metadata/precognition.js';

describe('precognition metadata', () => {
  it('exposes the verified aura id and a sane instance cap', () => {
    expect(PRECOGNITION_AURA_ID).toBe(377362);            // verified on real 12.0.5 logs (self-BUFF)
    expect(PRECOGNITION_MAX_INSTANCE_SEC).toBeGreaterThanOrEqual(4); // real buff ~4s
    expect(PRECOGNITION_MAX_INSTANCE_SEC).toBeLessThanOrEqual(15);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/precognitionMeta.test.ts --no-file-parallelism`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/metadata/precognition.ts
// Precognition is a single shared PvP-talent self-buff. Verified on real 12.0.5 combat logs:
// `SPELL_AURA_APPLIED … 377362,"Precognition",…,BUFF` with srcId == destId, removed via
// SPELL_AURA_REMOVED (~4s). Same id across specs. Refresh from the vendored DB per patch.
export const PRECOGNITION_AURA_ID = 377362;

// Generous cap over the ~4s real duration, used to bound applied-but-never-removed auras
// (same robustness idea as the CC model's MAX_INSTANCE_MS).
export const PRECOGNITION_MAX_INSTANCE_SEC = 8;
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run test/precognitionMeta.test.ts --no-file-parallelism` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/metadata/precognition.ts test/precognitionMeta.test.ts
git commit -m "feat: precognition aura metadata (id 377362 + instance cap)"
```

---

### Task 2: `computePrecognition` + UnitMetrics fields + perUnit wiring

**Files:**
- Create: `src/metrics/precognition.ts`
- Modify: `src/metrics/types.ts` (UnitMetrics +2 fields), `src/metrics/perUnit.ts` (compute + populate)
- Test: `test/precognition.test.ts`

- [ ] **Step 1: Write the failing test** (isolated — fake AuraState, no parser needed)

```ts
// test/precognition.test.ts
import { describe, it, expect } from 'vitest';
import { computePrecognition } from '../src/metrics/precognition.js';
import type { AuraState, Interval } from '../src/metrics/auraState.js';
import { PRECOGNITION_AURA_ID } from '../src/metadata/precognition.js';

const iv = (destId: string, start: number, end: number, spellId = PRECOGNITION_AURA_ID): Interval =>
  ({ srcId: destId, destId, spellId, name: 'Precognition', start, end });

// unit.type: 1=player, 3=pet; reaction decides team (friendly vs hostile)
const units = {
  P1: { type: 1, reaction: 'Friendly' },   // recording player
  E1: { type: 1, reaction: 'Hostile' },     // enemy player
  E2: { type: 1, reaction: 'Hostile' },     // enemy player
  EP: { type: 3, reaction: 'Hostile' },     // enemy PET — must be excluded from the enemy sum
} as Record<string, Record<string, unknown>>;

function auras(map: Record<string, Interval[]>): AuraState {
  return { activeOn: () => [], intervalsBy: () => [], intervalsOn: (id) => map[id] ?? [] };
}

describe('computePrecognition', () => {
  it('self = union of own Precognition; enemy = sum over enemy PLAYERS (pets excluded)', () => {
    const a = auras({
      P1: [iv('P1', 1000, 5000)],                 // 4.0s self
      E1: [iv('E1', 0, 2000)],                    // 2.0s
      E2: [iv('E2', 0, 3000), iv('E2', 100, 200, 999)], // 3.0s precog (+ unrelated aura ignored)
      EP: [iv('EP', 0, 9000)],                    // pet — excluded
    });
    const out = computePrecognition(units, a, 100000);
    expect(out.get('P1')!.selfSec).toBeCloseTo(4, 3);
    expect(out.get('P1')!.enemySec).toBeCloseTo(5, 3); // E1 2 + E2 3, EP excluded
  });

  it('clamps an applied-but-never-removed aura to the instance cap', () => {
    const a = auras({ P1: [iv('P1', 1000, Number.MAX_SAFE_INTEGER)] });
    const out = computePrecognition(units, a, 100000);
    expect(out.get('P1')!.selfSec).toBeCloseTo(8, 3); // PRECOGNITION_MAX_INSTANCE_SEC
  });

  it('is 0/0 when there is no Precognition anywhere', () => {
    const out = computePrecognition(units, auras({}), 100000);
    expect(out.get('P1')).toEqual({ selfSec: 0, enemySec: 0 });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/precognition.test.ts --no-file-parallelism` → FAIL (module not found).

- [ ] **Step 3: Implement `computePrecognition`**

```ts
// src/metrics/precognition.ts
import { unionSeconds, type Window } from './ccTime.js';
import { unitKind, unitTeam } from './types.js';
import type { AuraState } from './auraState.js';
import { PRECOGNITION_AURA_ID, PRECOGNITION_MAX_INSTANCE_SEC } from '../metadata/precognition.js';

export interface PrecognitionUptime { selfSec: number; enemySec: number; }

/** Per-unit Precognition uptime: `selfSec` = union of the unit's own Precognition aura;
 *  `enemySec` = sum of `selfSec` over the opposite team's PLAYER units (pets/totems excluded),
 *  matching how ccDone aggregates across targets. Unclosed auras clamped to the instance cap. */
export function computePrecognition(
  units: Record<string, Record<string, unknown>>, auras: AuraState, endMs: number,
): Map<string, PrecognitionUptime> {
  const ids = Object.keys(units);
  const capMs = PRECOGNITION_MAX_INSTANCE_SEC * 1000;
  const ownSec = new Map<string, number>();
  for (const id of ids) {
    const windows: Window[] = auras.intervalsOn(id)
      .filter((i) => i.spellId === PRECOGNITION_AURA_ID)
      .map((i) => ({ start: i.start, end: Math.min(i.end, endMs, i.start + capMs) }));
    ownSec.set(id, unionSeconds(windows));
  }
  const teamOf = (id: string) => unitTeam((units[id] ?? {}).reaction);
  const isPlayer = (id: string) => unitKind((units[id] ?? {}).type) === 'player';
  const out = new Map<string, PrecognitionUptime>();
  for (const id of ids) {
    let enemySec = 0;
    for (const v of ids) if (v !== id && isPlayer(v) && teamOf(v) !== teamOf(id)) enemySec += ownSec.get(v) ?? 0;
    out.set(id, { selfSec: ownSec.get(id) ?? 0, enemySec });
  }
  return out;
}
```

NOTE: confirm `ccTime.ts` exports a `Window` type (`{ start: number; end: number }`). If it is not exported, add `export interface Window { start: number; end: number }` there (it is already used internally by `unionSeconds`).

- [ ] **Step 4: Add the UnitMetrics fields**

In `src/metrics/types.ts`, inside `interface UnitMetrics`, after `interruptsSufferedBySpell` (line ~202) add:

```ts
  precognitionUptimeSec: number;        // union of this unit's own Precognition (377362) buff, seconds
  enemyPrecognitionUptimeSec: number;   // sum of Precognition uptime over opposite-team player units
```

- [ ] **Step 5: Populate them in perUnit**

In `src/metrics/perUnit.ts` `computeUnitMetrics`, after `const endMs = …` (line ~54) add:

```ts
  const precog = computePrecognition(units, auras, endMs);
```

Add the import at the top: `import { computePrecognition } from './precognition.js';`

In the `result.push({ … })` object (after `interruptsSufferedBySpell` line ~215) add:

```ts
      precognitionUptimeSec: Math.round((precog.get(id)?.selfSec ?? 0) * 10) / 10,
      enemyPrecognitionUptimeSec: Math.round((precog.get(id)?.enemySec ?? 0) * 10) / 10,
```

- [ ] **Step 6: Run the isolated test + the full metrics suite**

Run: `npx vitest run test/precognition.test.ts --no-file-parallelism` → PASS.
Run: `npx tsc --noEmit` → clean (new required fields compile across any UnitMetrics literals; if a test fixture builds a bare UnitMetrics, add the two fields = 0).

- [ ] **Step 7: Commit**

```bash
git add src/metrics/precognition.ts src/metrics/types.ts src/metrics/perUnit.ts test/precognition.test.ts
git commit -m "feat: compute Precognition uptime (self + enemy-team sum) per unit"
```

---

### Task 3: Persist the two metrics + expose in the export view

**Files:**
- Modify: `src/store/metricRows.ts` (UNIT_METRICS +2), `src/store/schema.ts` (`dataset_export` +3 CASEs)
- Test: `test/storePrecognition.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/storePrecognition.test.ts  (sqlite)
import { describe, it, expect } from 'vitest';
import { extractMetricRows } from '../src/store/metricRows.js';
import type { MatchMetrics } from '../src/metrics/types.js';

// minimal MatchMetrics with one friendly player carrying precog fields
function metrics(): MatchMetrics {
  const base = (over: Partial<any>) => ({
    unitId: 'P1', name: 'Me', kind: 'player', team: 'friendly', spec: '265', ownerId: undefined,
    casts: 0, topCasts: [], interruptsLanded: 0, interruptsLandedBySpell: [], dispels: 0,
    purges: 0, purgesBySpell: [], cleanses: 0, cleansesBySpell: [], spellsteals: 0, spellstealsBySpell: [],
    deaths: 0, deathTimesSec: [], distanceMoved: 0, positionSamples: 0, timeStationarySec: 0, track: [],
    spacing: { meleeRangeSec: 0, isolatedSec: 0 }, interruptsSuffered: 2, interruptsSufferedBySpell: [],
    deathsWhileCcd: 0, deathsWhileCcdBySpell: [], defensivesUsed: 0, defensivesUsedBySpell: [],
    defensivesIntoBurst: 0, cdUsage: [], ccReceived: {} as any, ccDone: {} as any,
    immuneReceived: {} as any, immuneDone: {} as any, damageDone: 0, healingDone: 0, absorbDone: 0,
    dps: 0, hps: 0, precognitionUptimeSec: 6.2, enemyPrecognitionUptimeSec: 12.4, ...over,
  });
  return { teams: [{ team: 'friendly', players: [{ player: base({}), pets: [] }] }], coordination: [] } as any;
}

describe('precognition persistence', () => {
  it('extractMetricRows emits the two precognition ids on the player scope', () => {
    const { metrics: rows } = extractMetricRows(metrics(), 'P1');
    const byId = new Map(rows.filter((r) => r.scope === 'P1').map((r) => [r.metricId, r.value]));
    expect(byId.get('precognitionUptimeSec')).toBeCloseTo(6.2, 3);
    expect(byId.get('enemyPrecognitionUptimeSec')).toBeCloseTo(12.4, 3);
    expect(byId.get('interruptsSuffered')).toBe(2); // already persisted (kicks-taken)
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `NODE_OPTIONS=--experimental-sqlite npx vitest run test/storePrecognition.test.ts --no-file-parallelism` → FAIL (ids absent).

- [ ] **Step 3: Implement — UNIT_METRICS**

In `src/store/metricRows.ts` `UNIT_METRICS`, after the `interruptsSuffered` entry add (no `combine` — Precognition is never on a pet):

```ts
  { id: 'precognitionUptimeSec', get: (u) => u.precognitionUptimeSec },
  { id: 'enemyPrecognitionUptimeSec', get: (u) => u.enemyPrecognitionUptimeSec },
```

- [ ] **Step 4: Implement — dataset_export view**

In `src/store/schema.ts` `dataset_export` view, add three CASE columns (after `interruptsLanded`, before `ccDone_hardCcSec`):

```sql
       MAX(CASE WHEN x.metric_id = 'interruptsSuffered' THEN x.value END) AS interruptsSuffered,
       MAX(CASE WHEN x.metric_id = 'precognitionUptimeSec' THEN x.value END) AS precognitionUptimeSec,
       MAX(CASE WHEN x.metric_id = 'enemyPrecognitionUptimeSec' THEN x.value END) AS enemyPrecognitionUptimeSec,
```

NOTE: `CREATE VIEW IF NOT EXISTS` will NOT replace an existing view. `migrate()` must drop+recreate the view so existing DBs pick up the new columns. In `src/store/schema.ts` `migrate()`, after `db.exec(SCHEMA_SQL)` and the player_cr block, add:

```ts
  db.exec('DROP VIEW IF EXISTS dataset_export');
  db.exec(SCHEMA_SQL); // recreates the view (and is otherwise idempotent via IF NOT EXISTS)
```

(Simplest correct approach; the second `db.exec(SCHEMA_SQL)` is safe — all other statements are `IF NOT EXISTS`.)

- [ ] **Step 5: Run the test + a view smoke check**

Run: `NODE_OPTIONS=--experimental-sqlite npx vitest run test/storePrecognition.test.ts --no-file-parallelism` → PASS.
Add to the same test file a sqlite case: open an in-memory DB, `migrate(db)`, `upsertMatch` a seeded match, then `SELECT precognitionUptimeSec, enemyPrecognitionUptimeSec, interruptsSuffered FROM dataset_export` → values present. (Follow the existing store test's seeding pattern.)

- [ ] **Step 6: Commit**

```bash
git add src/store/metricRows.ts src/store/schema.ts test/storePrecognition.test.ts
git commit -m "feat: persist Precognition uptime + surface it (and kicks-taken) in dataset_export"
```

---

## Phase 2 — Viewer (kicks-taken column + Precognition drawer rows)

### Task 4: Pivot the new fields into MatchSummary

**Files:**
- Modify: `src/viewer/queries.ts` (Row + SELECT + map), `src/viewer/types.ts` (MatchSummary +3), `web/src/api.ts` (mirror +3)
- Test: `test/viewerPrecognition.test.ts`

- [ ] **Step 1: Write the failing test** (sqlite; follows existing viewer-query test seeding)

```ts
// test/viewerPrecognition.test.ts (sqlite)
// Seed one match whose player metrics include interruptsSuffered + precognition ids,
// then assert loadViewerMatches surfaces them on the MatchSummary.
import { describe, it, expect } from 'vitest';
import { openDb, upsertMatch } from '../src/store/store.js';
import { loadViewerMatches } from '../src/viewer/queries.js';
// ...build a MatchMetrics like Task 3, upsert, then:
describe('viewer pivots kicks-taken + precognition', () => {
  it('exposes interruptsSuffered + precognition fields', () => {
    // const db = openDb(':memory:'); upsertMatch(db, match, metrics, { playerUnitId: 'P1', ... });
    // const [s] = loadViewerMatches(db, {});
    // expect(s.interruptsSuffered).toBe(2);
    // expect(s.precognitionUptimeSec).toBeCloseTo(6.2, 3);
    // expect(s.enemyPrecognitionUptimeSec).toBeCloseTo(12.4, 3);
  });
});
```

(Implementer: fill the seeding from the existing viewer-query test; the assertions above are the spec.)

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement.** In `src/viewer/queries.ts`:
  - `interface Row`: add `interruptsSuffered: number | null; precognitionUptimeSec: number | null; enemyPrecognitionUptimeSec: number | null;`
  - SELECT list: change `d.damageDone, d.dps, d.interruptsLanded` →
    `d.damageDone, d.dps, d.interruptsLanded, d.interruptsSuffered, d.precognitionUptimeSec, d.enemyPrecognitionUptimeSec`
  - map object: add `interruptsSuffered: r.interruptsSuffered, precognitionUptimeSec: r.precognitionUptimeSec, enemyPrecognitionUptimeSec: r.enemyPrecognitionUptimeSec,`

  In `src/viewer/types.ts` `MatchSummary` and `web/src/api.ts` `MatchSummary`, add the same three fields: `interruptsSuffered: number | null; precognitionUptimeSec: number | null; enemyPrecognitionUptimeSec: number | null;`

- [ ] **Step 4: Run the test → PASS. `npx tsc --noEmit` clean (root).**

- [ ] **Step 5: Commit**

```bash
git add src/viewer/queries.ts src/viewer/types.ts web/src/api.ts test/viewerPrecognition.test.ts
git commit -m "feat: pivot kicks-taken + Precognition uptime onto MatchSummary"
```

---

### Task 5: "Taken" column in MatchTable (+ footer)

**Files:**
- Modify: `web/src/components/MatchTable.tsx`
- Test: `web/src/components/MatchTable.test.tsx`

- [ ] **Step 1: Write the failing test** (add to the existing file; the `m()` fixture must gain `interruptsSuffered`, `precognitionUptimeSec`, `enemyPrecognitionUptimeSec` defaults — set `interruptsSuffered: 1` and the precog fields to `null`)

```ts
it('shows a sortable Taken column with footer total', () => {
  render(<MatchTable matches={[m({ matchId: 'A', interruptsLanded: 3, interruptsSuffered: 1 }),
                               m({ matchId: 'B', interruptsLanded: 0, interruptsSuffered: 2 })]}
    sessions={sessions} selectedId={null} onSelect={() => {}} sort={null} onSort={() => {}} />);
  expect(screen.getByText('Taken')).toBeInTheDocument();
  // Σ row contains the 1+2 = 3 total for Taken (distinct from Kicks total 3 — assert both cells exist)
  const totals = screen.getByText('Σ').closest('tr')!;
  expect(totals.textContent).toContain('3');
});
```

- [ ] **Step 2: Run from web/, verify it fails.**

- [ ] **Step 3: Implement.** In `MatchTable.tsx`:
  - `COLS`: after the `interruptsLanded` ('Kicks') entry add
    `{ key: 'interruptsSuffered', label: 'Taken', sortable: true, num: (m) => m.interruptsSuffered },`
  - `Row`: after the Kicks `<td>{fmtNum(m.interruptsLanded)}</td>` add `<td>{fmtNum(m.interruptsSuffered)}</td>`.
  - Footer Σ row: append a cell `<td>{fmtNum(sum((m) => m.interruptsSuffered))}</td>` and avg row: `<td>{fmtNum(avg((m) => m.interruptsSuffered))}</td>`. Verify the hand-aligned `colSpan`s still total `COLS.length` (now 11): the Σ/avg leading `colSpan` cells are unchanged; only one numeric cell is appended at the end of each.

- [ ] **Step 4: Run the table tests → all PASS. `tsc` clean (web).**

- [ ] **Step 5: Commit**

```bash
git add web/src/components/MatchTable.tsx web/src/components/MatchTable.test.tsx
git commit -m "feat(web): kicks-taken (Taken) column with sort + footer totals"
```

---

### Task 6: Drawer — kicks taken + Precognition rows

**Files:**
- Modify: `web/src/components/SummaryDrawer.tsx`, `web/src/format.ts` (add `fmtSeconds`)
- Test: `web/src/components/SummaryDrawer.test.tsx`

- [ ] **Step 1: Write the failing test** (the drawer fixture `m` must include the three new fields)

```ts
it('shows kicks taken and both Precognition uptimes', () => {
  render(<SummaryDrawer match={{ ...m, interruptsSuffered: 2, precognitionUptimeSec: 6.2, enemyPrecognitionUptimeSec: 12.4 }} />);
  expect(screen.getByText('Kicks taken')).toBeInTheDocument();
  expect(screen.getByText('Precognition (you)')).toBeInTheDocument();
  expect(screen.getByText('6.2s')).toBeInTheDocument();
  expect(screen.getByText('Precognition (enemy)')).toBeInTheDocument();
  expect(screen.getByText('12.4s')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run from web/, verify it fails.**

- [ ] **Step 3: Implement.**
  - `web/src/format.ts`: add `export function fmtSeconds(v: number | null): string { return v === null ? '—' : `${v.toFixed(1)}s`; }`
  - `SummaryDrawer.tsx`: import `fmtSeconds`; after the existing `Kicks` row add:
    ```tsx
    <Row k="Kicks taken" v={fmtNum(m.interruptsSuffered)} />
    <Row k="Precognition (you)" v={fmtSeconds(m.precognitionUptimeSec)} />
    <Row k="Precognition (enemy)" v={fmtSeconds(m.enemyPrecognitionUptimeSec)} />
    ```

- [ ] **Step 4: Run drawer tests → PASS. `tsc` clean (web).**

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SummaryDrawer.tsx web/src/format.ts web/src/components/SummaryDrawer.test.tsx
git commit -m "feat(web): drawer shows kicks-taken + self/enemy Precognition uptime"
```

---

## Phase 3 — Scorecard (descriptive Precognition)

### Task 7: `neutral` polarity + two Precognition metrics

**Files:**
- Modify: `src/scorecard/types.ts` (Polarity, Verdict), `src/scorecard/scorecard.ts` (verdict/seasonBest/winLikeness + SCORECARD_METRICS), `src/scorecard/render.ts` (GLYPH)
- Test: `test/scorecardNeutral.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/scorecardNeutral.test.ts (sqlite or pure buildScorecard over hand-built PlayerMatch[])
import { describe, it, expect } from 'vitest';
import { buildScorecard, SCORECARD_METRICS } from '../src/scorecard/scorecard.js';
import type { PlayerMatch } from '../src/scorecard/types.js';

function pm(id: string, result: string, precog: number): PlayerMatch {
  return { matchId: id, startMs: 1000, bracket: '3v3', zoneId: '1', allyComp: '', enemyComp: '',
    rating: 1800, result, character: 'Me', metrics: { precognitionUptimeSec: precog } };
}

describe('neutral scorecard metric', () => {
  it('precognition is descriptive: no verdict, no season-best, neutral win-likeness', () => {
    const matches = [pm('t', 'win', 6), pm('a', 'win', 2), pm('b', 'loss', 10), pm('c', 'win', 4), pm('d', 'loss', 8), pm('e', 'win', 3)];
    const sc = buildScorecard(matches, 't', { scope: {}, seasons: [] });
    const score = sc.metrics.find((x) => x.id === 'precognitionUptimeSec')!;
    expect(score.verdict).toBe('descriptive');
    expect(score.seasonBest).toBeNull();
    expect(score.isNewBest).toBe(false);
    expect(score.winLikeness).toBe('neutral');
    expect(SCORECARD_METRICS.some((d) => d.id === 'enemyPrecognitionUptimeSec' && d.polarity === 'neutral')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement — types.** In `src/scorecard/types.ts`:
  - `export type Polarity = 'higher-better' | 'lower-better' | 'neutral';`
  - `export type Verdict = 'better' | 'worse' | 'average' | 'insufficient' | 'descriptive';`

- [ ] **Step 4: Implement — scorecard logic.** In `src/scorecard/scorecard.ts`:
  - In `verdictFor`, add at the top (after the `value === null || n < minCohort` guard):
    ```ts
    if (polarity === 'neutral') {
      const z = stdev === 0 ? 0 : (value - mean) / stdev;
      return { verdict: 'descriptive', z };
    }
    ```
  - In the `SCORECARD_METRICS.map`, make `seasonBest`/`isNewBest`/`winLikeness` neutral-aware:
    ```ts
    const neutral = def.polarity === 'neutral';
    const seasonBest = neutral ? null : (seasonVals.length ? (def.polarity === 'higher-better' ? Math.max(...seasonVals) : Math.min(...seasonVals)) : null);
    const isNewBest = neutral ? false : (value !== null && (seasonBest === null || (def.polarity === 'higher-better' ? value > seasonBest : value < seasonBest)));
    const winLikeness = neutral ? 'neutral' : winLikenessFor(value, collect(wins, def.id), collect(losses, def.id));
    ```
  - Append to `SCORECARD_METRICS`:
    ```ts
    { id: 'precognitionUptimeSec', label: 'Precognition uptime (s)', polarity: 'neutral' },
    { id: 'enemyPrecognitionUptimeSec', label: 'Enemy Precognition (s)', polarity: 'neutral' },
    ```

- [ ] **Step 5: Implement — render glyph.** In `src/scorecard/render.ts`, add to `GLYPH`: `descriptive: '· info'`.

- [ ] **Step 6: Run the test → PASS. `npx tsc --noEmit` clean (the new Verdict/Polarity members are handled).**

- [ ] **Step 7: Commit**

```bash
git add src/scorecard/types.ts src/scorecard/scorecard.ts src/scorecard/render.ts test/scorecardNeutral.test.ts
git commit -m "feat: neutral/descriptive scorecard polarity + Precognition metrics"
```

---

## Phase 4 — Ingest convenience

### Task 8: No-arg `ingest-db` defaults to config dir

**Files:**
- Modify: `src/cli/ingest-db.ts`
- Test: `test/ingestDirs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/ingestDirs.test.ts
import { describe, it, expect } from 'vitest';
import { resolveIngestDirs } from '../src/cli/ingest-db.js';

describe('resolveIngestDirs', () => {
  it('uses explicit args when present', () => {
    expect(resolveIngestDirs(['a', 'b'], { liveLogsDir: 'L', sampleLogsDir: 'S' })).toEqual(['a', 'b']);
  });
  it('defaults to liveLogsDir when no args', () => {
    expect(resolveIngestDirs([], { liveLogsDir: 'L', sampleLogsDir: 'S' })).toEqual(['L']);
  });
  it('falls back to sampleLogsDir when liveLogsDir is absent', () => {
    expect(resolveIngestDirs([], { sampleLogsDir: 'S' })).toEqual(['S']);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement.** In `src/cli/ingest-db.ts`, export a pure helper and use it in `main()`:

```ts
export function resolveIngestDirs(argv: string[], cfg: { liveLogsDir?: string; sampleLogsDir: string }): string[] {
  return argv.length ? argv : [cfg.liveLogsDir ?? cfg.sampleLogsDir];
}
```

In `main()`, replace the usage-error block:

```ts
  const dirs = resolveIngestDirs(process.argv.slice(2), cfg);
  if (process.argv.slice(2).length === 0) console.log('ingest-db: no dirs given, defaulting to', dirs[0]);
```

(Remove `if (!dirs.length) { console.error('usage…'); process.exit(1); }`.)

- [ ] **Step 4: Run the test → PASS. `npx tsc --noEmit` clean.**

- [ ] **Step 5: Commit**

```bash
git add src/cli/ingest-db.ts test/ingestDirs.test.ts
git commit -m "feat: no-arg ingest-db defaults to liveLogsDir ?? sampleLogsDir"
```

---

## Phase 5 — Re-ingest + end-to-end verification (operational, not TDD)

### Task 9: Re-ingest and verify on real data

- [ ] **Step 1:** Build the SPA + full suites green first.
  - Root: `NODE_OPTIONS=--experimental-sqlite npx vitest run --no-file-parallelism` → all pass.
  - Web: `cd web && npx vitest run --no-file-parallelism` → all pass.
  - `npx tsc --noEmit` (root) and `cd web && npx tsc --noEmit` → clean. `cd web && npx vite build` → ok.
- [ ] **Step 2:** Re-ingest (now a bare command thanks to Task 8): `npm run ingest-db`.
- [ ] **Step 3:** Launch `npm run viewer` and verify: the **Taken** column shows nonzero kicks-taken; opening a match drawer shows **Kicks taken** and both **Precognition** rows (nonzero on a match where you/enemies procced Precognition); session-fold sort still coherent.
- [ ] **Step 4:** `npm run scorecard -- latest` → the two Precognition rows render with a `· info` (descriptive) verdict and `neutral` win/loss, no season-best star.
- [ ] **Step 5:** Run `/simplify` then `/code-review` over the branch diff; address findings.
- [ ] **Step 6:** `finishing-a-development-branch` → push `feat/metrics-kicks-precog` + open PR.

---

## Self-Review (plan vs spec)

- **Coverage:** kicks-taken column (Task 5) + drawer (Task 6); Precognition self+enemy compute (Task 2), persist+view (Task 3), pivot (Task 4), drawer (Task 6), scorecard neutral (Task 7); ingest default (Task 8); re-ingest verify (Task 9). All spec decisions A–D mapped.
- **Types consistent:** `precognitionUptimeSec` / `enemyPrecognitionUptimeSec` used identically in types.ts, perUnit, metricRows, schema view, queries Row+SELECT+map, viewer/api MatchSummary, MatchTable, SummaryDrawer, scorecard. `interruptsSuffered` reused (already persisted) — surfaced only in view + viewer + drawer.
- **No placeholders** except the two clearly-marked seeding scaffolds (Tasks 4 implementer fills from the existing viewer/store test patterns) — assertions are concrete.
- **Critical correctness note:** `dataset_export` is the viewer's metric source; the view MUST be dropped+recreated in `migrate()` (Task 3 Step 4) or existing DBs won't gain the columns — and the viewer would read NULLs. Verified against `queries.ts` (`LEFT JOIN dataset_export d`).
