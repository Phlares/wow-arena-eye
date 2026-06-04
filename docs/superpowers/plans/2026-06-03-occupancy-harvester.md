# Occupancy Harvester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the inferred occupancy grids by an order of magnitude by ingesting player positions from historical combat logs the current pipeline rejects, via a version-tolerant line-scanning harvester.

**Architecture:** A new `src/metrics/positionHarvest.ts` runs the parser's own `stringToLogLine → logLineToCombatEvent` pipeline stages (imported from `@wowarenalogs/parser`) over a raw line stream, tracks the active arena zone, and collects `Player-` source positions via `eventAccess`. It bypasses the malformed-match gate, so older logs (missing the `COMBATANT_INFO` `specId` field) still yield positions. `build-occupancy.mjs` switches to the harvester and gains multi-corpus support. Purely additive — the existing `parseLogFile` path is untouched.

**Tech Stack:** TypeScript ESM (NodeNext, local imports end `.js`), rxjs 6 (drives the parser operators), Vitest, tsx. Spec: `docs/superpowers/specs/2026-06-03-occupancy-harvester-design.md`.

**Test/type commands (this machine):**
- Type-check: `npx tsc --noEmit`
- Run a test file: `npx vitest run test/<file> --no-file-parallelism` (NEVER bare `npx vitest run` / `npm test` — it oversubscribes workers and hangs)

---

## File Structure

- **Create** `src/metrics/positionHarvest.ts` — the harvester (`harvestPositions`, `harvestFile`, `XY`).
- **Create** `test/positionHarvest.test.ts` — unit tests (synthetic real lines).
- **Create** `test/positionHarvestFile.test.ts` — integration test against the committed fixture.
- **Modify** `scripts/build-occupancy.mjs` — use the harvester; multi-corpus env; drop `collectPositionsByZone`.
- **Modify** `scripts/build-occupancy.d.mts` — drop `collectPositionsByZone`; reuse `XY` from the harvester.
- **Modify** `test/buildOccupancy.test.ts` — remove the `collectPositionsByZone` case (keep the grid-builder cases).
- **Modify** `package.json` — add `rxjs` dependency; add `view-occupancy` script.
- **Add** `scripts/view-occupancy.mjs` — already present from the litmus; commit as-is.

---

## Task 1: Position harvester core (`harvestPositions`)

**Files:**
- Create: `src/metrics/positionHarvest.ts`
- Test: `test/positionHarvest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/positionHarvest.test.ts
import { describe, it, expect } from 'vitest';
import { harvestPositions } from '../src/metrics/positionHarvest.js';

// Real lines lifted from test-data/fixtures/arena-sample.log (zone 1825, Hook Point).
const START = '5/28/2026 20:09:20.342-4  ARENA_MATCH_START,1825,41,3v3,1';
const END = '5/28/2026 20:11:30.043-4  ARENA_MATCH_END,1,129,2464,2425';
// A player SPELL_CAST_SUCCESS carrying advanced position x=972.96 y=-299.03:
const CAST_PLAYER =
  '5/28/2026 20:09:20.914-4  SPELL_CAST_SUCCESS,Player-1427-0E06AA75,"Thatsutwo-Ragnaros-US",0x10512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,370537,"Stasis",0x40,Player-1427-0E06AA75,0000000000000000,545840,545840,768,2698,2208,2261,0,0,0,273000,273000,10000,972.96,-299.03,0,5.2856,291';
// Same line but a non-player (pet) source GUID:
const CAST_PET = CAST_PLAYER.replace(/Player-1427-0E06AA75/g, 'Pet-0-1427-2222-3333-4444-0000000001');
// A deliberately broken COMBATANT_INFO (too few params) — stands in for the real 11.x
// missing-specId shift; both make logLineToCombatEvent's per-event try/catch drop the
// event without throwing out of the stream.
const BAD_COMBATANT_INFO = '5/28/2026 20:09:20.500-4  COMBATANT_INFO,Player-1427-0E06AA75,0,1,2,3';

describe('harvestPositions', () => {
  it('collects in-match player positions under the active zone', async () => {
    const m = await harvestPositions([START, CAST_PLAYER, END]);
    expect(m.get('1825')).toEqual([{ x: 972.96, y: -299.03 }]);
  });

  it('excludes non-player (pet/NPC) sources', async () => {
    const m = await harvestPositions([START, CAST_PET, END]);
    expect(m.get('1825') ?? []).toEqual([]);
  });

  it('excludes positions outside any active match', async () => {
    const m = await harvestPositions([CAST_PLAYER, START, END, CAST_PLAYER]);
    expect(m.get('1825') ?? []).toEqual([]);
  });

  it('does not throw on a malformed COMBATANT_INFO and still collects around it', async () => {
    const m = await harvestPositions([START, BAD_COMBATANT_INFO, CAST_PLAYER, END]);
    expect(m.get('1825')).toEqual([{ x: 972.96, y: -299.03 }]);
  });

  it('separates positions from different zones into different keys', async () => {
    const START2 = '5/28/2026 20:20:00.000-4  ARENA_MATCH_START,572,41,3v3,1';
    const m = await harvestPositions([START, CAST_PLAYER, END, START2, CAST_PLAYER, END]);
    expect(m.get('1825')).toEqual([{ x: 972.96, y: -299.03 }]);
    expect(m.get('572')).toEqual([{ x: 972.96, y: -299.03 }]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/positionHarvest.test.ts --no-file-parallelism`
Expected: FAIL — `harvestPositions` not found.

- [ ] **Step 3: Implement `src/metrics/positionHarvest.ts`**

```ts
import { Subject } from 'rxjs';
import { stringToLogLine, logLineToCombatEvent } from '@wowarenalogs/parser';
import { srcId, position } from './eventAccess.js';

export interface XY {
  x: number;
  y: number;
}

// Timezone is only consulted for timestamps WITHOUT an explicit UTC offset; real arena
// logs carry an offset (e.g. "-4"), so this fallback is rarely used.
const FALLBACK_TZ = 'America/New_York';

/**
 * Stream raw combat-log lines through the parser's own per-line pipeline and collect
 * PLAYER positions, keyed by the active arena zoneId. Positions are recorded only while
 * a match is active (between ARENA_MATCH_START and ARENA_MATCH_END). Events that fail to
 * parse (e.g. the version-shifted COMBATANT_INFO in older logs) are dropped harmlessly by
 * logLineToCombatEvent's internal try/catch, so a bad event never aborts harvesting.
 *
 * Event-kind detection uses constructor.name (not instanceof): under tsx/vitest the action
 * classes can resolve to distinct module identities, which silently breaks instanceof.
 */
export async function harvestPositions(
  lines: Iterable<string> | AsyncIterable<string>,
  into: Map<string, XY[]> = new Map(),
): Promise<Map<string, XY[]>> {
  const subject = new Subject<string>();
  let zone: string | null = null;
  const sub = subject.pipe(stringToLogLine(FALLBACK_TZ), logLineToCombatEvent('retail')).subscribe((ev) => {
    if (typeof ev === 'string') return;
    const kind = (ev as { constructor?: { name?: string } })?.constructor?.name;
    if (kind === 'ArenaMatchStart') {
      zone = (ev as unknown as { zoneId: string }).zoneId;
      return;
    }
    if (kind === 'ArenaMatchEnd') {
      zone = null;
      return;
    }
    if (!zone) return;
    const s = srcId(ev);
    if (!s || !s.startsWith('Player-')) return;
    const p = position(ev);
    if (!p) return;
    const arr = into.get(zone) ?? [];
    arr.push({ x: p.x, y: p.y });
    into.set(zone, arr);
  });
  for await (const line of lines) subject.next(line);
  subject.complete();
  sub.unsubscribe();
  return into;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run test/positionHarvest.test.ts --no-file-parallelism`
Expected: PASS (5/5). Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/positionHarvest.ts test/positionHarvest.test.ts
git commit -m "feat: position harvester core (version-tolerant, zone-gated, player-only)"
```

---

## Task 2: File wrapper (`harvestFile`) + real-fixture integration

**Files:**
- Modify: `src/metrics/positionHarvest.ts`
- Test: `test/positionHarvestFile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/positionHarvestFile.test.ts
import { describe, it, expect } from 'vitest';
import { harvestFile } from '../src/metrics/positionHarvest.js';

// arena-sample.log is a real 12.0.5 match in zone 1825 (Hook Point). The harvester must
// agree with the well-formed-match path: many player positions, all inside Hook Point's
// known world bounds (x ~960-1060, y ~-375..-288).
describe('harvestFile (real 12.0.5 fixture)', () => {
  it('extracts in-bounds player positions for zone 1825', async () => {
    const m = await harvestFile('test-data/fixtures/arena-sample.log');
    const pts = m.get('1825') ?? [];
    expect(pts.length).toBeGreaterThan(500);
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(940);
      expect(p.x).toBeLessThan(1080);
      expect(p.y).toBeGreaterThan(-400);
      expect(p.y).toBeLessThan(-270);
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/positionHarvestFile.test.ts --no-file-parallelism`
Expected: FAIL — `harvestFile` not found.

- [ ] **Step 3: Add `harvestFile` to `src/metrics/positionHarvest.ts`**

```ts
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
```
(add to the existing imports at the top), and append:
```ts
/** Convenience wrapper: harvest positions from a combat-log file by path. */
export async function harvestFile(path: string, into: Map<string, XY[]> = new Map()): Promise<Map<string, XY[]>> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  return harvestPositions(rl, into);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run test/positionHarvestFile.test.ts --no-file-parallelism`
Expected: PASS. Then re-run Task 1's test + `npx tsc --noEmit` → both clean.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/positionHarvest.ts test/positionHarvestFile.test.ts
git commit -m "feat: harvestFile wrapper + real-fixture integration test"
```

---

## Task 3: Wire harvester into build-occupancy + multi-corpus support

**Files:**
- Modify: `scripts/build-occupancy.mjs`
- Modify: `scripts/build-occupancy.d.mts`
- Modify: `test/buildOccupancy.test.ts`
- Modify: `package.json` (add `rxjs` dep)

- [ ] **Step 1: Update the test — remove the `collectPositionsByZone` case**

In `test/buildOccupancy.test.ts`: delete `collectPositionsByZone` from the import on line 2
(leaving `worldToCell, buildOccluderGrid`), and delete the entire third `it(...)` block
("aggregates observed player positions by zoneId from a match shape", lines 31–42). Keep
the first two cases unchanged.

- [ ] **Step 2: Run it, verify the file still passes (no dangling reference)**

Run: `npx vitest run test/buildOccupancy.test.ts --no-file-parallelism`
Expected: PASS (2/2). (This guards the grid-builder cases while we rework the generator.)

- [ ] **Step 3: Rewrite the generator's ingestion in `scripts/build-occupancy.mjs`**

Replace the parser-based imports and `collectPositionsByZone` function + its use in `main()`
with the harvester and multi-corpus handling.

Remove these imports:
```js
import { parseLogFile } from '../src/parser/parserClient.js';
import { position as evPosition, srcId as evSrc } from '../src/metrics/eventAccess.js';
import { unitKind } from '../src/metrics/types.js';
```
Add:
```js
import { delimiter } from 'node:path';
import { harvestFile } from '../src/metrics/positionHarvest.js';
```
(keep `import { Z_AXIS_MAPS } from '../src/metadata/occupancy.js';` and the node:fs / node:url / `join` imports.)

Delete the entire `collectPositionsByZone` function (the `export function collectPositionsByZone(match, into) { ... }` block).

Replace the body of `main()` that reads the corpus with:
```js
async function main() {
  const corpusEnv = process.env.WAE_LOG_CORPUS;
  if (!corpusEnv) { console.error('Set WAE_LOG_CORPUS to your logs directory (or several, separated by the OS path delimiter)'); process.exit(1); }
  const dirs = corpusEnv.split(delimiter).map((s) => s.trim()).filter(Boolean);
  const byZone = new Map();
  for (const dir of dirs) {
    let files;
    try { files = readdirSync(dir).filter((f) => /WoWCombatLog.*\.txt$/i.test(f)); }
    catch (e) { console.error('skip corpus dir (unreadable)', dir, String(e)); continue; }
    console.error('corpus', dir, '-', files.length, 'log files');
    for (const f of files) {
      try { await harvestFile(join(dir, f), byZone); }
      catch (e) { console.error('skip', f, String(e)); }
    }
  }
  const outDir = fileURLToPath(new URL('../src/metadata/occupancy/', import.meta.url));
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  for (const [zoneId, positions] of byZone) {
    if (positions.length < MIN_SAMPLES) { console.error('thin coverage, skipping', zoneId, positions.length); continue; }
    const grid = buildOccluderGrid(zoneId, positions, { cellSize: 2, saturationCount: 8, isZAxisMap: Z_AXIS_MAPS.has(zoneId) });
    writeFileSync(join(outDir, zoneId + '.json'), JSON.stringify(grid));
    console.log('wrote', zoneId, 'cells', grid.cols + 'x' + grid.rows, 'coverage', grid.coverage.toFixed(2), 'samples', grid.sampleCount);
  }
}
```
Keep `MIN_SAMPLES`, `worldToCell`, `boundsOf`, `floodFillExterior`, `buildOccluderGrid`, and the `if (process.argv[1] === ...) main();` guard unchanged. The header comment block stays accurate (still runs via tsx); update its example to mention multiple dirs:
```js
//   WAE_LOG_CORPUS="/path/to/Logs" npm run build-occupancy
//   (multiple corpora: WAE_LOG_CORPUS="/live/Logs;/archive/Logs" on Windows, ":" on POSIX)
```

- [ ] **Step 4: Update `scripts/build-occupancy.d.mts`**

Remove the `collectPositionsByZone` declaration line. Replace the local `XY` interface with
a re-export so the type has a single home:
```ts
export type { XY } from '../src/metrics/positionHarvest.js';
export interface GridBounds { minX: number; minY: number; maxX: number; maxY: number; }
export interface OccluderGridLite {
  zoneId: string; bounds: GridBounds; cellSize: number; cols: number; rows: number;
  voidness: number[]; sampleCount: number; coverage: number; isZAxisMap: boolean;
}
export function worldToCell(bounds: GridBounds, cellSize: number, x: number, y: number): { col: number; row: number };
export function boundsOf(positions: import('../src/metrics/positionHarvest.js').XY[], cellSize: number): GridBounds;
export function floodFillExterior(voidness: number[], cols: number, rows: number, voidThreshold: number): boolean[];
export function buildOccluderGrid(zoneId: string, positions: import('../src/metrics/positionHarvest.js').XY[], opts?: { cellSize?: number; saturationCount?: number; voidThreshold?: number; isZAxisMap?: boolean; bounds?: GridBounds }): OccluderGridLite;
```

- [ ] **Step 5: Add `rxjs` as a direct dependency in `package.json`**

In `"dependencies"`, add `"rxjs": "^6.6.7"` alongside `@wowarenalogs/parser` (it is already
present transitively; this makes the harvester's import explicit).

- [ ] **Step 6: Verify the build-occupancy test + type-check still pass**

Run: `npx vitest run test/buildOccupancy.test.ts --no-file-parallelism` → PASS (2/2).
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 7: Smoke-test the generator against the fixture dir**

Run: `WAE_LOG_CORPUS=test-data/fixtures npx tsx scripts/build-occupancy.mjs`
Expected: stderr reports `corpus test-data/fixtures - N log files`; either writes `1825.json`
or prints `thin coverage, skipping 1825 <n>` (the fixture is a single match, so it may fall
under MIN_SAMPLES=200 — both outcomes prove the pipeline runs end-to-end without error).
**Do not commit** any grid written here — grids are regenerated from the real corpus in the
data step after this plan. If `1825.json` was modified, `git checkout -- src/metadata/occupancy/1825.json`.

- [ ] **Step 8: Commit**

```bash
git add scripts/build-occupancy.mjs scripts/build-occupancy.d.mts test/buildOccupancy.test.ts package.json
git commit -m "feat: build-occupancy uses the harvester + multi-corpus WAE_LOG_CORPUS"
```

---

## Task 4: Commit the occupancy viewer + npm script

**Files:**
- Add: `scripts/view-occupancy.mjs` (already present from the litmus)
- Modify: `package.json` (add `view-occupancy` script)

- [ ] **Step 1: Add the npm script**

In `package.json` `"scripts"`, add after `build-occupancy`:
```json
"view-occupancy": "node scripts/view-occupancy.mjs",
```

- [ ] **Step 2: Verify it runs**

Run: `node scripts/view-occupancy.mjs`
Expected: `wrote .../output/occupancy-viewer.html (15 maps)`.

- [ ] **Step 3: Commit**

```bash
git add scripts/view-occupancy.mjs package.json
git commit -m "feat: occupancy-viewer HTML generator (npm run view-occupancy)"
```

---

## After all tasks (controller, not a sub-agent task)

1. **Regenerate grids** from the real combined corpus:
   `WAE_LOG_CORPUS="<live Logs>;<historical Logs>" npm run build-occupancy`, then review the
   coverage/sample-count jump and commit the refreshed `src/metadata/occupancy/*.json`.
   Regenerate the viewer (`npm run view-occupancy`) for a visual before/after; the HTML output
   lives under `output/` and is git-ignored (do not commit it).
2. **Gates:** run `/simplify` then `/code-review` on the branch diff; address findings.
3. **Finish:** superpowers:finishing-a-development-branch → push + create PR.

## Self-Review

- *Spec coverage:* harvester core (Task 1), file wrapper + real-fixture agreement (Task 2),
  generator integration + multi-corpus + dead-code removal (Task 3), viewer + script (Task 4).
  Grid regeneration and gates are controller steps after the plan. All spec components covered.
- *Placeholder scan:* none — every step has concrete code/commands and expected output.
- *Type consistency:* `XY` defined once in `positionHarvest.ts`, re-exported by the generator's
  `.d.mts`. `harvestPositions`/`harvestFile` signatures match across tasks and tests.
  `eventAccess.srcId`/`position` and the `@wowarenalogs/parser` pipeline exports were verified
  to resolve under `tsc` before writing this plan.
