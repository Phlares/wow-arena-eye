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

// Vendor SpellTag.Offensive entries that are NOT ≥30s burst markers (mobility/utility/legacy ids,
// arena-unusable, or healing/tank variants) — denylisted so they can't pollute GO tracks/bands.
const DENIED: [number, string][] = [
  [36554, 'Shadowstep (mobility)'],
  [14183, 'Premeditation (opener utility)'],
  [207736, 'Shadowy Duel (utility)'],
  [14177, 'Cold Blood (legacy id)'],
  [213981, 'Cold Blood (legacy id)'],
  [205025, 'Presence of Mind (cast utility)'],
  [12043, 'Presence of Mind (legacy id)'],
  [2825, 'Bloodlust (not usable in arena)'],
  [32182, 'Heroism (not usable in arena)'],
  [31842, 'Avenging Wrath (Holy) (healing)'],
  [114052, 'Ascendance (Restoration) (healing)'],
  [102558, 'Incarnation: Guardian of Ursoc (tank)'],
  [187827, 'Metamorphosis (Vengeance) (tank)'],
];

describe('offensive-CD coverage', () => {
  it.each(KNOWN_BURST)('isOffensiveCd(%i) is true (%s)', (id) => {
    expect(isOffensiveCd(id), `${id} should be offensive`).toBe(true);
  });

  it.each(DENIED)('isOffensiveCd(%i) is false — denylisted (%s)', (id) => {
    expect(isOffensiveCd(id), `${id} should be denylisted`).toBe(false);
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
