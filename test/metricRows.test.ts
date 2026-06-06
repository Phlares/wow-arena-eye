import { describe, it, expect } from 'vitest';
import { extractMetricRows, compSignatures } from '../src/store/metricRows.js';
import type { MatchMetrics, UnitMetrics } from '../src/metrics/types.js';

// Minimal UnitMetrics with every field extractMetricRows reads; override per test.
function mkUnit(over: Partial<UnitMetrics>): UnitMetrics {
  return {
    unitId: 'U', name: 'N', kind: 'player', team: 'friendly', spec: '000',
    casts: 0, topCasts: [], interruptsLanded: 0, interruptsLandedBySpell: [],
    dispels: 0, purges: 0, purgesBySpell: [], cleanses: 0, cleansesBySpell: [],
    spellsteals: 0, spellstealsBySpell: [], deaths: 0, deathTimesSec: [],
    distanceMoved: 0, positionSamples: 0, timeStationarySec: 0, track: [],
    spacing: { meleeRangeSec: 0, isolatedSec: 0 },
    interruptsSuffered: 0, interruptsSufferedBySpell: [], precognitionUptimeSec: 0, enemyPrecognitionUptimeSec: 0,
    deathsWhileCcd: 0, deathsWhileCcdBySpell: [],
    defensivesUsed: 0, defensivesUsedBySpell: [], defensivesIntoBurst: 0, cdUsage: [],
    ccReceived: { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0, byCategory: [] },
    ccDone: { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0, byCategory: [] },
    immuneReceived: { spellsImmuned: [], ccImmuned: 0, ccImmunedByCategory: [] },
    immuneDone: { spellsImmuned: [], ccImmuned: 0, ccImmunedByCategory: [] },
    damageDone: 0, healingDone: 0, absorbDone: 0, dps: 0, hps: 0,
    ...over,
  };
}

function mkMetrics(): MatchMetrics {
  const me = mkUnit({ unitId: 'P-ME', name: 'Me-Realm', spec: '265', damageDone: 100, deaths: 1, interruptsLanded: 2 });
  const ally = mkUnit({ unitId: 'P-AL', name: 'Ally-Realm', spec: '256' });
  const foe1 = mkUnit({ unitId: 'P-E1', name: 'Foe1-Realm', spec: '270', team: 'enemy' });
  const foe2 = mkUnit({ unitId: 'P-E2', name: 'Foe2-Realm', spec: '258', team: 'enemy' });
  return {
    teams: [
      { team: 'friendly', players: [{ player: me, pets: [], combined: {} as never }, { player: ally, pets: [], combined: {} as never }], unownedPets: [] },
      { team: 'enemy', players: [{ player: foe1, pets: [], combined: {} as never }, { player: foe2, pets: [], combined: {} as never }], unownedPets: [] },
    ],
    timeline: [], coordination: [
      { team: 'friendly', summary: { targetPriority: [], healerPressureDamage: 5, swaps: 3, attackerFocus: [], alignmentFraction: 0.5, alignedTimeSec: 10 } },
    ],
    focusTracks: { stepMs: 0, tickCount: 0, startMs: 0, tracks: [] },
    offensiveWindows: [], positionTracks: [], distanceBands: [],
    lineOfSight: { zoneId: '1825', resolved: true, approximate: false }, losDisruptors: [],
  };
}

describe('extractMetricRows', () => {
  it('flags exactly the player and emits per-unit scalar metrics', () => {
    const { combatants, metrics } = extractMetricRows(mkMetrics(), 'P-ME');
    expect(combatants.filter((c) => c.isPlayer).map((c) => c.unitId)).toEqual(['P-ME']);
    expect(combatants).toHaveLength(4);
    const dmg = metrics.find((r) => r.scope === 'P-ME' && r.metricId === 'damageDone');
    expect(dmg?.value).toBe(100);
    expect(metrics.find((r) => r.scope === 'P-ME' && r.metricId === 'deaths')?.value).toBe(1);
    expect(metrics.find((r) => r.scope === 'P-ME' && r.metricId === 'interruptsLanded')?.value).toBe(2);
  });

  it('emits team-scoped coordination metrics', () => {
    const { metrics } = extractMetricRows(mkMetrics(), 'P-ME');
    expect(metrics.find((r) => r.scope === 'team:friendly' && r.metricId === 'alignmentFraction')?.value).toBe(0.5);
    expect(metrics.find((r) => r.scope === 'team:friendly' && r.metricId === 'swaps')?.value).toBe(3);
  });

  it('builds sorted ally/enemy comp signatures', () => {
    const { combatants } = extractMetricRows(mkMetrics(), 'P-ME');
    expect(compSignatures(combatants)).toEqual({ ally: '256_265', enemy: '258_270' });
  });
});
