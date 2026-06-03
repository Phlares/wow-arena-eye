# Map Geometry + Line of Sight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Infer per-arena occluder geometry from player-position occupancy across many games, and expose a standalone line-of-sight timeline (plus dynamic LoS-disruptor tracking) wired into GO analysis.

**Architecture:** An offline generator aggregates observed positions into committed per-arena soft-void-ness occluder grids. A runtime LoS engine ray-samples those grids (`clear`/`likely-blocked`/`blocked`/`unknown`), piggybacking subsystem 2's position timeline. A disruptor pass tracks smoke-bomb (modeled membrane) / ice-wall / deep-breath (flagged) intervals. Everything bolts onto `MatchMetrics` and the offensive-window record non-invasively.

**Tech Stack:** TypeScript/ESM (NodeNext — local imports end in `.js`), Node ≥22, Vitest, tsx. Generator is a plain `.mjs` with a `.d.mts` (mirrors `scripts/import-cooldowns.mjs`).

**Spec:** `docs/superpowers/specs/2026-06-03-map-geometry-los-design.md`

**⚠️ DEPENDENCY:** Execution requires subsystem 2 (PR #13: `positionTracks.ts`, `resolvePosition`, `distanceAt`, `PositionTrack`/`Sample`, `MatchMetrics.positionTracks`, `UnitMetrics.track`/`.spec`/`.team`, `OffensiveWindow.damageByTarget`/`positioning`) **merged to master**, with this branch rebased onto it. Do not start until then.

**⚠️ ENV GOTCHA (this machine):** the full `npx vitest run` oversubscribes workers and HANGS. Run single files with `npx vitest run <file> --no-file-parallelism`; for the whole suite use `npx vitest run --no-file-parallelism` (sequential). If runs pile up, kill stray workers: PowerShell `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'vitest|tinypool' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`. `npx tsc --noEmit` is fast/reliable.

**Key existing APIs (subsystem 2 / parser):**
- `eventAccess.ts`: `position(ev) → {x,y,facing?}|undefined` (actor world pos; `{0,0}`=absent), `eventType`, `srcId`, `destId`, `spellId`, `eventTimeMs`, `matchStartMs(events)`, `matchEndMs(events)`.
- `positionTracks.ts`: `PositionTrack {unitId, samples: Sample[], breaks: number[]}`; `resolvePosition(track, tSec) → {position?: Sample, inferred, lastKnown}`; `distanceAt(a,b,tSec)`.
- `cooldownTimeline.ts`: `collectCasts(match) → Map<unitId, {spellId,name,ms}[]>`.
- `types.ts`: `UnitMetrics` (`.unitId/.kind/.team/.spec/.track`), `OffensiveWindow` (`.attackingTeam/.defendingTeam/.startSec/.endSec/.damageByTarget[{unitId,name,damage}]`), `MatchMetrics`.
- Raw match: `match.startInfo.zoneId` (string); `match.events`.
- Generator pattern: `scripts/import-cooldowns.mjs` (+ `.d.mts`) — exported pure fns + `readFileSync`/`writeFileSync` + CLI guard `if (process.argv[1] === fileURLToPath(import.meta.url))`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/metrics/types.ts` (modify) | `OccluderGrid`, `LosResult`, `LosQuery`, `DisruptorKind`, `LosDisruptor`, `WindowLineOfSight`, `MatchLineOfSight`; field adds to `OffensiveWindow`/`MatchMetrics`. |
| `scripts/build-occupancy.mjs` (new) + `.d.mts` | Pure grid-building fns (`worldToCell`, `binPositions`, `voidnessFromCounts`, `floodFillExterior`, `buildOccluderGrid`) + corpus I/O + CLI. |
| `src/metadata/occupancy/<zoneId>.json` (generated, committed) | Per-arena occluder grids. |
| `src/metadata/occupancy.ts` (new) | `loadOccluderGrid(zoneId)`, `Z_AXIS_MAPS`, `COVERAGE_FLOOR`. |
| `src/metadata/losDisruptorAbilities.ts` (new, curated) | Smoke-bomb/ice-wall/deep-breath spell ids + radius/duration + `disruptorOf(spellId)`. |
| `src/metrics/lineOfSight.ts` (new) | `losBetween(grid,a,b)`, `losAt(grid, trackA, trackB, tSec, disruptors?)`, `computeLineOfSight(...)`. |
| `src/metrics/losDisruptors.ts` (new) | `collectLosDisruptors(match) → LosDisruptor[]`. |
| `src/metrics/windowLineOfSight.ts` (new) | `addWindowLineOfSight(windows, tracks, grid, disruptors, units, match)`. |
| `src/metrics/metrics.ts` (modify) | Wire grid load + LoS + disruptors into `computeMatchMetrics`. |
| `src/view/renderMetrics.ts` (modify) | LoS cell in the offensive-windows table. |
| `src/cli/view.ts` (modify) | Add LoS timeline + disruptors to the `--replay` JSON. |

**Constants** (define where owned): `CLEAR_MAX = 0.5`, `BLOCKED_MIN = 0.85` (peak-void-ness thresholds, `lineOfSight.ts`); `COVERAGE_FLOOR = 0.25` (`occupancy.ts`); `SATURATION_COUNT = 8`, `DEFAULT_CELL_YD = 2` (`build-occupancy.mjs`); `LOS_STEP_SEC = 0.5` (`lineOfSight.ts`, reuse cadence).

**Note on the occlusion metric:** the spec says "integrate void-mass"; the concrete realization here is **peak void-ness sampled along the ray** (length-independent — a solid cell blocks regardless of ray length; soft edge cells yield `likely-blocked`). This honors the graded-confidence intent; integrated/mass variants are a tuning refinement.

---

## Task 1: Types

**Files:** Modify `src/metrics/types.ts`; Modify fixtures `test/renderReport.test.ts`, `test/metrics.test.ts`.

- [ ] **Step 1: Add types to `src/metrics/types.ts`**

```ts
/** Per-arena occluder grid inferred from occupancy. voidness is row-major, [0,1]
 *  (0 = walkable, 1 = enclosed void / occluder). */
export interface OccluderGrid {
  zoneId: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  cellSize: number; cols: number; rows: number;
  voidness: number[];
  sampleCount: number; coverage: number; isZAxisMap: boolean;
}

export type LosResult = 'clear' | 'likely-blocked' | 'blocked' | 'unknown';
export interface LosQuery { result: LosResult; occlusion: number; approximate: boolean; }

export type DisruptorKind = 'smoke-bomb' | 'ice-wall' | 'deep-breath';
export interface LosDisruptor {
  kind: DisruptorKind; casterId: string; team: Team;
  pos?: { x: number; y: number }; radius?: number;
  startSec: number; endSec: number; modeled: boolean;
}

/** LoS annotation for one offensive window (its primary target). */
export interface WindowLineOfSight {
  primaryTargetId: string;
  result: LosResult;            // target ↔ nearest attacker at window start
  clearFraction?: number;       // fraction of window with clear LoS
  approximate: boolean;
  disruptorsActive: DisruptorKind[];
}

/** Match-level LoS summary (substrate for the verdict capstone). */
export interface MatchLineOfSight { zoneId: string; resolved: boolean; approximate: boolean; }
```

Add to `OffensiveWindow` (after `positioning?: WindowPositioning;`):
```ts
  lineOfSight?: WindowLineOfSight;
```

Extend the `MatchMetrics` interface (append two fields):
```ts
export interface MatchMetrics { teams: TeamGroup[]; timeline: TimelineEvent[]; playerUnitId?: string; coordination: { team: Team; summary: CoordinationSummary }[]; focusTracks: FocusTracks; offensiveWindows: OffensiveWindow[]; positionTracks: PositionTrack[]; distanceBands: DistanceBandRow[]; lineOfSight: MatchLineOfSight; losDisruptors: LosDisruptor[]; }
```

- [ ] **Step 2: Run `npx tsc --noEmit` (RED)** — expect errors in `metrics.ts` (return missing `lineOfSight`/`losDisruptors`) and `test/renderReport.test.ts` (inline `MatchMetrics` missing them).

- [ ] **Step 3: Stub `metrics.ts`** — in `computeMatchMetrics`'s return, add alongside `distanceBands`:
```ts
    lineOfSight: { zoneId: '', resolved: false, approximate: false }, // placeholder — Task 10 wiring
    losDisruptors: [], // placeholder — Task 10 wiring
```

- [ ] **Step 4: Update fixtures** — in `test/renderReport.test.ts`, the inline `MatchMetrics` literal: add `lineOfSight: { zoneId: '', resolved: false, approximate: false }, losDisruptors: [],`. In `test/metrics.test.ts`: if it has inline `MatchMetrics` literals add the same; if it only calls `computeMatchMetrics`, no change.

- [ ] **Step 5: GREEN** — `npx tsc --noEmit` clean; `npx vitest run test/renderReport.test.ts --no-file-parallelism` passes.

- [ ] **Step 6: Commit**
```bash
git add src/metrics/types.ts src/metrics/metrics.ts test/renderReport.test.ts test/metrics.test.ts
git commit -m "$(cat <<'EOF'
feat: LoS/occluder types + MatchMetrics stubs (subsystem 3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Occupancy grid pure builder

**Files:** Create `scripts/build-occupancy.mjs`, `scripts/build-occupancy.d.mts`; Test `test/buildOccupancy.test.ts`.

- [ ] **Step 1: Write the failing test — `test/buildOccupancy.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { worldToCell, buildOccluderGrid } from '../scripts/build-occupancy.mjs';

describe('occupancy grid builder', () => {
  it('maps world coords to grid cells', () => {
    const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
    expect(worldToCell(bounds, 2, 1, 1)).toEqual({ col: 0, row: 0 });
    expect(worldToCell(bounds, 2, 19, 19)).toEqual({ col: 9, row: 9 });
  });

  it('marks an enclosed never-visited region as occluder, border void as walkable', () => {
    // 20x20 yard arena, 2yd cells = 10x10. Visit every cell MANY times EXCEPT a central 2x2 block
    // (cols 4-5, rows 4-5) which is never visited → enclosed void → occluder. Leave one border
    // column (col 9) unvisited too → exterior void → must NOT become occluder.
    const positions = [];
    for (let c = 0; c < 9; c++) for (let r = 0; r < 10; r++) {
      if (c >= 4 && c <= 5 && r >= 4 && r <= 5) continue; // central hole
      for (let k = 0; k < 10; k++) positions.push({ x: c * 2 + 1, y: r * 2 + 1 });
    }
    const grid = buildOccluderGrid('TEST', positions, { cellSize: 2, saturationCount: 8 });
    const at = (c, r) => grid.voidness[r * grid.cols + c];
    expect(at(4, 4)).toBeGreaterThan(0.9);  // central hole = occluder
    expect(at(5, 5)).toBeGreaterThan(0.9);
    expect(at(0, 0)).toBeLessThan(0.2);     // walkable
    expect(at(9, 0)).toBeLessThan(0.2);     // border-unvisited but exterior → zeroed, NOT occluder
    expect(grid.zoneId).toBe('TEST');
    expect(grid.coverage).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run `npx vitest run test/buildOccupancy.test.ts --no-file-parallelism`** → FAIL (module missing).

- [ ] **Step 3: Create `scripts/build-occupancy.mjs`** (pure fns; CLI added in Task 3)

```js
// Regenerate src/metadata/occupancy/<zoneId>.json from a corpus of combat logs.
// Run: WAE_LOG_CORPUS="/path/to/Logs" node scripts/build-occupancy.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

/** World (x,y) → integer grid cell. Clamps into [0,cols) / [0,rows). */
export function worldToCell(bounds, cellSize, x, y) {
  const col = Math.min(Math.max(0, Math.floor((x - bounds.minX) / cellSize)), Math.floor((bounds.maxX - bounds.minX) / cellSize) - 1);
  const row = Math.min(Math.max(0, Math.floor((y - bounds.minY) / cellSize)), Math.floor((bounds.maxY - bounds.minY) / cellSize) - 1);
  return { col, row };
}

/** Bounding box of positions, padded by one cell. */
export function boundsOf(positions, cellSize) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of positions) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
  return { minX: minX - cellSize, minY: minY - cellSize, maxX: maxX + cellSize, maxY: maxY + cellSize };
}

/** Flood-fill from the grid border through high-void cells; returns a boolean exterior mask. */
export function floodFillExterior(voidness, cols, rows, voidThreshold) {
  const ext = new Array(cols * rows).fill(false);
  const stack = [];
  const push = (c, r) => { if (c < 0 || r < 0 || c >= cols || r >= rows) return; const i = r * cols + c; if (ext[i] || voidness[i] < voidThreshold) return; ext[i] = true; stack.push([c, r]); };
  for (let c = 0; c < cols; c++) { push(c, 0); push(c, rows - 1); }
  for (let r = 0; r < rows; r++) { push(0, r); push(cols - 1, r); }
  while (stack.length) { const [c, r] = stack.pop(); push(c + 1, r); push(c - 1, r); push(c, r + 1); push(c, r - 1); }
  return ext;
}

/** Build an OccluderGrid from observed world positions. */
export function buildOccluderGrid(zoneId, positions, opts = {}) {
  const cellSize = opts.cellSize ?? 2;
  const saturationCount = opts.saturationCount ?? 8;
  const isZAxisMap = !!opts.isZAxisMap;
  const bounds = opts.bounds ?? boundsOf(positions, cellSize);
  const cols = Math.max(1, Math.floor((bounds.maxX - bounds.minX) / cellSize));
  const rows = Math.max(1, Math.floor((bounds.maxY - bounds.minY) / cellSize));
  const counts = new Array(cols * rows).fill(0);
  for (const p of positions) { const { col, row } = worldToCell(bounds, cellSize, p.x, p.y); counts[row * cols + col]++; }
  // void-ness = 1 - min(visits/saturation, 1)
  const voidness = counts.map((n) => 1 - Math.min(n / saturationCount, 1));
  // exterior void (border-reachable) → zeroed; only enclosed void stays occluder
  const ext = floodFillExterior(voidness, cols, rows, 0.5);
  for (let i = 0; i < voidness.length; i++) if (ext[i]) voidness[i] = 0;
  const walkable = counts.filter((n) => n >= saturationCount).length;
  const inb = counts.filter((n) => n > 0).length || 1;
  return { zoneId, bounds, cellSize, cols, rows, voidness, sampleCount: positions.length, coverage: walkable / inb, isZAxisMap };
}
```

- [ ] **Step 4: Run the test** → PASS (2 tests). Also `npx tsc --noEmit` clean (the `.mjs` needs the declaration below).

- [ ] **Step 5: Create `scripts/build-occupancy.d.mts`**

```ts
export interface XY { x: number; y: number; }
export interface GridBounds { minX: number; minY: number; maxX: number; maxY: number; }
export interface OccluderGridLite {
  zoneId: string; bounds: GridBounds; cellSize: number; cols: number; rows: number;
  voidness: number[]; sampleCount: number; coverage: number; isZAxisMap: boolean;
}
export function worldToCell(bounds: GridBounds, cellSize: number, x: number, y: number): { col: number; row: number };
export function boundsOf(positions: XY[], cellSize: number): GridBounds;
export function floodFillExterior(voidness: number[], cols: number, rows: number, voidThreshold: number): boolean[];
export function buildOccluderGrid(zoneId: string, positions: XY[], opts?: { cellSize?: number; saturationCount?: number; isZAxisMap?: boolean; bounds?: GridBounds }): OccluderGridLite;
```

- [ ] **Step 6: Commit**
```bash
git add scripts/build-occupancy.mjs scripts/build-occupancy.d.mts test/buildOccupancy.test.ts
git commit -m "$(cat <<'EOF'
feat: occupancy occluder grid builder (bin + void-ness + exterior flood-fill)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Generator CLI (corpus → committed grids)

**Files:** Modify `scripts/build-occupancy.mjs` (add CLI + corpus aggregation); no new test (I/O orchestration — validated by a guarded smoke test).

- [ ] **Step 1: Add corpus aggregation + CLI to `scripts/build-occupancy.mjs`** (append; uses the project's parser client)

```ts
import { parseLogFile } from '../src/parser/parserClient.js';
import { position as evPosition, eventType as evType, srcId as evSrc } from '../src/metrics/eventAccess.js';

const Z_AXIS_MAPS = new Set(['1911', '2167', '2759', '572', '617', '1504', '1134', '2563']);
// Mugambala 1911, Robodrome 2167, Cage of Carnage 2759, Ruins of Lordaeron 572,
// Dalaran Sewers 617, Black Rook Hold 1504, Tiger's Peak 1134, Nokhudon 2563.

/** Aggregate observed PLAYER positions per zoneId from one parsed match. */
export function collectPositionsByZone(match, into) {
  const m = match;
  const zoneId = m?.startInfo?.zoneId ? String(m.startInfo.zoneId) : undefined;
  if (!zoneId) return into;
  const players = new Set(Object.entries(m.units ?? {}).filter(([, u]) => u && (u.type === 1 || u.type === '1')).map(([id]) => id));
  const arr = into.get(zoneId) ?? [];
  for (const ev of m.events ?? []) {
    const s = evSrc(ev); if (!s || !players.has(s)) continue;
    const p = evPosition(ev); if (!p) continue;
    arr.push({ x: p.x, y: p.y });
  }
  into.set(zoneId, arr);
  return into;
}

async function main() {
  const corpus = process.env.WAE_LOG_CORPUS;
  if (!corpus) { console.error('Set WAE_LOG_CORPUS to your logs directory'); process.exit(1); }
  const files = readdirSync(corpus).filter((f) => /WoWCombatLog.*\.txt$/i.test(f));
  const byZone = new Map();
  for (const f of files) {
    try { const { arenaMatches } = await parseLogFile(join(corpus, f)); for (const mt of arenaMatches) collectPositionsByZone(mt, byZone); }
    catch (e) { console.error('skip', f, String(e)); }
  }
  const outDir = fileURLToPath(new URL('../src/metadata/occupancy/', import.meta.url));
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  for (const [zoneId, positions] of byZone) {
    if (positions.length < 200) { console.error('thin coverage, skipping', zoneId, positions.length); continue; }
    const grid = buildOccluderGrid(zoneId, positions, { cellSize: 2, saturationCount: 8, isZAxisMap: Z_AXIS_MAPS.has(zoneId) });
    writeFileSync(join(outDir, zoneId + '.json'), JSON.stringify(grid));
    console.log('wrote', zoneId, 'cells', grid.cols + 'x' + grid.rows, 'coverage', grid.coverage.toFixed(2), 'samples', grid.sampleCount);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

Add `collectPositionsByZone` + `Z_AXIS_MAPS` to `scripts/build-occupancy.d.mts`:
```ts
export const Z_AXIS_MAPS: Set<string>;
export function collectPositionsByZone(match: unknown, into: Map<string, XY[]>): Map<string, XY[]>;
```

- [ ] **Step 2: Add a guarded smoke test to `test/buildOccupancy.test.ts`**

```ts
import { collectPositionsByZone } from '../scripts/build-occupancy.mjs';

it('aggregates observed player positions by zoneId from a match shape', () => {
  const match = {
    startInfo: { zoneId: '1825' },
    units: { P: { type: 1 }, PET: { type: 3 } },
    events: [
      { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'P', advancedActorPositionX: 10, advancedActorPositionY: 20 },
      { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'PET', advancedActorPositionX: 99, advancedActorPositionY: 99 }, // pet → excluded
    ],
  };
  const m = collectPositionsByZone(match, new Map());
  expect(m.get('1825')).toEqual([{ x: 10, y: 20 }]); // only the player
});
```

- [ ] **Step 3: Run `npx vitest run test/buildOccupancy.test.ts --no-file-parallelism`** → PASS (3 tests). `npx tsc --noEmit` clean.

- [ ] **Step 4: Generate the real grids (manual, on the user's machine)**

Run: `WAE_LOG_CORPUS="C:/Program Files (x86)/World of Warcraft/_retail_/Logs" node scripts/build-occupancy.mjs`
Expected: writes `src/metadata/occupancy/<zoneId>.json` for each arena with ≥200 samples; prints coverage per zone. (Commit the generated grids in this step.)

- [ ] **Step 5: Commit**
```bash
git add scripts/build-occupancy.mjs scripts/build-occupancy.d.mts test/buildOccupancy.test.ts src/metadata/occupancy/
git commit -m "$(cat <<'EOF'
feat: occupancy generator CLI (corpus → committed per-arena occluder grids)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Occluder grid loader

**Files:** Create `src/metadata/occupancy.ts`; Test `test/occupancyLoader.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { loadOccluderGrid, Z_AXIS_MAPS, COVERAGE_FLOOR } from '../src/metadata/occupancy.js';

describe('occluder grid loader', () => {
  it('exposes the z-axis arena set and a coverage floor', () => {
    expect(Z_AXIS_MAPS.has('1911')).toBe(true); // Mugambala
    expect(Z_AXIS_MAPS.has('1825')).toBe(false); // Hook Point (flat)
    expect(COVERAGE_FLOOR).toBeGreaterThan(0);
  });
  it('returns undefined for an arena with no committed grid', () => {
    expect(loadOccluderGrid('9999999')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run `npx vitest run test/occupancyLoader.test.ts --no-file-parallelism`** → FAIL (module missing).

- [ ] **Step 3: Create `src/metadata/occupancy.ts`**

```ts
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OccluderGrid } from '../metrics/types.js';

/** Arenas with meaningful elevation; occupancy LoS on these is tagged approximate. */
export const Z_AXIS_MAPS: Set<string> = new Set(['1911', '2167', '2759', '572', '617', '1504', '1134', '2563']);
/** Below this coverage, the grid is too sparse to trust → LoS returns 'unknown'. */
export const COVERAGE_FLOOR = 0.25;

const cache = new Map<string, OccluderGrid | undefined>();

/** Load a committed occluder grid by zoneId, or undefined if none exists. Cached. */
export function loadOccluderGrid(zoneId: string): OccluderGrid | undefined {
  if (cache.has(zoneId)) return cache.get(zoneId);
  const path = fileURLToPath(new URL(`./occupancy/${zoneId}.json`, import.meta.url));
  const grid = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as OccluderGrid) : undefined;
  cache.set(zoneId, grid);
  return grid;
}
```

- [ ] **Step 4: Run the test** → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/metadata/occupancy.ts test/occupancyLoader.test.ts
git commit -m "$(cat <<'EOF'
feat: occluder grid loader (loadOccluderGrid / Z_AXIS_MAPS / COVERAGE_FLOOR)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: losBetween (ray-sampled occlusion)

**Files:** Create `src/metrics/lineOfSight.ts`; Test `test/lineOfSight.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { losBetween, CLEAR_MAX, BLOCKED_MIN } from '../src/metrics/lineOfSight.js';
import type { OccluderGrid } from '../src/metrics/types.js';

// 10x10 grid, 2yd cells, 20x20yd. A solid 2x2 occluder block at cols 4-5, rows 4-5 (world ~8-12).
function gridWithCentralPillar(isZAxisMap = false): OccluderGrid {
  const cols = 10, rows = 10;
  const voidness = new Array(cols * rows).fill(0);
  for (const [c, r] of [[4,4],[5,4],[4,5],[5,5]]) voidness[r * cols + c] = 1;
  return { zoneId: 'T', bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, cellSize: 2, cols, rows, voidness, sampleCount: 9999, coverage: 0.9, isZAxisMap };
}

describe('losBetween', () => {
  it('blocks a ray that crosses the pillar', () => {
    const g = gridWithCentralPillar();
    const q = losBetween(g, { x: 2, y: 10 }, { x: 18, y: 10 }); // horizontal through center
    expect(q.result).toBe('blocked');
    expect(q.occlusion).toBeGreaterThanOrEqual(BLOCKED_MIN);
  });
  it('clears a ray that goes around the pillar', () => {
    const g = gridWithCentralPillar();
    const q = losBetween(g, { x: 2, y: 2 }, { x: 18, y: 2 }); // along the top edge, no occluder
    expect(q.result).toBe('clear');
    expect(q.occlusion).toBeLessThan(CLEAR_MAX);
  });
  it('tags z-axis grids approximate', () => {
    expect(losBetween(gridWithCentralPillar(true), { x: 2, y: 2 }, { x: 4, y: 2 }).approximate).toBe(true);
  });
});
```

- [ ] **Step 2: Run `npx vitest run test/lineOfSight.test.ts --no-file-parallelism`** → FAIL.

- [ ] **Step 3: Create `src/metrics/lineOfSight.ts`**

```ts
import type { OccluderGrid, LosQuery } from './types.js';

export const CLEAR_MAX = 0.5;    // peak void-ness below this = clear
export const BLOCKED_MIN = 0.85; // peak void-ness at/above this = blocked
export const LOS_STEP_SEC = 0.5;

/** void-ness at a world point (0 if outside the grid). */
function voidnessAt(grid: OccluderGrid, x: number, y: number): number {
  const { bounds, cellSize, cols, rows } = grid;
  if (x < bounds.minX || y < bounds.minY || x >= bounds.maxX || y >= bounds.maxY) return 0;
  const col = Math.floor((x - bounds.minX) / cellSize);
  const row = Math.floor((y - bounds.minY) / cellSize);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return 0;
  return grid.voidness[row * cols + col];
}

/** LoS between two world points on a grid: peak void-ness sampled along the segment. */
export function losBetween(grid: OccluderGrid, a: { x: number; y: number }, b: { x: number; y: number }): LosQuery {
  const approximate = grid.isZAxisMap;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  let peak = 0;
  const n = Math.max(1, Math.ceil(len / (grid.cellSize / 2)));
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const v = voidnessAt(grid, a.x + dx * f, a.y + dy * f);
    if (v > peak) peak = v;
  }
  const result = peak >= BLOCKED_MIN ? 'blocked' : peak >= CLEAR_MAX ? 'likely-blocked' : 'clear';
  return { result, occlusion: peak, approximate };
}
```

- [ ] **Step 4: Run the test** → PASS (3 tests). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/metrics/lineOfSight.ts test/lineOfSight.test.ts
git commit -m "$(cat <<'EOF'
feat: losBetween (ray-sampled peak void-ness → clear/likely/blocked)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: losAt + computeLineOfSight (timeline)

**Files:** Modify `src/metrics/lineOfSight.ts`; Test `test/lineOfSight.test.ts` (append).

- [ ] **Step 1: Append the failing test**

```ts
import { losAt } from '../src/metrics/lineOfSight.js';
import type { PositionTrack } from '../src/metrics/types.js';

const dense = (id: string, x: number, y: number): PositionTrack =>
  ({ unitId: id, samples: Array.from({ length: 11 }, (_, i) => ({ tSec: i, x, y })), breaks: [] });

describe('losAt (timeline)', () => {
  it('resolves both tracks then evaluates LoS', () => {
    const g = gridWithCentralPillar();
    const A = dense('A', 2, 10), B = dense('B', 18, 10);   // straddle the pillar
    expect(losAt(g, A, B, 5).result).toBe('blocked');
  });
  it('returns unknown when a position is unresolved (gap)', () => {
    const g = gridWithCentralPillar();
    const A: PositionTrack = { unitId: 'A', samples: [{ tSec: 0, x: 2, y: 2 }, { tSec: 100, x: 2, y: 2 }], breaks: [] };
    const B = dense('B', 4, 2);
    expect(losAt(g, A, B, 50).result).toBe('unknown'); // A unresolved at 50 (MAX_GAP)
  });
});
```

- [ ] **Step 2: Run** → FAIL (`losAt` missing).

- [ ] **Step 3: Add `losAt` + `computeLineOfSight` to `src/metrics/lineOfSight.ts`**

```ts
import { resolvePosition } from './positionTracks.js';
import type { PositionTrack, LosResult } from './types.js';

/** LoS between two units at tSec, piggybacking the position timeline. 'unknown' if either
 *  position is unresolved. (Smoke-bomb membrane is layered in by Task 9.) */
export function losAt(grid: OccluderGrid, a: PositionTrack, b: PositionTrack, tSec: number): LosQuery {
  const pa = resolvePosition(a, tSec).position;
  const pb = resolvePosition(b, tSec).position;
  if (!pa || !pb) return { result: 'unknown', occlusion: 0, approximate: grid.isZAxisMap };
  return losBetween(grid, pa, pb);
}

/** Fraction of [startSec,endSec] (sampled at LOS_STEP_SEC) with a clear LoS between a and b.
 *  undefined when no tick resolved. */
export function clearFraction(grid: OccluderGrid, a: PositionTrack, b: PositionTrack, startSec: number, endSec: number): number | undefined {
  let resolved = 0, clear = 0;
  for (let t = startSec; t <= endSec; t += LOS_STEP_SEC) {
    const q = losAt(grid, a, b, t);
    if (q.result === 'unknown') continue;
    resolved++; if (q.result === 'clear') clear++;
  }
  return resolved === 0 ? undefined : clear / resolved;
}
```

- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/metrics/lineOfSight.ts test/lineOfSight.test.ts
git commit -m "$(cat <<'EOF'
feat: losAt + clearFraction (LoS timeline piggybacking positionTracks)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Curated disruptor ability table

**Files:** Create `src/metadata/losDisruptorAbilities.ts`; Test `test/losDisruptorAbilities.test.ts`.

> **Research note for the implementer:** confirm spell IDs / radius / duration against wago.tools (`/db2/SpellName/csv?build=<current>`) + wowhead before finalizing — the values below are the curation targets, not verified constants. Smoke Bomb (Rogue), Ice Wall (Mage PvP), Deep Breath (Evoker). Update the table with verified ids/radii/durations.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { disruptorOf, DISRUPTOR_ABILITIES } from '../src/metadata/losDisruptorAbilities.js';

describe('LoS disruptor abilities', () => {
  it('classifies each disruptor with its kind + modeled flag', () => {
    expect(DISRUPTOR_ABILITIES.size).toBeGreaterThanOrEqual(3);
    const smoke = [...DISRUPTOR_ABILITIES.values()].find((d) => d.kind === 'smoke-bomb');
    expect(smoke?.modeled).toBe(true);   // smoke bomb is geometrically modeled
    expect(smoke?.radius).toBeGreaterThan(0);
    const ice = [...DISRUPTOR_ABILITIES.values()].find((d) => d.kind === 'ice-wall');
    expect(ice?.modeled).toBe(false);    // ice wall is flag-only
    expect(disruptorOf(999999)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Create `src/metadata/losDisruptorAbilities.ts`**

```ts
import type { DisruptorKind } from '../metrics/types.js';

export interface DisruptorAbility {
  kind: DisruptorKind; name: string; modeled: boolean;
  radius?: number;       // yards, for modeled sphere (smoke bomb)
  durationMs: number;    // active window when not derivable from an aura
}

/** Keyed by the CAST spell id. VERIFY ids/radius/duration against wago.tools before trusting. */
export const DISRUPTOR_ABILITIES: Map<number, DisruptorAbility> = new Map([
  [212183, { kind: 'smoke-bomb', name: 'Smoke Bomb', modeled: true, radius: 8, durationMs: 5000 }],
  [352278, { kind: 'ice-wall', name: 'Ice Wall', modeled: false, durationMs: 8000 }],
  [357210, { kind: 'deep-breath', name: 'Deep Breath', modeled: false, durationMs: 6000 }],
]);

export function disruptorOf(spellId: number | undefined): DisruptorAbility | undefined {
  return spellId === undefined ? undefined : DISRUPTOR_ABILITIES.get(spellId);
}
```

- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/metadata/losDisruptorAbilities.ts test/losDisruptorAbilities.test.ts
git commit -m "$(cat <<'EOF'
feat: curated LoS-disruptor ability table (smoke bomb modeled; ice wall/deep breath flagged)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: collectLosDisruptors

**Files:** Create `src/metrics/losDisruptors.ts`; Test `test/losDisruptors.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { collectLosDisruptors } from '../src/metrics/losDisruptors.js';

describe('collectLosDisruptors', () => {
  it('records a modeled smoke bomb (pos+radius) and a flagged ice wall', () => {
    const match = {
      units: { R: { type: 1, reaction: 'Hostile' }, M: { type: 1, reaction: 'Friendly' } },
      events: [
        { timestamp: 1000 }, // matchStart
        { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'R', spellId: '212183', advancedActorPositionX: 50, advancedActorPositionY: 60, timestamp: 5000 },
        { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'M', spellId: '352278', advancedActorPositionX: 10, advancedActorPositionY: 20, timestamp: 8000 },
      ],
    };
    const ds = collectLosDisruptors(match);
    const smoke = ds.find((d) => d.kind === 'smoke-bomb')!;
    expect(smoke).toMatchObject({ casterId: 'R', team: 'enemy', startSec: 4, modeled: true, radius: 8 });
    expect(smoke.pos).toEqual({ x: 50, y: 60 });
    expect(smoke.endSec).toBe(9); // 5000ms cast + 5000ms duration → tSec 9
    const ice = ds.find((d) => d.kind === 'ice-wall')!;
    expect(ice).toMatchObject({ casterId: 'M', team: 'friendly', modeled: false });
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Create `src/metrics/losDisruptors.ts`**

```ts
import type { LosDisruptor } from './types.js';
import { unitTeam } from './types.js';
import { matchStartMs, eventType, srcId, spellId, eventTimeMs, position } from './eventAccess.js';
import { disruptorOf } from '../metadata/losDisruptorAbilities.js';

/** Scan a match for LoS-disruptor casts → intervals (smoke-bomb modeled with pos+radius; others flagged). */
export function collectLosDisruptors(match: unknown): LosDisruptor[] {
  const m = match as { events?: unknown[]; units?: Record<string, { reaction?: unknown }> };
  const events = Array.isArray(m.events) ? m.events : [];
  const startMs = matchStartMs(events) ?? 0;
  const units = m.units ?? {};
  const out: LosDisruptor[] = [];
  for (const ev of events) {
    if (eventType(ev) !== 'SPELL_CAST_SUCCESS') continue;
    const info = disruptorOf(spellId(ev));
    if (!info) continue;
    const s = srcId(ev); const ms = eventTimeMs(ev);
    if (!s || ms === undefined) continue;
    const p = position(ev);
    out.push({
      kind: info.kind, casterId: s, team: unitTeam((units[s] ?? {}).reaction),
      pos: info.modeled && p ? { x: p.x, y: p.y } : undefined,
      radius: info.modeled ? info.radius : undefined,
      startSec: Math.round((ms - startMs) / 1000),
      endSec: Math.round((ms - startMs + info.durationMs) / 1000),
      modeled: info.modeled,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/metrics/losDisruptors.ts test/losDisruptors.test.ts
git commit -m "$(cat <<'EOF'
feat: collectLosDisruptors (disruptor interval timeline)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Smoke-bomb membrane in losAt

**Files:** Modify `src/metrics/lineOfSight.ts`; Test `test/lineOfSight.test.ts` (append).

The membrane rule: for an active smoke at center `pos` radius `r`, the bomb is keyed to the caster's team. A query between A and B where one is inside the sphere and the other outside is **blocked** for the **team opposite the caster** (to anyone); the **caster's team is unaffected**. Same-side (both in / both out) is unaffected.

- [ ] **Step 1: Append the failing test**

```ts
import type { LosDisruptor } from '../src/metrics/types.js';

describe('losAt — smoke bomb membrane', () => {
  const open: OccluderGrid = { zoneId: 'T', bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 }, cellSize: 2, cols: 20, rows: 20, voidness: new Array(400).fill(0), sampleCount: 9999, coverage: 0.9, isZAxisMap: false };
  // smoke centered (20,20) r=8, cast by an ENEMY-team rogue
  const smoke: LosDisruptor = { kind: 'smoke-bomb', casterId: 'R', team: 'enemy', pos: { x: 20, y: 20 }, radius: 8, startSec: 0, endSec: 10, modeled: true };
  const inside = dense('IN', 20, 20);   // at center (inside)
  const outside = dense('OUT', 38, 20); // far (outside)

  it('blocks the affected (friendly) team across the membrane', () => {
    // querying two FRIENDLY units straddling the smoke → blocked (enemy cast → friendly affected)
    expect(losAt(open, inside, outside, 5, [smoke], 'friendly').result).toBe('blocked');
  });
  it('lets the caster team (enemy) see through the membrane', () => {
    expect(losAt(open, inside, outside, 5, [smoke], 'enemy').result).toBe('clear');
  });
  it('does not block when both endpoints are on the same side', () => {
    const out2 = dense('OUT2', 36, 20);
    expect(losAt(open, outside, out2, 5, [smoke], 'friendly').result).toBe('clear');
  });
});
```

- [ ] **Step 2: Run** → FAIL (`losAt` arity / membrane not implemented).

- [ ] **Step 3: Extend `losAt` in `src/metrics/lineOfSight.ts`**

Add a `Team` import and extend the signature; apply the membrane before returning the geometric result:

```ts
import type { Team, LosDisruptor } from './types.js';

function inside(d: LosDisruptor, p: { x: number; y: number }): boolean {
  return d.pos !== undefined && d.radius !== undefined && Math.hypot(p.x - d.pos.x, p.y - d.pos.y) <= d.radius;
}

export function losAt(
  grid: OccluderGrid, a: PositionTrack, b: PositionTrack, tSec: number,
  disruptors: LosDisruptor[] = [], viewerTeam?: Team,
): LosQuery {
  const pa = resolvePosition(a, tSec).position;
  const pb = resolvePosition(b, tSec).position;
  if (!pa || !pb) return { result: 'unknown', occlusion: 0, approximate: grid.isZAxisMap };
  // Smoke-bomb membrane: an active smoke whose boundary the segment straddles blocks the team
  // OPPOSITE the caster (the caster's team sees through). Team-keyed via viewerTeam.
  for (const d of disruptors) {
    if (d.kind !== 'smoke-bomb' || !d.modeled || tSec < d.startSec || tSec > d.endSec) continue;
    if (viewerTeam !== undefined && viewerTeam === d.team) continue; // caster's team unaffected
    if (inside(d, pa) !== inside(d, pb)) return { result: 'blocked', occlusion: 1, approximate: grid.isZAxisMap };
  }
  return losBetween(grid, pa, pb);
}
```

(Update `clearFraction` to forward the same optional `disruptors`/`viewerTeam` if present: change its signature to `clearFraction(grid, a, b, startSec, endSec, disruptors = [], viewerTeam?)` and pass them into the `losAt` call.)

- [ ] **Step 4: Run** → PASS (all lineOfSight tests). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/metrics/lineOfSight.ts test/lineOfSight.test.ts
git commit -m "$(cat <<'EOF'
feat: smoke-bomb membrane in losAt (affected team blocked across boundary; caster team sees through)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: addWindowLineOfSight

**Files:** Create `src/metrics/windowLineOfSight.ts`; Test `test/windowLineOfSight.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { addWindowLineOfSight } from '../src/metrics/windowLineOfSight.js';
import type { OccluderGrid, OffensiveWindow, PositionTrack, UnitMetrics, LosDisruptor } from '../src/metrics/types.js';

function gridPillar(): OccluderGrid {
  const voidness = new Array(100).fill(0);
  for (const [c, r] of [[4,4],[5,4],[4,5],[5,5]]) voidness[r*10+c] = 1;
  return { zoneId: 'T', bounds: { minX:0,minY:0,maxX:20,maxY:20 }, cellSize:2, cols:10, rows:10, voidness, sampleCount:9999, coverage:0.9, isZAxisMap:false };
}
const dense = (id: string, x: number, y: number): PositionTrack => ({ unitId: id, samples: Array.from({length:26},(_,i)=>({tSec:i,x,y})), breaks: [] });
const player = (unitId: string, team: 'friendly'|'enemy'): UnitMetrics => ({ unitId, name: unitId, kind: 'player', team } as unknown as UnitMetrics);

it('annotates a window with target↔nearest-attacker LoS', () => {
  const tracks = new Map<string, PositionTrack>([['F1', dense('F1',2,10)], ['E1', dense('E1',18,10)]]);
  const units = [player('F1','friendly'), player('E1','enemy')];
  const w: OffensiveWindow = { attackingTeam:'enemy', defendingTeam:'friendly', startSec:10, endSec:20, openedBy:[], teamDamageTaken:0, damageByTarget:[{unitId:'F1',name:'F1',damage:5000}], mitigation:{available:[],used:[]}, counterPlay:{ccOnDefenders:[],threatImmuneAuras:[]} } as OffensiveWindow;
  const out = addWindowLineOfSight([w], gridPillar(), tracks, [], units);
  const los = out[0].lineOfSight!;
  expect(los.primaryTargetId).toBe('F1');
  expect(los.result).toBe('blocked'); // pillar between F1 and E1
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Create `src/metrics/windowLineOfSight.ts`**

```ts
import type { OccluderGrid, OffensiveWindow, PositionTrack, UnitMetrics, LosDisruptor, WindowLineOfSight, DisruptorKind } from './types.js';
import { losAt, clearFraction } from './lineOfSight.js';

/** Bolt a lineOfSight annotation onto each window (its primary target ↔ nearest attacker). */
export function addWindowLineOfSight(
  windows: OffensiveWindow[], grid: OccluderGrid, tracks: Map<string, PositionTrack>,
  disruptors: LosDisruptor[], units: UnitMetrics[],
): OffensiveWindow[] {
  const players = units.filter((u) => u.kind === 'player');
  return windows.map((w) => {
    const targetId = w.damageByTarget[0]?.unitId;
    const target = targetId ? tracks.get(targetId) : undefined;
    if (!targetId || !target) return w;
    const attackers = players.filter((p) => p.team === w.attackingTeam).map((p) => tracks.get(p.unitId)).filter((t): t is PositionTrack => !!t);
    // nearest attacker at window start by LoS occlusion proxy: pick the lowest-occlusion (most-visible) pair's result
    let best = { result: 'unknown' as WindowLineOfSight['result'], occlusion: Infinity };
    for (const at of attackers) {
      const q = losAt(grid, target, at, w.startSec, disruptors, w.defendingTeam);
      if (q.result !== 'unknown' && q.occlusion < best.occlusion) best = { result: q.result, occlusion: q.occlusion };
    }
    const nearest = attackers[0];
    const cf = nearest ? clearFraction(grid, target, nearest, w.startSec, w.endSec, disruptors, w.defendingTeam) : undefined;
    const active = disruptors.filter((d) => d.startSec <= w.endSec && d.endSec >= w.startSec).map((d) => d.kind);
    const los: WindowLineOfSight = {
      primaryTargetId: targetId,
      result: best.result,
      clearFraction: cf,
      approximate: grid.isZAxisMap,
      disruptorsActive: [...new Set<DisruptorKind>(active)],
    };
    return { ...w, lineOfSight: los };
  });
}
```

- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/metrics/windowLineOfSight.ts test/windowLineOfSight.test.ts
git commit -m "$(cat <<'EOF'
feat: addWindowLineOfSight (window LoS annotation: result, clearFraction, disruptors)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Wire into computeMatchMetrics

**Files:** Modify `src/metrics/metrics.ts`; Test `test/metrics.test.ts`.

- [ ] **Step 1: Append the failing test (real fixture, gated)**

```ts
import { existsSync } from 'node:fs';
const FIXTURE = 'test-data/fixtures/arena-sample.log';
describe('computeMatchMetrics — line of sight', () => {
  it.runIf(existsSync(FIXTURE))('populates lineOfSight + losDisruptors', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const mm = computeMatchMetrics(arenaMatches[0]);
    expect(typeof mm.lineOfSight.zoneId).toBe('string');
    expect(Array.isArray(mm.losDisruptors)).toBe(true);
    // lineOfSight.resolved is true iff a committed grid exists for this fixture's arena
  });
});
```

- [ ] **Step 2: Run `npx vitest run test/metrics.test.ts --no-file-parallelism`** → FAIL (`lineOfSight.zoneId` is `''` from the stub; assertion on shape may still pass — so make the assertion meaningful: also `expect(mm.lineOfSight.zoneId).toBe(String(arenaMatches[0].startInfo.zoneId))`, which fails against the stub).

- [ ] **Step 3: Wire `src/metrics/metrics.ts`**

Add imports:
```ts
import { loadOccluderGrid, COVERAGE_FLOOR, Z_AXIS_MAPS } from '../metadata/occupancy.js';
import { collectLosDisruptors } from './losDisruptors.js';
import { addWindowLineOfSight } from './windowLineOfSight.js';
```

In `computeMatchMetrics`, after `positionTracks` are built (`tracks`), and after `addWindowPositioning` produces `windows`:
```ts
  const zoneId = String((match as { startInfo?: { zoneId?: unknown } }).startInfo?.zoneId ?? '');
  const grid = loadOccluderGrid(zoneId);
  const usableGrid = grid && grid.coverage >= COVERAGE_FLOOR ? grid : undefined;
  const losDisruptors = collectLosDisruptors(match);
  const windowsWithLos = usableGrid ? addWindowLineOfSight(windows, usableGrid, tracks, losDisruptors, units) : windows;
  const lineOfSight = { zoneId, resolved: !!usableGrid, approximate: usableGrid ? usableGrid.isZAxisMap : Z_AXIS_MAPS.has(zoneId) };
```

> NOTE: in subsystem 2's `metrics.ts`, `tracks` is the `Map<string, PositionTrack>` returned by `buildPositionTracks` (and `positionTracks` is `[...tracks.values()]`). `addWindowLineOfSight` takes that Map directly — pass `tracks`. Confirm the exact variable name when rebased onto the merged #13.

Return: replace `offensiveWindows: windows,` with `offensiveWindows: windowsWithLos,` and replace the Task-1 stubs with `lineOfSight, losDisruptors,`.

- [ ] **Step 4: Run** → PASS. Then `npx vitest run --no-file-parallelism` (full suite, sequential) + `npx tsc --noEmit`.

- [ ] **Step 5: Generate/refresh grids if needed** so the fixture's arena has a committed grid (re-run Task 3 Step 4 if `lineOfSight.resolved` is false for the fixture and you want LoS on it).

- [ ] **Step 6: Commit**
```bash
git add src/metrics/metrics.ts test/metrics.test.ts
git commit -m "$(cat <<'EOF'
feat: wire LoS timeline + disruptors + window LoS into computeMatchMetrics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Render + replay export

**Files:** Modify `src/view/renderMetrics.ts`, `src/cli/view.ts`; Test `test/renderReport.test.ts`.

- [ ] **Step 1: Add a failing test** — extend the inline window fixture in the "renderReport metrics block" `metrics` object to include `lineOfSight: { primaryTargetId: 'P', result: 'blocked', clearFraction: 0.2, approximate: false, disruptorsActive: ['smoke-bomb'] }` on its offensive window, and add:

```ts
  it('renders the window line-of-sight cell', () => {
    const html = renderReport([match({ metrics })], index());
    expect(html).toContain('LoS');     // column header
    expect(html).toContain('blocked'); // the window's LoS result
  });
```

- [ ] **Step 2: Run `npx vitest run test/renderReport.test.ts --no-file-parallelism`** → FAIL.

- [ ] **Step 3: Add a LoS cell to `offensiveWindowsBlock` in `src/view/renderMetrics.ts`**

Inside the `.map((w) => {...})`, add:
```ts
      const lo = w.lineOfSight;
      const losCell = lo
        ? `${lo.result}${lo.clearFraction !== undefined ? ` (${Math.round(lo.clearFraction * 100)}% clear)` : ''}${lo.approximate ? ' ~approx' : ''}${lo.disruptorsActive.length ? ' · ' + lo.disruptorsActive.join(',') : ''}`
        : '—';
```
Append `<td>${losCell}</td>` to the row return (before `</tr>`), and add `<th>LoS</th>` to the windows-table header row (after `<th>positioning</th>`).

- [ ] **Step 4: Run** → PASS (all renderReport tests). `npx tsc --noEmit` clean.

- [ ] **Step 5: Replay export in `src/cli/view.ts`** — extend the `--replay` JSON object to include `lineOfSight: v.metrics.lineOfSight, losDisruptors: v.metrics.losDisruptors` (read the file first to match the existing `JSON.stringify({...})` shape exactly).

- [ ] **Step 6: Run the full suite + tsc** — `npx vitest run --no-file-parallelism`; `npx tsc --noEmit`.

- [ ] **Step 7: Commit**
```bash
git add src/view/renderMetrics.ts src/cli/view.ts test/renderReport.test.ts
git commit -m "$(cat <<'EOF'
feat: render window LoS cell; export lineOfSight + losDisruptors in replay JSON

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Final review gates

**Files:** none (review + fixes only)

- [ ] **Step 1:** `npx vitest run --no-file-parallelism` (all pass) + `npx tsc --noEmit` (clean).
- [ ] **Step 2:** Run `/simplify` on the branch diff; apply behavior-preserving fixes; note skips.
- [ ] **Step 3:** Run `/code-review` on the branch diff (high-effort); fix confirmed/plausible findings; add regression tests; re-run the suite.
- [ ] **Step 4:** Sanity-check on a real log: `npx tsx src/cli/view.ts <a real 12.0.5 arena log>` (or `npm run view -- <log>`; if the sidecar index load hangs, validate via a small tsx script calling `computeMatchMetrics` + `metricsBlock` instead). Confirm the offensive-windows table shows a LoS cell and the arena resolved a grid (or honestly reports `unknown`/`approximate`). **Visually validate** an occluder grid by overlaying it on the arena's minimap PNG (manual; the log carries no LoS ground truth).
- [ ] **Step 5:** Commit any review fixes.

---

## Notes for the implementer

- **NodeNext imports** end in `.js`. The generator is `.mjs` with a `.d.mts` (mirror `import-cooldowns`).
- **Observed positions only** in the generator — never feed subsystem-2 *inferred* samples into occupancy (they'd bias the walkable map). `collectPositionsByZone` reads raw events directly, so this is automatic.
- **Real grids are user-data-derived but generic** — commit `src/metadata/occupancy/*.json`. The corpus path (`WAE_LOG_CORPUS`) is git-ignored config; never hardcode it.
- **Confidence honesty** — `unknown` below `COVERAGE_FLOOR`, `approximate` for `Z_AXIS_MAPS`, `likely-blocked` for soft edges. Never fabricate LoS for a sparse arena.
- **Do not modify** subsystem-2 modules (`positionTracks.ts`, `spacing.ts`, etc.) or `offensiveWindows.ts`; LoS bolts on like `addWindowPositioning` did.
- **Disruptor spell IDs are curation targets** — verify against wago.tools/wowhead (Task 7 note) before relying on them; the membrane logic is correct regardless of the exact id.
- **Deferred (3-III), do NOT build here:** vector-fit from occupancy, z-axis/slope edges, precise ice-wall/deep-breath geometry.
