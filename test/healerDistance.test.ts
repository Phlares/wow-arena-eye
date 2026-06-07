import { describe, it, expect } from 'vitest';
import { attachSpacing } from '../src/metrics/spacing.js';
import type { UnitMetrics, PositionTrack } from '../src/metrics/types.js';

function unit(over: Partial<UnitMetrics>): UnitMetrics {
  return {
    unitId: 'x', name: 'x', kind: 'player', team: 'friendly', spec: '265',
    casts: 0, topCasts: [], interruptsLanded: 0, interruptsLandedBySpell: [], dispels: 0, purges: 0,
    purgesBySpell: [], cleanses: 0, cleansesBySpell: [], spellsteals: 0, spellstealsBySpell: [],
    deaths: 0, deathTimesSec: [], distanceMoved: 0, positionSamples: 0, timeStationarySec: 0, track: [],
    spacing: { meleeRangeSec: 0, isolatedSec: 0 }, interruptsSuffered: 0, interruptsSufferedBySpell: [],
    precognitionUptimeSec: 0, enemyPrecognitionUptimeSec: 0, deathsWhileCcd: 0, deathsWhileCcdBySpell: [],
    defensivesUsed: 0, defensivesUsedBySpell: [], defensivesIntoBurst: 0, cdUsage: [],
    ccReceived: {} as never, ccDone: {} as never, immuneReceived: {} as never, immuneDone: {} as never,
    damageDone: 0, healingDone: 0, absorbDone: 0, dps: 0, hps: 0, avgHealerDistanceYd: null, ...over,
  };
}

const tr = (id: string, x: number): PositionTrack => ({ unitId: id, breaks: [], samples: [{ tSec: 0, x, y: 0 }, { tSec: 1, x, y: 0 }] });

it('averages the player-to-friendly-healer distance', () => {
  const me = unit({ unitId: 'P', spec: '265' });     // warlock
  const healer = unit({ unitId: 'H', spec: '256' });  // disc priest ∈ HEALER_SPEC_IDS
  const tracks = new Map([['P', tr('P', 0)], ['H', tr('H', 10)]]);
  const out = attachSpacing([me, healer], tracks).find((u) => u.unitId === 'P')!;
  expect(out.avgHealerDistanceYd).toBeCloseTo(10, 1);
});
it('is null when the team has no healer', () => {
  const me = unit({ unitId: 'P', spec: '265' });
  const dps = unit({ unitId: 'D', spec: '577' });     // havoc DH, not a healer
  const tracks = new Map([['P', tr('P', 0)], ['D', tr('D', 10)]]);
  expect(attachSpacing([me, dps], tracks).find((u) => u.unitId === 'P')!.avgHealerDistanceYd).toBeNull();
});
