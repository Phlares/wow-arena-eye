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

describe('computeMatchMetrics ally/enemy death split', () => {
  it('splits non-player deaths by unit reaction', () => {
    const match = {
      playerId: 'P',
      durationInSeconds: 60,
      units: {
        P: { name: 'You', reaction: 1 },        // friendly (numeric enum)
        A: { name: 'Ally', reaction: 1 },        // friendly
        E1: { name: 'Enemy1', reaction: 2 },     // hostile
        E2: { name: 'Enemy2', reaction: 2 },     // hostile
        N: { name: 'Neutral', reaction: 0 },     // neutral -> dropped
      },
      events: [
        { logLine: { event: 'UNIT_DIED' }, destUnitId: 'A',  timestamp: 1000 },
        { logLine: { event: 'UNIT_DIED' }, destUnitId: 'E1', timestamp: 2000 },
        { logLine: { event: 'UNIT_DIED' }, destUnitId: 'E2', timestamp: 3000 },
        { logLine: { event: 'UNIT_DIED' }, destUnitId: 'N',  timestamp: 4000 },
        { logLine: { event: 'UNIT_DIED' }, destUnitId: 'P',  timestamp: 5000 }, // player's own death -> not ally
      ],
    };
    const mm = computeMatchMetrics(match);
    expect(mm.allyDeaths).toBe(1);    // A only (P excluded, counted as player death)
    expect(mm.enemyDeaths).toBe(2);   // E1, E2
    expect(mm.player.deaths).toBe(1); // P
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
