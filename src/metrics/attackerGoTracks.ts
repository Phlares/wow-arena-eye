import type { AuraState } from './auraState.js';
import { isOffensiveCd } from '../metadata/cooldowns.js';
import { HEALER_SPEC_IDS } from './registry.js';
import { matchStartMs, matchEndMs } from './eventAccess.js';
import { round1 } from './spacing.js';
import type { UnitMetrics, AttackerGoTrack } from './types.js';

/** Per-attacker offensive (GO) intervals: each non-healer player's offensive-cooldown-active aura
 *  windows, tSec-relative and clamped to the match end (mirrors computeOffensiveWindows). */
export function computeAttackerGoTracks(match: unknown, units: UnitMetrics[], auras: AuraState): AttackerGoTrack[] {
  const m = match as { events?: unknown[]; durationInSeconds?: unknown };
  const events = Array.isArray(m.events) ? m.events : [];
  const matchStart = matchStartMs(events) ?? 0;
  const dur = typeof m.durationInSeconds === 'number' ? matchStart + m.durationInSeconds * 1000 : matchStart;
  const matchEnd = Math.max(matchEndMs(events) ?? matchStart, dur);
  const clampEnd = matchEnd > matchStart ? matchEnd : Number.MAX_SAFE_INTEGER;
  const attackers = units.filter((u) => u.kind === 'player' && (u.spec === undefined || !HEALER_SPEC_IDS.includes(String(u.spec))));
  return attackers.map((p) => ({
    unitId: p.unitId, name: p.name, team: p.team, spec: p.spec,
    intervals: auras.intervalsBy(p.unitId)
      .filter((iv) => isOffensiveCd(iv.spellId))
      .map((iv) => ({ startSec: round1((Math.max(iv.start, matchStart) - matchStart) / 1000), endSec: round1((Math.min(iv.end, clampEnd) - matchStart) / 1000) }))
      .filter((w) => w.endSec > w.startSec)
      .sort((a, b) => a.startSec - b.startSec),
  }));
}
