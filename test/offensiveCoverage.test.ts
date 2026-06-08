import { describe, it, expect } from 'vitest';
import { isOffensiveCd, offensiveCdMeta } from '../src/metadata/cooldowns.js';

// Current-retail (12.0.x) burst cooldowns across specs that the GO tracks must recognize. Mix of
// vendor-tagged, MiniCC-highlight, and curated-supplement ids — all must resolve via the union.
const KNOWN_BURST: [number, string][] = [
  [1719, 'Recklessness'],
  [360194, 'Deathmark'],
  [51271, 'Pillar of Frost'],
  [191427, 'Metamorphosis'],
  [113860, 'Dark Soul: Misery'],
  [113858, 'Dark Soul: Instability'],
  [288613, 'Trueshot'],
  [190319, 'Combustion'],
  [31884, 'Avenging Wrath'],
  [194223, 'Celestial Alignment'],
  [114050, 'Ascendance (Elemental)'],
  [228260, 'Void Eruption'],
  [137639, 'Storm, Earth, and Fire'],
  [375087, 'Dragonrage'],
];

describe('offensive-CD coverage', () => {
  it.each(KNOWN_BURST)('isOffensiveCd(%i) is true (%s)', (id) => {
    expect(isOffensiveCd(id), `${id} should be offensive`).toBe(true);
  });

  it('curated pet-summons expose a window duration', () => {
    const darkglare = offensiveCdMeta(205180); // Summon Darkglare
    expect(darkglare?.kind).toBe('pet-summon');
    expect(darkglare?.windowSec).toBeGreaterThan(0);
  });

  it('returns undefined meta for an unknown spell', () => {
    expect(offensiveCdMeta(999999)).toBeUndefined();
    expect(isOffensiveCd(999999)).toBe(false);
  });
});
