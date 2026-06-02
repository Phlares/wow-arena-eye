/** Curated positional-ability metadata. Small, hand-maintained, refreshed per patch like
 *  spells.curated.json. NOT generated. */

export interface AnchorAbility { name: string; returnSpellId: number; returnCooldownMs: number; }

/** Abilities that INSTANTLY relocate the caster — interpolation must not smear across them
 *  (a teleport between two samples is a jump, not a glide). Seeded with the common ones;
 *  extend per spec/class as needed. */
export const MOBILITY_ABILITIES: Set<number> = new Set([
  48020, // Demonic Circle: Teleport (Warlock)
  36554, // Shadowstep (Rogue)
  1953,  // Blink (Mage)
  6544,  // Heroic Leap (Warrior)
  781,   // Disengage (Hunter)
]);

/** Anchor-placing abilities: casting places a fixed return point; a paired ability teleports
 *  the caster back to it. Keyed by the PLACEMENT spell id. Seeded with Demon Circle. */
export const ANCHOR_ABILITIES: Map<number, AnchorAbility> = new Map([
  [48018, { name: 'Demonic Circle', returnSpellId: 48020, returnCooldownMs: 30_000 }],
]);

export function isMobility(spellId: number | undefined): boolean {
  return spellId !== undefined && MOBILITY_ABILITIES.has(spellId);
}

export function anchorInfo(spellId: number | undefined): AnchorAbility | undefined {
  return spellId === undefined ? undefined : ANCHOR_ABILITIES.get(spellId);
}
