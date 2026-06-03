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
  // Half-cell point sampling. Blind spot: a ray that only CORNER-CLIPS a 1-cell occluder
  // (chord < ~1 cell) can step over it and read 'clear'; head-on passes and thicker walls are
  // reliable. True angular precision is the deferred 3-III vector-fit, not finer sampling.
  const n = Math.max(1, Math.ceil(len / (grid.cellSize / 2)));
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const v = voidnessAt(grid, a.x + dx * f, a.y + dy * f);
    if (v > peak) peak = v;
  }
  const result = peak >= BLOCKED_MIN ? 'blocked' : peak >= CLEAR_MAX ? 'likely-blocked' : 'clear';
  return { result, occlusion: peak, approximate };
}
