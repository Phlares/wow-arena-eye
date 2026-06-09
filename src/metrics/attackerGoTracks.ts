import type { AuraState } from './auraState.js';
import type { CastEvent } from './cooldownTimeline.js';
import { isOffensiveCd, offensiveCdMeta } from '../metadata/cooldowns.js';
import { HEALER_SPEC_IDS } from './registry.js';
import { matchStartMs, matchEndMs } from './eventAccess.js';
import { round1 } from './spacing.js';
import type { UnitMetrics, AttackerGoTrack } from './types.js';

interface GoInterval { startSec: number; endSec: number; spell?: string }

/** Per-attacker offensive (GO) intervals: each non-healer player's offensive-cooldown-active aura
 *  windows, plus cast-derived fixed windows for pet-summon CDs that leave no aura (e.g. Infernal).
 *  tSec-relative and clamped to the match end (mirrors computeOffensiveWindows). */
export function computeAttackerGoTracks(
  match: unknown, units: UnitMetrics[], auras: AuraState, casts: Map<string, CastEvent[]>,
): AttackerGoTrack[] {
  const m = match as { events?: unknown[]; durationInSeconds?: unknown };
  const events = Array.isArray(m.events) ? m.events : [];
  const matchStart = matchStartMs(events) ?? 0;
  const dur = typeof m.durationInSeconds === 'number' ? matchStart + m.durationInSeconds * 1000 : matchStart;
  const matchEnd = Math.max(matchEndMs(events) ?? matchStart, dur);
  const clampEnd = matchEnd > matchStart ? matchEnd : Number.MAX_SAFE_INTEGER;
  const toSec = (ms: number): number => round1((ms - matchStart) / 1000);
  const attackers = units.filter((u) => u.kind === 'player' && (u.spec === undefined || !HEALER_SPEC_IDS.includes(String(u.spec))));
  return attackers.map((p) => {
    const auraIvs = auras.intervalsBy(p.unitId).filter((iv) => isOffensiveCd(iv.spellId));
    const intervals: GoInterval[] = auraIvs
      .map((iv) => ({ startSec: toSec(Math.max(iv.start, matchStart)), endSec: toSec(Math.min(iv.end, clampEnd)), spell: iv.name }))
      .filter((w) => w.endSec > w.startSec);
    // Pet-summons usually leave no aura — derive a fixed window from the summon cast. Some DO
    // (Darkglare): skip the cast window when a same-spell aura interval already overlaps it.
    for (const c of casts.get(p.unitId) ?? []) {
      const meta = offensiveCdMeta(c.spellId);
      if (meta?.kind !== 'pet-summon' || !meta.windowSec) continue;
      const endMs = Math.min(c.ms + meta.windowSec * 1000, clampEnd);
      const covered = auraIvs.some((iv) => iv.spellId === c.spellId && iv.start < endMs && iv.end > c.ms);
      if (covered) continue;
      const w = { startSec: toSec(Math.max(c.ms, matchStart)), endSec: toSec(endMs), spell: c.name };
      if (w.endSec > w.startSec) intervals.push(w);
    }
    return { unitId: p.unitId, name: p.name, team: p.team, spec: p.spec, intervals: intervals.sort((a, b) => a.startSec - b.startSec) };
  });
}
