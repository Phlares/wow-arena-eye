import { describe, it, expect } from 'vitest';
import { resolvePlayerUnitId } from '../src/store/resolvePlayer.js';

const units = {
  'Player-1-AAA': { name: 'Phlares-Stormrage-US' },
  'Player-2-BBB': { name: 'Friendo-Area52-US' },
};

describe('resolvePlayerUnitId', () => {
  it('prefers the parser auto-detected playerId when it exists in units', () => {
    expect(resolvePlayerUnitId({ playerId: 'Player-1-AAA', units }, [])).toBe('Player-1-AAA');
  });
  it('falls back to the registry by GUID when playerId is absent', () => {
    expect(resolvePlayerUnitId({ units }, [{ guid: 'Player-2-BBB' }])).toBe('Player-2-BBB');
  });
  it('falls back to the registry by name+realm prefix (covers any of my characters)', () => {
    expect(resolvePlayerUnitId({ units }, [{ name: 'Phlares', realm: 'Stormrage' }])).toBe('Player-1-AAA');
  });
  it('ignores a stale playerId not present in units, falling through to the registry', () => {
    expect(resolvePlayerUnitId({ playerId: 'Player-9-ZZZ', units }, [{ guid: 'Player-1-AAA' }])).toBe('Player-1-AAA');
  });
  it('returns undefined when nothing matches', () => {
    expect(resolvePlayerUnitId({ units }, [{ guid: 'Player-9-ZZZ' }])).toBeUndefined();
    expect(resolvePlayerUnitId({ units }, [])).toBeUndefined();
  });
});
