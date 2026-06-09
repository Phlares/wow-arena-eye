import type { AuraState } from './auraState.js';
import type { CastEvent } from './cooldownTimeline.js';
import { offensiveActivity } from './offensiveActivity.js';
import { HEALER_SPEC_IDS } from './registry.js';
import { matchStartMs, matchEndMs } from './eventAccess.js';
import { round1 } from './spacing.js';
import type { UnitMetrics, AttackerGoTrack } from './types.js';

/** Per-attacker offensive (GO) intervals: each non-healer player's offensive activity
 *  (aura windows + cast-derived pet-summon windows, via the shared offensiveActivity source),
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
  return attackers.map((p) => ({
    unitId: p.unitId, name: p.name, team: p.team, spec: p.spec,
    intervals: offensiveActivity(p.unitId, auras, casts)
      .map((iv) => ({ startSec: toSec(Math.max(iv.start, matchStart)), endSec: toSec(Math.min(iv.end, clampEnd)), spell: iv.name }))
      .filter((w) => w.endSec > w.startSec),
  }));
}
