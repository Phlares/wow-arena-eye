import { describe, it, expect } from 'vitest';
import { resolvePosition, positionAt, distanceAt, MAX_GAP_SEC, PRE_CAST_VALID_SEC } from '../src/metrics/positionTracks.js';
import type { PositionTrack } from '../src/metrics/types.js';

const track = (samples: PositionTrack['samples'], breaks: number[] = []): PositionTrack =>
  ({ unitId: 'U', samples, breaks });

describe('distance primitive (base)', () => {
  it('lerps between bracketing samples', () => {
    const t = track([{ tSec: 0, x: 0, y: 0 }, { tSec: 2, x: 10, y: 0 }]);
    expect(positionAt(t, 1)!.x).toBeCloseTo(5);
  });

  it('returns undefined when no real sample is within MAX_GAP_SEC', () => {
    const t = track([{ tSec: 0, x: 0, y: 0 }, { tSec: 100, x: 0, y: 0 }]);
    expect(resolvePosition(t, 50).position).toBeUndefined();
    expect(MAX_GAP_SEC).toBe(3);
  });

  it('clamps to an endpoint only within MAX_GAP_SEC', () => {
    const t = track([{ tSec: 10, x: 5, y: 5 }]);
    expect(positionAt(t, 11)!.x).toBe(5);          // 1s after last → held
    expect(positionAt(t, 20)).toBeUndefined();     // 10s after last → unknown
    expect(positionAt(t, 8)!.x).toBe(5);           // 2s before first → held
  });

  it('returns up to 3 most-recent real samples with timestamps on an unresolved query', () => {
    const t = track([{ tSec: 0, x: 0, y: 0 }, { tSec: 1, x: 1, y: 0 }, { tSec: 2, x: 2, y: 0 }, { tSec: 3, x: 3, y: 0 }, { tSec: 100, x: 9, y: 9 }]);
    const q = resolvePosition(t, 50);
    expect(q.position).toBeUndefined();
    expect(q.lastKnown.map((s) => s.tSec)).toEqual([3, 2, 1]); // most-recent-first, ≤ query, capped at 3
  });

  it('computes 2D Euclidean distance in yards; undefined if either side unresolved', () => {
    const a = track([{ tSec: 0, x: 0, y: 0 }, { tSec: 2, x: 0, y: 0 }]);
    const b = track([{ tSec: 0, x: 3, y: 4 }, { tSec: 2, x: 3, y: 4 }]);
    expect(distanceAt(a, b, 1)).toBeCloseTo(5);
    const empty = track([]);
    expect(distanceAt(a, empty, 1)).toBeUndefined();
  });

});

describe('mobility-aware interpolation', () => {
  // Sample at 0 (x=0) and at 4 (x=100). A teleport cast (break) at t=2.
  // Without break handling this would lerp to x≈50 at t=3; with it, it must NOT.
  const t = { unitId: 'U', samples: [{ tSec: 0, x: 0, y: 0 }, { tSec: 4, x: 100, y: 0 }], breaks: [2] };

  it('does not lerp across a teleport break', () => {
    // valid pre-cast region: up to 2 - 0.5 = 1.5s → holds the pre-sample (x=0)
    expect(positionAt(t, 1.4)!.x).toBe(0);
    expect(PRE_CAST_VALID_SEC).toBe(0.5);
  });

  it('returns undefined during the transit gap (after Tc-0.5, before the landing sample)', () => {
    expect(positionAt(t, 1.6)).toBeUndefined(); // inside transit
    expect(positionAt(t, 3.5)).toBeUndefined(); // still before landing sample at 4
  });

  it('resolves normally once past the landing sample (no break in the new bracket)', () => {
    const t2 = { unitId: 'U', samples: [{ tSec: 0, x: 0, y: 0 }, { tSec: 4, x: 100, y: 0 }, { tSec: 6, x: 120, y: 0 }], breaks: [2] };
    expect(positionAt(t2, 5)!.x).toBeCloseTo(110); // bracket [4,6], no break between → lerp
  });

  it('returns undefined in the pre-cast region when the gap guard also fails', () => {
    // Break at 5; query 4 is pre-cast (4 ≤ 5-0.5) but the last pre-sample is 4s back (> MAX_GAP_SEC).
    const tg = { unitId: 'U', samples: [{ tSec: 0, x: 0, y: 0 }, { tSec: 10, x: 100, y: 0 }], breaks: [5] };
    expect(positionAt(tg, 4)).toBeUndefined();
  });
});
