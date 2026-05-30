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
});
