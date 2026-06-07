import type { PlayerMatch, Scope, Season } from './types.js';

export interface Stats { mean: number; stdev: number; n: number; min: number; max: number; }

/** Population mean/stdev/min/max. Empty → all zeros. */
export function stats(values: number[]): Stats {
  const n = values.length;
  if (n === 0) return { mean: 0, stdev: 0, n: 0, min: 0, max: 0 };
  let sum = 0, min = Infinity, max = -Infinity;
  for (const v of values) { sum += v; if (v < min) min = v; if (v > max) max = v; }
  const mean = sum / n;
  let sq = 0;
  for (const v of values) sq += (v - mean) * (v - mean);
  return { mean, stdev: Math.sqrt(sq / n), n, min, max };
}

/** Smallest circular distance between two hours-of-day (0..23). */
export function hourDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

/** Name of the latest season starting at or before startMs; null if before the first/none. */
export function seasonOf(seasons: Season[], startMs: number | null): string | null {
  if (startMs === null) return null;
  let best: Season | null = null;
  for (const s of seasons) {
    if (s.startMs <= startMs && (best === null || s.startMs > best.startMs)) best = s;
  }
  return best ? best.name : null;
}

/** `matchId → session index` over chronological matches, using the same idle-gap split as
 *  `sessionize` (a new session when next.startMs − prev end > gapMs). end = startMs + dur. */
function sessionIndexByStart(rows: { matchId: string; startMs: number; durationSec: number | null }[], gapMs: number): Map<string, number> {
  const sorted = [...rows].sort((a, b) => a.startMs - b.startMs);
  const idx = new Map<string, number>();
  let cur = 0, prevEnd = 0, first = true;
  for (const r of sorted) {
    if (!first && r.startMs - prevEnd > gapMs) cur += 1;
    idx.set(r.matchId, cur);
    prevEnd = r.startMs + (r.durationSec ?? 0) * 1000;
    first = false;
  }
  return idx;
}

/** The recording character's past matches matching the active scope. Always enforces the
 *  target's bracket and excludes the target match itself. Recency modes (lastNGames /
 *  lastNSessions) narrow to games BEFORE the target so a baseline never includes later games. */
export function filterCohort(
  matches: PlayerMatch[],
  target: PlayerMatch,
  scope: Scope,
  seasons: Season[] = [],
  gapMs = 30 * 60_000,
): PlayerMatch[] {
  const targetHour = target.startMs !== null ? new Date(target.startMs).getHours() : null;
  const targetSeason = seasonOf(seasons, target.startMs);
  const base = matches.filter((m) => {
    if (m.matchId === target.matchId) return false;
    if (m.bracket !== target.bracket) return false;
    if (scope.map && m.zoneId !== target.zoneId) return false;
    if (scope.comp && m.enemyComp !== target.enemyComp) return false;
    if (scope.ratingBand !== undefined) {
      if (m.rating === null || target.rating === null) return false;
      if (Math.abs(m.rating - target.rating) > scope.ratingBand) return false;
    }
    if (scope.timeOfDayHours !== undefined) {
      if (m.startMs === null || targetHour === null) return false;
      if (hourDiff(new Date(m.startMs).getHours(), targetHour) > scope.timeOfDayHours) return false;
    }
    if (scope.season && seasonOf(seasons, m.startMs) !== targetSeason) return false;
    return true;
  });

  if (scope.lastNGames !== undefined) {
    if (target.startMs === null) return [];
    return base
      .filter((m) => m.startMs !== null && m.startMs < target.startMs!)
      .sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0))
      .slice(0, scope.lastNGames);
  }
  if (scope.lastNSessions !== undefined) {
    if (target.startMs === null) return [];
    const rows = [...base, target]
      .filter((m) => m.startMs !== null)
      .map((m) => ({ matchId: m.matchId, startMs: m.startMs as number, durationSec: m.durationSec }));
    const idx = sessionIndexByStart(rows, gapMs);
    const targetIdx = idx.get(target.matchId);
    if (targetIdx === undefined) return [];
    const lo = targetIdx - scope.lastNSessions;
    return base.filter((m) => { const i = idx.get(m.matchId); return i !== undefined && i >= lo && i <= targetIdx - 1; });
  }
  return base;
}
