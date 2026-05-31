import { describe, it, expect } from 'vitest';
import { groupUnits } from '../src/metrics/grouping.js';
import type { UnitMetrics } from '../src/metrics/types.js';

function u(over: Partial<UnitMetrics> & Pick<UnitMetrics, 'unitId' | 'kind' | 'team'>): UnitMetrics {
  return {
    name: over.unitId, spec: undefined, ownerId: undefined,
    casts: 0, topCasts: [], interruptsLanded: 0, interruptsLandedBySpell: [],
    dispels: 0, purges: 0, purgesBySpell: [], cleanses: 0, cleansesBySpell: [],
    spellsteals: 0, spellstealsBySpell: [], deaths: 0, deathTimesSec: [],
    distanceMoved: 0, positionSamples: 0, timeStationarySec: 0,
    track: [], interruptsSuffered: 0, interruptsSufferedBySpell: [], ccTaken: 0,
    ccTakenByCategory: [], deathsWhileCcd: 0, deathsWhileCcdBySpell: [],
    defensivesUsed: 0, defensivesUsedBySpell: [], defensivesIntoBurst: 0,
    timeControlledSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0,
    damageDone: 0, healingDone: 0, absorbDone: 0, dps: 0, hps: 0, ...over,
  } as UnitMetrics;
}

describe('groupUnits', () => {
  const units: UnitMetrics[] = [
    u({ unitId: 'P', kind: 'player', team: 'friendly', casts: 10 }),
    u({ unitId: 'PET', kind: 'primary-pet', team: 'friendly', ownerId: 'P', interruptsLanded: 1, interruptsLandedBySpell: [{ spellName: 'Polymorph', count: 1 }], purges: 2, dispels: 2 }),
    u({ unitId: 'E', kind: 'player', team: 'enemy', casts: 8 }),
    u({ unitId: 'ORPHAN', kind: 'temp-pet', team: 'enemy', ownerId: 'GONE' }),
  ];
  const teams = groupUnits(units, 'P');

  it('splits teams and nests pets under owners', () => {
    const friendly = teams.find((t) => t.team === 'friendly')!;
    expect(friendly.players.map((p) => p.player.unitId)).toEqual(['P']);
    expect(friendly.players[0].pets.map((p) => p.unitId)).toEqual(['PET']);
  });

  it('computes combined = player + pets', () => {
    const pg = teams.find((t) => t.team === 'friendly')!.players[0];
    expect(pg.combined.casts).toBe(10);
    expect(pg.combined.interruptsLanded).toBe(1);
    expect(pg.combined.purges).toBe(2);
    expect(pg.combined.interruptsLandedBySpell).toEqual([{ spellName: 'Polymorph', count: 1 }]);
  });

  it('buckets pets whose owner is not a known player', () => {
    const enemy = teams.find((t) => t.team === 'enemy')!;
    expect(enemy.unownedPets.map((p) => p.unitId)).toEqual(['ORPHAN']);
  });

  it('combines damage/healing across player+pets', () => {
    const units = [
      u({ unitId: 'P', kind: 'player', team: 'friendly', damageDone: 1000, healingDone: 0 }),
      u({ unitId: 'PET', kind: 'primary-pet', team: 'friendly', ownerId: 'P', damageDone: 400, healingDone: 0 }),
    ];
    const pg = groupUnits(units, 'P').find((t) => t.team === 'friendly')!.players[0];
    expect(pg.combined.damageDone).toBe(1400);
    expect(pg.combined.healingDone).toBe(0);
  });
});
