import type { Sample } from './types.js';

/** Position-at-T: lerp X/Y between bracketing samples; step-hold hpPct (do not smooth HP). */
export function sampleAt(track: Sample[], tSec: number): Sample | undefined {
  if (track.length === 0) return undefined;
  if (tSec <= track[0].tSec) return track[0];
  if (tSec >= track[track.length - 1].tSec) return track[track.length - 1];
  let lo = 0;
  let hi = track.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track[mid].tSec <= tSec) lo = mid;
    else hi = mid - 1;
  }
  const a = track[lo];
  const b = track[lo + 1] ?? a;
  if (a.tSec === b.tSec) return a;
  const f = (tSec - a.tSec) / (b.tSec - a.tSec);
  return { tSec, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, facing: a.facing, hpPct: a.hpPct };
}
