import type { UnitMetrics, PositionTrack, SpacingSummary } from './types.js';
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
