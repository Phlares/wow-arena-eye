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

/** Build an OccluderGrid from observed world positions. */
export function buildOccluderGrid(zoneId, positions, opts = {}) {
  const cellSize = opts.cellSize ?? 2;
  const saturationCount = opts.saturationCount ?? 8;
  const voidThreshold = opts.voidThreshold ?? 0.5; // cells this void-or-more are flood-fill-traversable
  const isZAxisMap = !!opts.isZAxisMap;
  const bounds = opts.bounds ?? boundsOf(positions, cellSize);
  const cols = Math.max(1, Math.floor((bounds.maxX - bounds.minX) / cellSize));
  const rows = Math.max(1, Math.floor((bounds.maxY - bounds.minY) / cellSize));
  const counts = new Array(cols * rows).fill(0);
  for (const p of positions) { const { col, row } = worldToCell(bounds, cellSize, p.x, p.y); counts[row * cols + col]++; }
  // void-ness = 1 - min(visits/saturation, 1)
  const voidness = counts.map((n) => 1 - Math.min(n / saturationCount, 1));
  // exterior void (border-reachable) → zeroed; only enclosed void stays occluder
  const ext = floodFillExterior(voidness, cols, rows, voidThreshold);
  for (let i = 0; i < voidness.length; i++) if (ext[i]) voidness[i] = 0;
  const walkable = counts.filter((n) => n >= saturationCount).length;
  const inb = counts.filter((n) => n > 0).length || 1; // || 1 avoids /0 on an empty/unvisited grid
  return { zoneId, bounds, cellSize, cols, rows, voidness, sampleCount: positions.length, coverage: walkable / inb, isZAxisMap };
}

const MIN_SAMPLES = 200; // fewer observed positions than this → too sparse to infer a usable grid; skip the arena

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

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
