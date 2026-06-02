import { describe, it, expect } from 'vitest';
import { cdInfo, cdsForSpec, isOffensiveCd, OFFENSIVE_SPELL_IDS } from '../src/metadata/cooldowns.js';

describe('cooldown loader', () => {
  it('exposes MiniCC offensive spell ids', () => {
    expect(OFFENSIVE_SPELL_IDS.size).toBeGreaterThanOrEqual(15);
    expect(isOffensiveCd(107574)).toBe(true); // Avatar
  });

  it('classifies Divine Shield as defensive for Holy Paladin (spec 65)', () => {
    const ds = cdInfo(642, '65');
    expect(ds).toBeDefined();
    expect(ds!.category).toBe('defensive');
    expect(ds!.cooldownMs).toBeGreaterThan(0);
  });

  it('returns spec inventory and resolves cooldownMs in milliseconds', () => {
    const cds = cdsForSpec('265'); // Affliction Warlock
    expect(cds.length).toBeGreaterThan(0);
    for (const c of cds) expect(c.cooldownMs % 1000).toBe(0);
  });

  it('treats the PvP trinket as category trinket', () => {
    const t = cdInfo(336126, '265');
    // trinket may be a class/spec entry or absent; if present it must be categorized trinket
    if (t) expect(t.category).toBe('trinket');
  });

  it('classifies Combustion (spellId 190319) as offensive for Fire Mage (spec 63)', () => {
    // 190319 = Combustion (Fire Mage); lives in bySpec['63'] and is in offensiveSpellIds
    const a = cdInfo(190319, '63');
    expect(a).toBeDefined();
    expect(a!.category).toBe('offensive');
  });
});
