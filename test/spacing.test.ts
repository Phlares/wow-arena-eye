import { describe, it, expect } from 'vitest';
import { attachSpacing, MELEE_YD, HEAL_RANGE_YD } from '../src/metrics/spacing.js';
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
