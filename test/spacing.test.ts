import { describe, it, expect } from 'vitest';
import { attachSpacing, computeDistanceBands, MELEE_YD, HEAL_RANGE_YD } from '../src/metrics/spacing.js';
import type { UnitMetrics, PositionTrack, Sample } from '../src/metrics/types.js';

// Dense (1s-apart) "standing still at (x,y)" track over 0..durSec, so every queried tick is
// within MAX_GAP_SEC (3s) of a real sample and resolves. Sparse samples would (correctly) be
// dropped by the gap guard — keep fixtures dense.
const still = (x: number, y: number, durSec = 20): Sample[] =>
  Array.from({ length: durSec + 1 }, (_, i) => ({ tSec: i, x, y }));

function unit(unitId: string, team: 'friendly' | 'enemy', track: Sample[]): UnitMetrics {
  return { unitId, name: unitId, kind: 'player', team, track, spacing: { meleeRangeSec: 0, isolatedSec: 0 } } as unknown as UnitMetrics;
}
const trackOf = (u: UnitMetrics): [string, PositionTrack] => [u.unitId, { unitId: u.unitId, samples: u.track, breaks: [] }];

describe('attachSpacing', () => {
  it('counts time within melee range of an enemy', () => {
    const P = unit('P', 'friendly', still(0, 0));
    const E = unit('E', 'enemy', still(3, 0));
    const out = attachSpacing([P, E], new Map([trackOf(P), trackOf(E)]));
    const p = out.find((u) => u.unitId === 'P')!;
    expect(p.spacing.meleeRangeSec).toBeGreaterThan(9); // ~20s in melee
    expect(MELEE_YD).toBe(8);
  });

  it('counts time isolated from allies (nearest ally beyond HEAL_RANGE_YD)', () => {
    const P = unit('P', 'friendly', still(0, 0));
    const Q = unit('Q', 'friendly', still(60, 0));
    const p = attachSpacing([P, Q], new Map([trackOf(P), trackOf(Q)])).find((u) => u.unitId === 'P')!;
    expect(p.spacing.isolatedSec).toBeGreaterThan(9);
    expect(HEAL_RANGE_YD).toBe(40);
  });

  it('gives non-player units a zero summary', () => {
    const pet = { unitId: 'PET', name: 'PET', kind: 'primary-pet', team: 'friendly', track: [], spacing: { meleeRangeSec: 0, isolatedSec: 0 } } as unknown as UnitMetrics;
    const out = attachSpacing([pet], new Map());
    expect(out[0].spacing).toEqual({ meleeRangeSec: 0, isolatedSec: 0 });
  });
});

describe('computeDistanceBands', () => {
  it('classifies a constant-distance pair into one band, fractions summing to 1', () => {
    const A = unit('A', 'friendly', still(0, 0));
    const B = unit('B', 'enemy', still(3, 0));
    const rows = computeDistanceBands([A, B], new Map([trackOf(A), trackOf(B)]));
    expect(rows).toHaveLength(1); // one unordered pair
    const r = rows[0];
    expect(r.b0_5).toBeCloseTo(1);
    expect(r.b5_25 + r.b25_40 + r.b40plus).toBeCloseTo(0);
    expect(r.sampledSec).toBeGreaterThan(9);
  });

  it('excludes unresolved ticks from sampledSec (no inflation across gaps)', () => {
    const A = unit('A', 'friendly', [{ tSec: 0, x: 0, y: 0 }, { tSec: 100, x: 0, y: 0 }]);
    const B = unit('B', 'enemy', [{ tSec: 0, x: 3, y: 0 }, { tSec: 100, x: 3, y: 0 }]);
    const r = computeDistanceBands([A, B], new Map([trackOf(A), trackOf(B)]))[0];
    expect(r.sampledSec).toBeLessThan(20);
  });

  it('spreads a separating pair across all four bands, fractions summing to 1', () => {
    // A at origin; B walks from 3yd → 60yd over 20s, so distance sweeps 0–5, 5–25, 25–40, 40+.
    const A = unit('A', 'friendly', still(0, 0));
    const B = unit('B', 'enemy', Array.from({ length: 21 }, (_, i) => ({ tSec: i, x: 3 + 57 * (i / 20), y: 0 })));
    const r = computeDistanceBands([A, B], new Map([trackOf(A), trackOf(B)]))[0];
    expect(r.b0_5).toBeGreaterThan(0);
    expect(r.b5_25).toBeGreaterThan(0);
    expect(r.b25_40).toBeGreaterThan(0);
    expect(r.b40plus).toBeGreaterThan(0);
    expect(r.b0_5 + r.b5_25 + r.b25_40 + r.b40plus).toBeCloseTo(1);
  });
});
