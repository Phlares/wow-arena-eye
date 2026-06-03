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
