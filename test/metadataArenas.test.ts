import { describe, it, expect } from 'vitest';
import { mapName } from '../src/metadata/arenas.js';

describe('mapName', () => {
  it('resolves a known zone id', () => {
    expect(mapName('2547')).toBe('Enigma Crucible');
  });
  it('falls back to the raw id when unknown', () => {
    expect(mapName('999999')).toBe('999999');
  });
});
