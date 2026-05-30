import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { computeMatchMetrics } from '../src/metrics/metrics.js';
import { parseLogFile } from '../src/parser/parserClient.js';

function synth() {
  return {
    playerId: 'P',
    durationInSeconds: 60,
    units: { P: { name: 'You', type: 'Player' }, E: { name: 'Enemy', type: 'Player' } },
    events: [
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Agony' },
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Agony' },
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Corruption' },
      { logLine: { event: 'SPELL_INTERRUPT' }, srcUnitId: 'P', destUnitId: 'E', spellName: 'Spell Lock', extraSpellName: 'Chaos Bolt' },
      { logLine: { event: 'SPELL_INTERRUPT' }, srcUnitId: 'E', destUnitId: 'P', spellName: 'Kick', extraSpellName: 'Fear' },
      { logLine: { event: 'SPELL_DISPEL', parameters: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,'BUFF'] }, srcUnitId: 'P', destUnitId: 'E', spellName: 'Devour Magic', extraSpellName: 'Power Word: Shield' },
      { logLine: { event: 'SPELL_DISPEL', parameters: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,'DEBUFF'] }, srcUnitId: 'P', destUnitId: 'P', spellName: 'Devour Magic', extraSpellName: 'Polymorph' },
      { logLine: { event: 'UNIT_DIED' }, destUnitId: 'E' },
    ],
  };
}

describe('computeMatchMetrics (synthetic)', () => {
  const mm = computeMatchMetrics(synth());

  it('counts player casts, casts/min, and top casts', () => {
    expect(mm.player.casts).toBe(3);
    expect(mm.player.castsPerMin).toBeCloseTo(3, 5);
    expect(mm.player.topCasts[0]).toEqual({ spellName: 'Agony', count: 2 });
  });

  it('counts interrupts landed (+ what was kicked) and suffered', () => {
    expect(mm.player.interruptsLanded).toBe(1);
    expect(mm.player.interruptsLandedBySpell).toEqual([{ spellName: 'Chaos Bolt', count: 1 }]);
    expect(mm.player.interruptsSuffered).toBe(1);
    expect(mm.player.interruptsSufferedBySpell).toEqual([{ spellName: 'Fear', count: 1 }]);
  });

  it('splits dispels into purge (buff) and cleanse (debuff)', () => {
    expect(mm.player.dispels).toBe(2);
    expect(mm.player.purges).toBe(1);
    expect(mm.player.cleanses).toBe(1);
  });
});

const FIXTURE = 'test-data/fixtures/arena-sample.log';
describe('computeMatchMetrics (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('produces well-formed metrics for a real match', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const mm = computeMatchMetrics(arenaMatches[0]);
    expect(mm.player.casts).toBeGreaterThan(0);
    expect(Array.isArray(mm.perCombatant)).toBe(true);
    expect(mm.perCombatant.length).toBeGreaterThan(0);
    expect(typeof mm.allyDeaths).toBe('number');
    expect(typeof mm.enemyDeaths).toBe('number');
  });
});
