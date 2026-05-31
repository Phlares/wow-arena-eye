import { describe, it, expect } from 'vitest';
import { computeUnitMetrics } from '../src/metrics/perUnit.js';
import { buildAuraState } from '../src/metrics/auraState.js';

function run(m: any) { return computeUnitMetrics(m, buildAuraState(m)); }

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
  const units = run(match());
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

describe('computeUnitMetrics dispel counting', () => {
  it('counts a dispel with unresolved auraType in dispels but not purge/cleanse', () => {
    const units = run({
      playerId: 'P',
      units: { P: { name: 'You', type: 1, reaction: 1 } },
      events: [
        // SPELL_DISPEL with NO parameters[14] -> auraType undefined
        { logLine: { event: 'SPELL_DISPEL' }, srcUnitId: 'P', destUnitId: 'P', spellName: 'Dispel', extraSpellName: 'Something', timestamp: 1000 },
      ],
    });
    const p = units.find((u) => u.unitId === 'P')!;
    expect(p.dispels).toBe(1);
    expect(p.purges).toBe(0);
    expect(p.cleanses).toBe(0);
  });
});

describe('perUnit Phase 4/5', () => {
  const match = {
    playerId: 'P', durationInSeconds: 100,
    units: {
      P: { name: 'You', type: 1, reaction: 1 },
      E: { name: 'Enemy', type: 1, reaction: 2 },
      ALLY: { name: 'Ally', type: 1, reaction: 1 },
    },
    events: [
      { logLine: { event: 'SPELL_INTERRUPT' }, srcUnitId: 'E', destUnitId: 'P', spellName: 'Counterspell', extraSpellName: 'Polymorph', timestamp: 1000 },
      { logLine: { event: 'SPELL_AURA_APPLIED' }, srcUnitId: 'E', destUnitId: 'P', spellId: 408, spellName: 'Kidney Shot', timestamp: 2000 },
      { logLine: { event: 'UNIT_DIED' }, destUnitId: 'P', timestamp: 3000 },
      { logLine: { event: 'SPELL_AURA_REMOVED' }, destUnitId: 'P', spellId: 408, spellName: 'Kidney Shot', timestamp: 4000 },
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellId: 104773, spellName: 'Unending Resolve', timestamp: 2500 },
      { logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'P', destUnitId: 'E', spellName: 'Chaos Bolt', amount: 1000, timestamp: 5000 },
      { logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'P', destUnitId: 'ALLY', spellName: 'Rain of Fire', amount: 50, timestamp: 5500 },
      { logLine: { event: 'SPELL_HEAL' }, srcUnitId: 'ALLY', destUnitId: 'P', spellName: 'Heal', amount: 300, timestamp: 6000 },
    ],
  };
  const units = run(match);
  const me = units.find((u) => u.unitId === 'P')!;

  it('counts interrupts suffered + what got kicked', () => {
    expect(me.interruptsSuffered).toBe(1);
    expect(me.interruptsSufferedBySpell).toEqual([{ spellName: 'Polymorph', count: 1 }]);
  });
  it('detects death while CC-d (stun active at death)', () => {
    expect(me.deathsWhileCcd).toBe(1);
    expect(me.deathsWhileCcdBySpell).toEqual([{ spellName: 'Kidney Shot', count: 1 }]);
  });
  it('counts defensives used', () => {
    expect(me.defensivesUsed).toBe(1);
    expect(me.defensivesUsedBySpell).toEqual([{ spellName: 'Unending Resolve', count: 1 }]);
  });
  it('attributes damage with friendly-fire exclusion + dps per second', () => {
    expect(me.damageDone).toBe(1000);   // hit on E counts; hit on friendly ALLY excluded
    expect(me.dps).toBe(10);            // 1000 / 100s = 10 dps (PER SECOND)
  });
  it('attributes healing to the healer', () => {
    expect(me.healingDone).toBe(0);
    expect(units.find((u) => u.unitId === 'ALLY')!.healingDone).toBe(300);
  });
});
