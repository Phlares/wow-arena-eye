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
