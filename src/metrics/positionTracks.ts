import type { Sample, PositionTrack, PositionQuery, UnitMetrics } from './types.js';
import { matchStartMs, eventType, destId, eventTimeMs, position } from './eventAccess.js';
import { collectCasts } from './cooldownTimeline.js';
import { isMobility } from '../metadata/repositioning.js';

export const MAX_GAP_SEC = 3;
export const PRE_CAST_VALID_SEC = 0.5;
export const LAST_KNOWN_N = 3;

/** Up to LAST_KNOWN_N real samples with tSec ≤ t, most-recent-first. */
function lastKnownBefore(samples: Sample[], t: number): Sample[] {
  const out: Sample[] = [];
  for (let i = samples.length - 1; i >= 0 && out.length < LAST_KNOWN_N; i--) {
    if (samples[i].tSec <= t) out.push(samples[i]);
  }
  return out;
}

/** Resolve a unit's position at tSec, honest about uncertainty (see PositionQuery). */
export function resolvePosition(track: PositionTrack, tSec: number): PositionQuery {
  const s = track.samples;
  const lastKnown = lastKnownBefore(s, tSec);
  if (s.length === 0) return { position: undefined, inferred: false, lastKnown };

  // Before first / after last: clamp to the endpoint only within MAX_GAP_SEC.
  if (tSec <= s[0].tSec) {
    const ok = s[0].tSec - tSec <= MAX_GAP_SEC;
    return { position: ok ? { ...s[0], tSec } : undefined, inferred: ok ? !!s[0].inferred : false, lastKnown };
  }
  const last = s[s.length - 1];
  if (tSec >= last.tSec) {
    const ok = tSec - last.tSec <= MAX_GAP_SEC;
    return { position: ok ? { ...last, tSec } : undefined, inferred: ok ? !!last.inferred : false, lastKnown };
  }

  // Bracket: greatest sample ≤ tSec at index lo, next sample at lo+1.
  // (Shares the bracket-find + lerp shape with sampleAt.ts; consolidating the two is
  //  deferred to the simplify pass, once Task 4's mobility-break handling settles this path.)
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid].tSec <= tSec) lo = mid;
    else hi = mid - 1;
  }
  const a = s[lo];
  const b = s[lo + 1] ?? a;
  if (a.tSec === b.tSec) return { position: { ...a, tSec }, inferred: !!a.inferred, lastKnown };

  // Mobility break inside the current bracket → never lerp across the teleport.
  // The first break suffices: brackets span adjacent samples, and the transit return is
  // break-agnostic, so only the earliest (most-conservative) uncertainty boundary matters.
  const tb = track.breaks.find((bk) => bk > a.tSec && bk < b.tSec);
  if (tb !== undefined) {
    if (tSec <= tb - PRE_CAST_VALID_SEC) {
      // pre-cast: hold the last observed pre-sample, still subject to the gap guard
      const ok = tSec - a.tSec <= MAX_GAP_SEC;
      return { position: ok ? { x: a.x, y: a.y, tSec, facing: a.facing, hpPct: a.hpPct } : undefined, inferred: ok ? !!a.inferred : false, lastKnown };
    }
    // transit (Tc-0.5 .. landing sample b): genuinely unknown
    return { position: undefined, inferred: false, lastKnown };
  }

  if (b.tSec - a.tSec > MAX_GAP_SEC) return { position: undefined, inferred: false, lastKnown };
  const f = (tSec - a.tSec) / (b.tSec - a.tSec);
  // Lerp x/y; hpPct is step-held (take the lower bracket), NOT smoothed — same deliberate
  // choice as sampleAt.ts (HP should not be interpolated).
  const position: Sample = { tSec, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, facing: a.facing, hpPct: a.hpPct };
  return { position, inferred: !!a.inferred || !!b.inferred, lastKnown };
}

/** Convenience: just the resolved Sample (or undefined). */
export function positionAt(track: PositionTrack, tSec: number): Sample | undefined {
  return resolvePosition(track, tSec).position;
}

/** 2D Euclidean distance in yards between two units at tSec; undefined if either unresolved. */
export function distanceAt(a: PositionTrack, b: PositionTrack, tSec: number): number | undefined {
  const pa = resolvePosition(a, tSec).position;
  const pb = resolvePosition(b, tSec).position;
  if (!pa || !pb) return undefined;
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

/** Build the enriched position-track store: each unit's OBSERVED samples (copied, not mutated)
 *  plus mobility-cast break times (tSec). Inferred samples are added in a later step. */
export function buildPositionTracks(units: UnitMetrics[], match: unknown): Map<string, PositionTrack> {
  const m = match as { events?: unknown[] };
  const events = Array.isArray(m.events) ? m.events : [];
  const startMs = matchStartMs(events) ?? 0;

  const tracks = new Map<string, PositionTrack>();
  for (const u of units) {
    tracks.set(u.unitId, { unitId: u.unitId, samples: u.track.map((s) => ({ ...s })), breaks: [] });
  }

  for (const [uid, list] of collectCasts(match)) {
    const tr = tracks.get(uid);
    if (!tr) continue;
    for (const c of list) if (isMobility(c.spellId)) tr.breaks.push((c.ms - startMs) / 1000);
  }

  // Passive-target gap-filling: a melee swing on a unit constrains it to ≈ the attacker's
  // position. position(ev) is the attacker's (actor) position; attribute it to the target,
  // tagged inferred so it is never confused with an observed sample.
  for (const ev of events) {
    const t = eventType(ev);
    if (t !== 'SWING_DAMAGE' && t !== 'SWING_DAMAGE_LANDED') continue;
    const d = destId(ev);
    const ms = eventTimeMs(ev);
    const p = position(ev);
    if (!d || ms === undefined || !p) continue;
    const tr = tracks.get(d);
    if (!tr) continue;
    tr.samples.push({ tSec: (ms - startMs) / 1000, x: p.x, y: p.y, inferred: true });
  }

  for (const tr of tracks.values()) {
    tr.samples.sort((x, y) => x.tSec - y.tSec);
    tr.breaks.sort((x, y) => x - y);
  }
  return tracks;
}
