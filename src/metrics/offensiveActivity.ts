import type { AuraState, Interval } from './auraState.js';
import type { CastEvent } from './cooldownTimeline.js';
import { isOffensiveCd, offensiveCdMeta } from '../metadata/cooldowns.js';

/** Offensive-CD activity intervals for `unitId` (ms domain, unclamped), the shared source for
 *  GO tracks and GO bands: offensive aura intervals the unit applied, plus fixed windows from
 *  pet-summon casts that leave no aura (e.g. Infernal). Summons that DO leave a same-id aura
 *  (Darkglare, live-verified) keep the aura interval — the cast window is skipped when
 *  overlapped, so no double intervals. Sorted by start. */
export function offensiveActivity(unitId: string, auras: AuraState, casts: Map<string, CastEvent[]>): Interval[] {
  const auraIvs = auras.intervalsBy(unitId).filter((iv) => isOffensiveCd(iv.spellId));
  const out = [...auraIvs];
  for (const c of casts.get(unitId) ?? []) {
    const meta = offensiveCdMeta(c.spellId);
    if (meta?.kind !== 'pet-summon' || !meta.windowSec) continue;
    const end = c.ms + meta.windowSec * 1000;
    if (auraIvs.some((iv) => iv.spellId === c.spellId && iv.start < end && iv.end > c.ms)) continue;
    out.push({ srcId: unitId, destId: unitId, spellId: c.spellId, name: c.name, start: c.ms, end });
  }
  return out.sort((a, b) => a.start - b.start);
}
