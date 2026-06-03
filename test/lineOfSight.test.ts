import { describe, it, expect } from 'vitest';
import { losBetween, losAt, clearFraction, CLEAR_MAX, BLOCKED_MIN } from '../src/metrics/lineOfSight.js';
import type { OccluderGrid, PositionTrack } from '../src/metrics/types.js';

// 10x10 grid, 2yd cells, 20x20yd. A solid 2x2 occluder block at cols 4-5, rows 4-5 (world ~8-12).
function gridWithCentralPillar(isZAxisMap = false): OccluderGrid {
  const cols = 10, rows = 10;
  const voidness = new Array(cols * rows).fill(0);
  for (const [c, r] of [[4,4],[5,4],[4,5],[5,5]]) voidness[r * cols + c] = 1;
  return { zoneId: 'T', bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, cellSize: 2, cols, rows, voidness, sampleCount: 9999, coverage: 0.9, isZAxisMap };
}

const dense = (id: string, x: number, y: number): PositionTrack =>
  ({ unitId: id, samples: Array.from({ length: 11 }, (_, i) => ({ tSec: i, x, y })), breaks: [] });

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

describe('clearFraction', () => {
  it('is ~1 for a pair with clear LoS the whole window, ~0 when blocked throughout', () => {
    const g = gridWithCentralPillar();
    const top = clearFraction(g, dense('A', 2, 2), dense('B', 18, 2), 0, 10); // top edge, no pillar
    const thru = clearFraction(g, dense('A', 2, 10), dense('B', 18, 10), 0, 10); // through pillar
    expect(top).toBeCloseTo(1);
    expect(thru).toBeCloseTo(0);
  });
  it('returns undefined when no tick resolves', () => {
    const g = gridWithCentralPillar();
    const A: PositionTrack = { unitId: 'A', samples: [{ tSec: 0, x: 2, y: 2 }], breaks: [] };
    const B: PositionTrack = { unitId: 'B', samples: [{ tSec: 0, x: 4, y: 2 }], breaks: [] };
    expect(clearFraction(g, A, B, 50, 55)).toBeUndefined(); // both tracks end at 0s, window at 50-55s
  });
});
