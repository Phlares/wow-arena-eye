// Regenerate src/metadata/occupancy/<zoneId>.json from a corpus of combat logs.
// Imports live TS source, so run via tsx (NOT plain node):
//   WAE_LOG_CORPUS="/path/to/Logs" npm run build-occupancy
//   (multiple corpora: WAE_LOG_CORPUS="/live/Logs;/archive/Logs" on Windows, ":" on POSIX)
import { writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, delimiter } from 'node:path';
import { harvestFile } from '../src/metrics/positionHarvest.js';
import { Z_AXIS_MAPS } from '../src/metadata/occupancy.js'; // single source of truth (avoid drift)

/** World (x,y) → integer grid cell. Clamps into [0,cols) / [0,rows).
 *  maxCol/maxRow are floored at 0 so a degenerate sub-cell bounds span can't yield a negative index. */
export function worldToCell(bounds, cellSize, x, y) {
  const maxCol = Math.max(0, Math.floor((bounds.maxX - bounds.minX) / cellSize) - 1);
  const maxRow = Math.max(0, Math.floor((bounds.maxY - bounds.minY) / cellSize) - 1);
  const col = Math.min(Math.max(0, Math.floor((x - bounds.minX) / cellSize)), maxCol);
  const row = Math.min(Math.max(0, Math.floor((y - bounds.minY) / cellSize)), maxRow);
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

/** Void-ness + exterior flood-fill + coverage from a per-cell count grid. Shared by the
 *  positions path (buildOccluderGrid) and the streaming path (gridFromCellAccum). */
export function gridFromCounts(zoneId, counts, bounds, cellSize, cols, rows, sampleCount, opts = {}) {
  const saturationCount = opts.saturationCount ?? 8;
  const voidThreshold = opts.voidThreshold ?? 0.5; // cells this void-or-more are flood-fill-traversable
  const isZAxisMap = !!opts.isZAxisMap;
  // void-ness = 1 - min(visits/saturation, 1)
  const voidness = counts.map((n) => 1 - Math.min(n / saturationCount, 1));
  // exterior void (border-reachable) → zeroed; only enclosed void stays occluder
  const ext = floodFillExterior(voidness, cols, rows, voidThreshold);
  for (let i = 0; i < voidness.length; i++) if (ext[i]) voidness[i] = 0;
  const walkable = counts.filter((n) => n >= saturationCount).length;
  const inb = counts.filter((n) => n > 0).length || 1; // || 1 avoids /0 on an empty/unvisited grid
  return { zoneId, bounds, cellSize, cols, rows, voidness, sampleCount, coverage: walkable / inb, isZAxisMap };
}

/** Build an OccluderGrid from observed world positions (kept for small in-memory inputs). */
export function buildOccluderGrid(zoneId, positions, opts = {}) {
  const cellSize = opts.cellSize ?? 2;
  const bounds = opts.bounds ?? boundsOf(positions, cellSize);
  const cols = Math.max(1, Math.floor((bounds.maxX - bounds.minX) / cellSize));
  const rows = Math.max(1, Math.floor((bounds.maxY - bounds.minY) / cellSize));
  const counts = new Array(cols * rows).fill(0);
  for (const p of positions) { const { col, row } = worldToCell(bounds, cellSize, p.x, p.y); counts[row * cols + col]++; }
  return gridFromCounts(zoneId, counts, bounds, cellSize, cols, rows, positions.length, opts);
}

/** Fold observed positions into an absolute-cell count map. Memory is O(distinct occupied
 *  cells) — a few thousand per zone — independent of how many positions stream through, so
 *  a corpus of tens of millions of positions never has to be held at once. Cell key is
 *  "col,row" with col = floor(x/cellSize). Mutates and returns `cellMap`. */
export function accumulateCells(cellMap, positions, cellSize) {
  for (const p of positions) {
    const key = Math.floor(p.x / cellSize) + ',' + Math.floor(p.y / cellSize);
    cellMap.set(key, (cellMap.get(key) ?? 0) + 1);
  }
  return cellMap;
}

// Bigger than any real arena's half-extent (~125 cells / 250yd) yet far short of the
// thousands-of-cells distance of stray garbage/cross-zone coordinates — so it drops
// outliers without ever clipping legitimate arena geometry.
const MAX_ARENA_RADIUS_CELLS = 300;

/** Mass-weighted median of cells along one axis ('col' | 'row'). Robust to far outliers
 *  (unlike min/max or the mean), so it reliably anchors on the dense arena center. */
function massMedian(cells, axis, total) {
  const mass = new Map();
  for (const c of cells) mass.set(c[axis], (mass.get(c[axis]) ?? 0) + c.n);
  const keys = [...mass.keys()].sort((a, b) => a - b);
  let cum = 0;
  for (const k of keys) { cum += mass.get(k); if (cum >= total / 2) return k; }
  return keys[keys.length - 1];
}

/** Materialize an OccluderGrid from an absolute-cell count map, with a one-cell void border
 *  on every side so the exterior flood-fill has somewhere to start (mirrors boundsOf's pad).
 *  Far outlier cells (stray/garbage coordinates more than maxRadiusCells from the mass-median
 *  center) are dropped so a handful of bad positions can't balloon the grid bounds. */
export function gridFromCellAccum(zoneId, cellMap, sampleCount, opts = {}) {
  const cellSize = opts.cellSize ?? 2;
  const maxRadius = opts.maxRadiusCells ?? MAX_ARENA_RADIUS_CELLS;
  const cells = [];
  for (const [key, n] of cellMap) {
    const ci = key.indexOf(',');
    cells.push({ col: +key.slice(0, ci), row: +key.slice(ci + 1), n });
  }
  if (!cells.length) { // no cells observed
    return gridFromCounts(zoneId, [0], { minX: 0, minY: 0, maxX: cellSize, maxY: cellSize }, cellSize, 1, 1, sampleCount, opts);
  }
  const total = cells.reduce((s, c) => s + c.n, 0);
  const medCol = massMedian(cells, 'col', total), medRow = massMedian(cells, 'row', total);
  const kept = cells.filter((c) => Math.abs(c.col - medCol) <= maxRadius && Math.abs(c.row - medRow) <= maxRadius);
  const droppedCells = cells.length - kept.length;
  if (droppedCells) {
    const droppedSamples = total - kept.reduce((s, c) => s + c.n, 0);
    console.error('  dropped', droppedCells, 'outlier cells /', droppedSamples, 'samples (>' + maxRadius * cellSize + 'yd from center) for zone', zoneId);
  }
  let minCol = Infinity, minRow = Infinity, maxCol = -Infinity, maxRow = -Infinity;
  for (const c of kept) {
    if (c.col < minCol) minCol = c.col; if (c.col > maxCol) maxCol = c.col;
    if (c.row < minRow) minRow = c.row; if (c.row > maxRow) maxRow = c.row;
  }
  const padMinCol = minCol - 1, padMinRow = minRow - 1;
  const cols = maxCol - minCol + 3; // observed span + one void cell each side
  const rows = maxRow - minRow + 3;
  const bounds = { minX: padMinCol * cellSize, minY: padMinRow * cellSize, maxX: (padMinCol + cols) * cellSize, maxY: (padMinRow + rows) * cellSize };
  const counts = new Array(cols * rows).fill(0);
  for (const c of kept) counts[(c.row - padMinRow) * cols + (c.col - padMinCol)] = c.n;
  return gridFromCounts(zoneId, counts, bounds, cellSize, cols, rows, sampleCount, opts);
}

const MIN_SAMPLES = 200; // fewer observed positions than this → too sparse to infer a usable grid; skip the arena

async function main() {
  const corpusEnv = process.env.WAE_LOG_CORPUS;
  if (!corpusEnv) { console.error('Set WAE_LOG_CORPUS to your logs directory (or several, separated by the OS path delimiter)'); process.exit(1); }
  const dirs = corpusEnv.split(delimiter).map((s) => s.trim()).filter(Boolean);
  // Per-zone absolute-cell counts; bounded memory regardless of corpus size. Raw per-file
  // positions are folded in then discarded, so we never hold the whole corpus at once.
  const cellAccum = new Map(); // zoneId -> { cells: Map<string, number>, n: number }
  for (const dir of dirs) {
    let files;
    try { files = readdirSync(dir).filter((f) => /WoWCombatLog.*\.txt$/i.test(f)); }
    catch (e) { console.error('skip corpus dir (unreadable)', dir, String(e)); continue; }
    console.error('corpus', dir, '-', files.length, 'log files');
    for (const f of files) {
      try {
        const fileZones = await harvestFile(join(dir, f)); // fresh Map for this file only
        for (const [zoneId, positions] of fileZones) {
          let acc = cellAccum.get(zoneId);
          if (!acc) { acc = { cells: new Map(), n: 0 }; cellAccum.set(zoneId, acc); }
          accumulateCells(acc.cells, positions, 2);
          acc.n += positions.length;
        }
      } catch (e) { console.error('skip', f, String(e)); }
    }
  }
  const outDir = fileURLToPath(new URL('../src/metadata/occupancy/', import.meta.url));
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  for (const [zoneId, acc] of cellAccum) {
    if (acc.n < MIN_SAMPLES) { console.error('thin coverage, skipping', zoneId, acc.n); continue; }
    const grid = gridFromCellAccum(zoneId, acc.cells, acc.n, { cellSize: 2, saturationCount: 8, isZAxisMap: Z_AXIS_MAPS.has(zoneId) });
    writeFileSync(join(outDir, zoneId + '.json'), JSON.stringify(grid));
    console.log('wrote', zoneId, 'cells', grid.cols + 'x' + grid.rows, 'coverage', grid.coverage.toFixed(2), 'samples', grid.sampleCount);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
