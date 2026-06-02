import { describe, it, expect } from 'vitest';
import { isMobility, anchorInfo, MOBILITY_ABILITIES, ANCHOR_ABILITIES } from '../src/metadata/repositioning.js';

describe('repositioning metadata', () => {
  it('flags seeded mobility abilities', () => {
    expect(isMobility(1953)).toBe(true);   // Blink
    expect(isMobility(48020)).toBe(true);  // Demonic Circle: Teleport
    expect(isMobility(8936)).toBe(false);  // Regrowth (not mobility)
    expect(isMobility(undefined)).toBe(false);
    expect(MOBILITY_ABILITIES.size).toBeGreaterThanOrEqual(5);
  });

  it('resolves Demon Circle as an anchor ability with its return spell + cooldown', () => {
    const a = anchorInfo(48018); // Summon Demonic Circle
    expect(a).toBeDefined();
    expect(a!.returnSpellId).toBe(48020);
    expect(a!.returnCooldownMs).toBe(30_000);
    expect(anchorInfo(1953)).toBeUndefined();
    expect(ANCHOR_ABILITIES.has(48018)).toBe(true);
  });
});
