import { describe, it, expect } from 'vitest';
import { resolvePlayer } from '../src/metrics/types.js';

const units = {
  P: { type: 1 },                 // player
  Pet: { type: 3, ownerId: 'P' }, // primary pet of P
  Orphan: { type: 3, ownerId: '0' },
  NPC: { type: 2 },               // creature/totem
};

describe('resolvePlayer', () => {
  it('returns a player unit as itself', () => expect(resolvePlayer(units, 'P')).toBe('P'));
  it('rolls a pet up to its player owner', () => expect(resolvePlayer(units, 'Pet')).toBe('P'));
  it('returns undefined for a pet with no real owner', () => expect(resolvePlayer(units, 'Orphan')).toBeUndefined());
  it('returns undefined for a non-player', () => expect(resolvePlayer(units, 'NPC')).toBeUndefined());
  it('returns undefined for unknown / missing id', () => {
    expect(resolvePlayer(units, 'Nope')).toBeUndefined();
    expect(resolvePlayer(units, undefined)).toBeUndefined();
  });
});
