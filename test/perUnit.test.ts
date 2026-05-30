import { describe, it, expect } from 'vitest';
import { computeUnitMetrics } from '../src/metrics/perUnit.js';

function match() {
  return {
    playerId: 'P',
    units: {
      P: { name: 'You', type: 1, reaction: 1, spec: '265', ownerId: '0' },
      PET: { name: 'Zhaazhem', type: 3, reaction: 1, ownerId: 'P' },
      E: { name: 'Enemy', type: 1, reaction: 2, ownerId: '0' },
    },
    events: [
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Agony', timestamp: 1000, advancedActorPositionX: 0, advancedActorPositionY: 0 },
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Agony', timestamp: 2000, advancedActorPositionX: 3, advancedActorPositionY: 4 },
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'PET', spellName: 'Shadowbite', timestamp: 2500 },
      { logLine: { event: 'SPELL_INTERRUPT' }, srcUnitId: 'PET', destUnitId: 'E', spellName: 'Spell Lock', extraSpellName: 'Polymorph', timestamp: 3000 },
      { logLine: { event: 'SPELL_DISPEL', parameters: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,'BUFF'] }, srcUnitId: 'PET', destUnitId: 'E', spellName: 'Devour Magic', extraSpellName: 'Power Word: Shield', timestamp: 3500 },
      { logLine: { event: 'UNIT_DIED' }, destUnitId: 'E', timestamp: 5000 },
    ],
  };
}

describe('computeUnitMetrics', () => {
  const units = computeUnitMetrics(match());
  const byId = (id: string) => units.find((u) => u.unitId === id)!;

  it('attributes casts to the actual caster (pet casts not on the player)', () => {
    expect(byId('P').casts).toBe(2);
    expect(byId('P').topCasts).toEqual([{ spellName: 'Agony', count: 2 }]);
    expect(byId('PET').casts).toBe(1);
    expect(byId('PET').topCasts).toEqual([{ spellName: 'Shadowbite', count: 1 }]);
  });

  it('puts the pet interrupt + dispel on the pet, classified', () => {
    expect(byId('PET').interruptsLanded).toBe(1);
    expect(byId('PET').interruptsLandedBySpell).toEqual([{ spellName: 'Polymorph', count: 1 }]);
    expect(byId('PET').dispels).toBe(1);
    expect(byId('PET').purges).toBe(1);
    expect(byId('PET').cleanses).toBe(0);
  });

  it('sets kind/team and attributes the death by dest', () => {
    expect(byId('P').kind).toBe('player');
    expect(byId('P').team).toBe('friendly');
    expect(byId('PET').kind).toBe('primary-pet');
    expect(byId('E').team).toBe('enemy');
    expect(byId('E').deaths).toBe(1);
  });

  it('computes movement: (0,0) ignored as no-position, single real sample -> distance 0', () => {
    expect(byId('P').positionSamples).toBe(1);
    expect(byId('P').distanceMoved).toBe(0);
  });
});
