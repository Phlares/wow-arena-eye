import { describe, it, expect } from 'vitest';
import { resolvePlayerUnits } from '../src/metrics/playerUnits.js';

describe('resolvePlayerUnits', () => {
  it('includes the recording player', () => {
    const match = { playerId: 'Player-1-AAA', events: [], units: {} };
    const set = resolvePlayerUnits(match);
    expect(set.has('Player-1-AAA')).toBe(true);
  });

  it('includes a pet summoned by the player', () => {
    const match = {
      playerId: 'Player-1-AAA',
      units: {},
      events: [
        { logLine: { event: 'SPELL_SUMMON' }, srcUnitId: 'Player-1-AAA', destUnitId: 'Creature-1-PET' },
      ],
    };
    const set = resolvePlayerUnits(match);
    expect(set.has('Player-1-AAA')).toBe(true);
    expect(set.has('Creature-1-PET')).toBe(true);
  });

  it('returns an empty set when playerId is missing', () => {
    const set = resolvePlayerUnits({ events: [], units: {} });
    expect(set.size).toBe(0);
  });

  it('includes a pre-summoned pet with NO summon event when units[id].ownerId === player', () => {
    // Simulates a warlock Felhunter that was summoned before the arena started.
    // No SPELL_SUMMON event fires in the log window, but the parser populates
    // unit.ownerId from the advanced-log owner GUID field.
    const match = {
      playerId: 'Player-60-0E38D99F',
      units: {
        'Pet-0-4219-1825-11612-417-ABCDEF': {
          id: 'Pet-0-4219-1825-11612-417-ABCDEF',
          name: 'Zhaazhem',
          ownerId: 'Player-60-0E38D99F',
        },
        'Player-60-OPPONENT': {
          id: 'Player-60-OPPONENT',
          name: 'EnemyPlayer',
          ownerId: '',
        },
      },
      events: [],
    };
    const set = resolvePlayerUnits(match);
    expect(set.has('Player-60-0E38D99F')).toBe(true);
    expect(set.has('Pet-0-4219-1825-11612-417-ABCDEF')).toBe(true);
    // Opponent player without matching ownerId must NOT be included
    expect(set.has('Player-60-OPPONENT')).toBe(false);
  });

  it('includes a pre-summoned pet via unit.ownerId (no summon event)', () => {
    const match = {
      playerId: 'Player-1-AAA',
      events: [],
      units: {
        'Player-1-AAA': { name: 'You', ownerId: '0' },
        'Creature-FELHUNTER': { name: 'Zhaazhem', ownerId: 'Player-1-AAA' },
        'Player-2-ENEMY': { name: 'Enemy', ownerId: '0' },
        'Creature-ENEMYPET': { name: 'Imp', ownerId: 'Player-2-ENEMY' },
      },
    };
    const set = resolvePlayerUnits(match);
    expect(set.has('Player-1-AAA')).toBe(true);
    expect(set.has('Creature-FELHUNTER')).toBe(true);   // owned by player → included
    expect(set.has('Player-2-ENEMY')).toBe(false);      // a player, ownerId '0' → excluded
    expect(set.has('Creature-ENEMYPET')).toBe(false);   // owned by enemy → excluded
  });
});
