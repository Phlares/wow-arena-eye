import type { UnitMetrics, PositionTrack, SpacingSummary, DistanceBandRow } from './types.js';
import { distanceAt, resolvePosition } from './positionTracks.js';

export const STEP_MS = 500;
export const MELEE_YD = 8;
export const HEAL_RANGE_YD = 40;

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Nearest resolved distance from `self` to any of `others` at tSec, or undefined. */
function nearest(self: PositionTrack, others: PositionTrack[], t: number): number | undefined {
  let min: number | undefined;
  for (const o of others) {
    const d = distanceAt(self, o, t);
    if (d !== undefined && (min === undefined || d < min)) min = d;
  }
  return min;
}

function spacingFor(u: UnitMetrics, players: UnitMetrics[], tracks: Map<string, PositionTrack>): SpacingSummary {
  const self = tracks.get(u.unitId);
  if (!self || self.samples.length === 0) return { meleeRangeSec: 0, isolatedSec: 0 };
  const trackOf = (p: UnitMetrics) => tracks.get(p.unitId);
  const keep = (t: PositionTrack | undefined): t is PositionTrack => !!t;
  const enemies = players.filter((p) => p.team !== u.team && p.unitId !== u.unitId).map(trackOf).filter(keep);
  const allies = players.filter((p) => p.team === u.team && p.unitId !== u.unitId).map(trackOf).filter(keep);

  const stepSec = STEP_MS / 1000;
  const startT = self.samples[0].tSec;
  const endT = self.samples[self.samples.length - 1].tSec;
  let meleeRangeSec = 0;
  let isolatedSec = 0;
  for (let t = startT; t <= endT; t += stepSec) {
    if (!resolvePosition(self, t).position) continue;
    const ne = nearest(self, enemies, t);
    if (ne !== undefined && ne <= MELEE_YD) meleeRangeSec += stepSec;
    const na = nearest(self, allies, t);
    if (na !== undefined && na > HEAL_RANGE_YD) isolatedSec += stepSec;
  }
  return { meleeRangeSec: round1(meleeRangeSec), isolatedSec: round1(isolatedSec) };
}

/** Return a copy of `units` with `spacing` filled per player (non-players get a zero summary). */
export function attachSpacing(units: UnitMetrics[], tracks: Map<string, PositionTrack>): UnitMetrics[] {
  const players = units.filter((u) => u.kind === 'player');
  return units.map((u) => ({
    ...u,
    spacing: u.kind === 'player' ? spacingFor(u, players, tracks) : { meleeRangeSec: 0, isolatedSec: 0 },
  }));
}

type Band = 'b0_5' | 'b5_25' | 'b25_40' | 'b40plus';
function bandOf(d: number): Band {
  if (d < 5) return 'b0_5';
  if (d < 25) return 'b5_25';
  if (d < 40) return 'b25_40';
  return 'b40plus';
}
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Per unordered player pair, the fraction of sampled time in each distance band.
 *  Fractions are over `sampledSec` (resolved ticks only) so unresolved time never inflates a band. */
export function computeDistanceBands(units: UnitMetrics[], tracks: Map<string, PositionTrack>): DistanceBandRow[] {
  const players = units.filter((u) => u.kind === 'player' && (tracks.get(u.unitId)?.samples.length ?? 0) > 0);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of players) {
    const s = tracks.get(p.unitId)!.samples;
    lo = Math.min(lo, s[0].tSec);
    hi = Math.max(hi, s[s.length - 1].tSec);
  }
  const rows: DistanceBandRow[] = [];
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return rows;
  const stepSec = STEP_MS / 1000;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = tracks.get(players[i].unitId)!;
      const b = tracks.get(players[j].unitId)!;
      const acc: Record<Band, number> = { b0_5: 0, b5_25: 0, b25_40: 0, b40plus: 0 };
      let sampled = 0;
      for (let t = lo; t <= hi; t += stepSec) {
        const d = distanceAt(a, b, t);
        if (d === undefined) continue;
        acc[bandOf(d)] += stepSec;
        sampled += stepSec;
      }
      const norm = sampled > 0 ? sampled : 1;
      rows.push({
        aId: players[i].unitId, bId: players[j].unitId,
        b0_5: round3(acc.b0_5 / norm), b5_25: round3(acc.b5_25 / norm),
        b25_40: round3(acc.b25_40 / norm), b40plus: round3(acc.b40plus / norm),
        sampledSec: round1(sampled),
      });
    }
  }
  return rows;
}
