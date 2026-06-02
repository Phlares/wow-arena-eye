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

describe('CC durations', () => {
  it('buckets a stun and an interrupt; totals the union', () => {
    const match = {
      durationInSeconds: 100,
      units: { 'Player-A': { name: 'You', type: 1, reaction: 1 }, 'Player-E': { name: 'Enemy', type: 1, reaction: 2 } },
      events: [
        { logLine: { event: 'SPELL_AURA_APPLIED' }, srcUnitId: 'Player-E', destUnitId: 'Player-A', spellId: '408', spellName: 'Kidney Shot', timestamp: 0 },
        { logLine: { event: 'SPELL_AURA_REMOVED' }, srcUnitId: 'Player-E', destUnitId: 'Player-A', spellId: '408', spellName: 'Kidney Shot', timestamp: 2000 },
        { logLine: { event: 'SPELL_INTERRUPT' }, srcUnitId: 'Player-E', destUnitId: 'Player-A', spellId: '2139', spellName: 'Counterspell', extraSpellName: 'Chaos Bolt', timestamp: 10000 },
        // match continues past the kick so the 6s lockout fits within match end (endMs = 20000)
        { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'Player-E', spellName: 'Filler', timestamp: 20000 },
      ],
    };
    const units = computeUnitMetrics(match, buildAuraState(match));
    const you = units.find((u) => u.unitId === 'Player-A')!;
    expect(you.ccReceived.hardCcSec).toBe(2);       // Kidney Shot 0-2s
    expect(you.ccReceived.castDenialSec).toBe(6);   // Counterspell 6s lockout at 10s
    expect(you.ccReceived.rootSec).toBe(0);
    expect(you.ccReceived.timeSec).toBe(8); // disjoint: 2 + 6
    expect(you.ccReceived.byCategory.find((c) => c.category === 'stun')?.durationSec).toBe(2);
  });
});

describe('CC received/done + immune (perUnit)', () => {
  it('splits received/done, rolls pet CC to owner, counts immuned CC both sides', () => {
    const match = {
      durationInSeconds: 100,
      units: {
        P: { name: 'You', type: 1, reaction: 1 }, Pet: { name: 'Felguard', type: 3, reaction: 1, ownerId: 'P' },
        E: { name: 'Enemy', type: 1, reaction: 2 },
      },
      events: [
        { logLine: { event: 'SPELL_AURA_APPLIED' }, srcUnitId: 'P', destUnitId: 'E', spellId: '408', spellName: 'Kidney Shot', timestamp: 0 },
        { logLine: { event: 'SPELL_AURA_REMOVED' }, srcUnitId: 'P', destUnitId: 'E', spellId: '408', spellName: 'Kidney Shot', timestamp: 2000 },
        { logLine: { event: 'SPELL_AURA_APPLIED' }, srcUnitId: 'Pet', destUnitId: 'E', spellId: '408', spellName: 'Kidney Shot', timestamp: 3000 },
        { logLine: { event: 'SPELL_AURA_REMOVED' }, srcUnitId: 'Pet', destUnitId: 'E', spellId: '408', spellName: 'Kidney Shot', timestamp: 6000 },
        { logLine: { event: 'SPELL_AURA_APPLIED' }, srcUnitId: 'E', destUnitId: 'P', spellId: '118', spellName: 'Polymorph', timestamp: 7000 },
        { logLine: { event: 'SPELL_AURA_REMOVED' }, srcUnitId: 'E', destUnitId: 'P', spellId: '118', spellName: 'Polymorph', timestamp: 13000 },
        // Enemy tries Polymorph on You again, IMMUNE (SPELL_MISSED, missType at param[11])
        { logLine: { event: 'SPELL_MISSED', parameters: ['E','Enemy','0x0','0x0','P','You','0x0','0x0','118','Polymorph','32','IMMUNE'] }, srcUnitId: 'E', destUnitId: 'P', spellId: '118', spellName: 'Polymorph', timestamp: 14000 },
        { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Filler', timestamp: 20000 },
      ],
    };
    const units = computeUnitMetrics(match, buildAuraState(match));
    const you = units.find((u) => u.unitId === 'P')!;
    const enemy = units.find((u) => u.unitId === 'E')!;
    expect(you.ccDone.hardCcSec).toBe(5);     // 2 (self) + 3 (pet) on E
    expect(you.ccDone.count).toBe(2);
    expect(you.ccReceived.hardCcSec).toBe(6); // 6s poly on you
    expect(you.ccReceived.count).toBe(1);
    // immune: enemy's poly on you was immuned → your immuneReceived, enemy's immuneDone
    expect(you.immuneReceived.ccImmuned).toBe(1);
    expect(enemy.immuneDone.ccImmuned).toBe(1);
    expect(you.immuneReceived.spellsImmuned[0].spellName).toBe('Polymorph');
  });

  it("rolls a pet's interrupt lockout into the owner's ccDone cast-denial", () => {
    const match = {
      durationInSeconds: 100,
      units: { P: { name: 'You', type: 1, reaction: 1 }, Pet: { name: 'Felhunter', type: 3, reaction: 1, ownerId: 'P' }, E: { name: 'Enemy', type: 1, reaction: 2 } },
      events: [
        // Felhunter Spell Lock (19647, 6s lockout) interrupts enemy E
        { logLine: { event: 'SPELL_INTERRUPT' }, srcUnitId: 'Pet', destUnitId: 'E', spellId: '19647', spellName: 'Spell Lock', extraSpellName: 'Polymorph', timestamp: 1000 },
        { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Filler', timestamp: 20000 },
      ],
    };
    const you = computeUnitMetrics(match, buildAuraState(match)).find((u) => u.unitId === 'P')!;
    expect(you.ccDone.castDenialSec).toBe(6); // pet's Spell Lock lockout rolled to owner
  });
});

describe('cdUsage per unit', () => {
  it('emits cdUsage for players, categorized and with availability', () => {
    // spec 265 = Affliction Warlock; 104773 = Unending Resolve (WARLOCK class CD, defensive)
    const m = {
      playerId: 'P', durationInSeconds: 300,
      units: {
        P: { name: 'You', type: 1, reaction: 1, spec: '265' },
        E: { name: 'Enemy', type: 1, reaction: 2 },
      },
      events: [
        { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellId: 104773, spellName: 'Unending Resolve', timestamp: 5000 },
        { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellId: 104773, spellName: 'Unending Resolve', timestamp: 200000 },
        // filler so endMs extends beyond the CD window
        { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'E', spellName: 'Fireball', timestamp: 300000 },
      ],
    };
    const units = computeUnitMetrics(m, buildAuraState(m));
    const withCds = units.filter((u) => u.kind === 'player' && u.cdUsage.length > 0);
    expect(withCds.length).toBeGreaterThan(0);
    for (const u of withCds) {
      for (const c of u.cdUsage) {
        expect(c.casts).toBeGreaterThan(0);
        expect(c.availableSec).toBeGreaterThanOrEqual(0);
        expect(['offensive', 'defensive', 'external', 'important', 'trinket']).toContain(c.category);
      }
    }
    const w = units.find((u) => u.unitId === 'P')!;
    const unending = w.cdUsage.find((c) => c.spellId === 104773)!;
    expect(unending).toBeDefined();
    expect(unending.casts).toBe(2);            // matches the two SPELL_CAST_SUCCESS for 104773 in the fixture
    expect(unending.category).toBe('defensive');
    expect(unending.availableSec).toBeGreaterThanOrEqual(0);
    expect(unending.availableSec).toBeLessThanOrEqual(300);
  });
});

describe('absorbDone attribution', () => {
  it('credits the shield owner, not the attacker', () => {
    const match = {
      units: {
        'Player-P': { name: 'You', type: 1, reaction: 1 },
        'Player-E': { name: 'Enemy', type: 1, reaction: 2 },
      },
      events: [
        { logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'Player-E', destUnitId: 'Player-P', amount: 500, timestamp: 900 },
        // Enemy attacks You; You's OWN absorb shield soaks 300. The parser exposes the shield
        // caster as the named field shieldOwnerUnitId and the soaked amount as absorbedAmount.
        {
          logLine: { event: 'SPELL_ABSORBED' },
          srcUnitId: 'Player-E', destUnitId: 'Player-P',
          shieldOwnerUnitId: 'Player-P', absorbedAmount: 300, timestamp: 1000,
        },
      ],
    };
    const units = computeUnitMetrics(match, buildAuraState(match));
    const you = units.find((u) => u.unitId === 'Player-P')!;
    expect(you.absorbDone).toBe(300);
    const enemy = units.find((u) => u.unitId === 'Player-E')!;
    expect(enemy.damageDone).toBe(500); // attacker is present in results...
    expect(enemy.absorbDone).toBe(0);   // ...but is NOT credited the absorb
  });
});
