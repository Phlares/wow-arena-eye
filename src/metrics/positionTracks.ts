import type { Sample, PositionTrack, PositionQuery } from './types.js';

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

  // (mobility break handling is inserted here in Task 4)

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
