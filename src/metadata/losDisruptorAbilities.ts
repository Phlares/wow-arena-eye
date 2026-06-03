/** Curated line-of-sight-disruptor ability metadata. Small, hand-maintained, refreshed per
 *  patch like spells.curated.json / repositioning.ts. NOT generated.
 *
 *  Keyed by the CAST spell id — the id that appears as SPELL_CAST_SUCCESS in the combat log.
 *
 *  Verified for the current retail build (12.0.5 "Midnight") on 2026-06-03:
 *
 *  - Smoke Bomb (Rogue): cast id 76577. 8 yd radius cloud, 5 s. Spawns Area Trigger 1461.
 *    Enemies cannot target into/out of the cloud — geometrically MODELED as a sphere.
 *    https://www.wowhead.com/spell=76577/smoke-bomb
 *    (NOTE: the plan's starting id 212183 was incorrect — corrected to 76577.)
 *  - Ice Wall (Mage PvP talent): cast id 352278. 15 s wall (30 yd long) obstructing LoS,
 *    1.5 min CD. Flag-only (no radius): a long line wall, not a sphere.
 *    https://www.wowhead.com/spell=352278/ice-wall
 *    (NOTE: the plan's starting duration 8000 ms was wrong — corrected to 15000 ms.)
 *  - Deep Breath (Evoker): cast id 357210. 6 s flight, 2 min CD. Flag-only (no radius):
 *    a moving caster, not a fixed occluder.
 *    https://www.wowhead.com/spell=357210/deep-breath  /  https://warcraft.wiki.gg/wiki/Deep_Breath
 */

import type { DisruptorKind } from '../metrics/types.js';

export interface DisruptorAbility {
  kind: DisruptorKind; name: string; modeled: boolean;
  radius?: number;       // yards, for modeled sphere (smoke bomb)
  durationMs: number;    // active window when not derivable from an aura
}

export const DISRUPTOR_ABILITIES: Map<number, DisruptorAbility> = new Map([
  [76577,  { kind: 'smoke-bomb',  name: 'Smoke Bomb',  modeled: true,  radius: 8, durationMs: 5000 }],
  [352278, { kind: 'ice-wall',    name: 'Ice Wall',    modeled: false,            durationMs: 15000 }],
  [357210, { kind: 'deep-breath', name: 'Deep Breath', modeled: false,            durationMs: 6000 }],
]);

export function disruptorOf(spellId: number | undefined): DisruptorAbility | undefined {
  return spellId === undefined ? undefined : DISRUPTOR_ABILITIES.get(spellId);
}
