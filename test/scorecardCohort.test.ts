import { describe, it, expect } from 'vitest';
import { stats, seasonOf, hourDiff, filterCohort } from '../src/scorecard/cohort.js';
import type { PlayerMatch } from '../src/scorecard/types.js';

function mk(over: Partial<PlayerMatch>): PlayerMatch {
  return { matchId: 'M', startMs: 0, bracket: '3v3', zoneId: '1825', allyComp: 'a', enemyComp: 'e',
    rating: 2000, result: 'win', character: 'Me', metrics: {}, ...over };
}

describe('stats', () => {
  it('computes mean/stdev/n/min/max (population stdev)', () => {
    expect(stats([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({ mean: 5, stdev: 2, n: 8, min: 2, max: 9 });
  });
  it('handles empty and single-value', () => {
    expect(stats([])).toEqual({ mean: 0, stdev: 0, n: 0, min: 0, max: 0 });
    expect(stats([3])).toEqual({ mean: 3, stdev: 0, n: 1, min: 3, max: 3 });
  });
});

describe('hourDiff', () => {
  it('wraps around midnight', () => {
    expect(hourDiff(23, 1)).toBe(2);
    expect(hourDiff(1, 23)).toBe(2);
    expect(hourDiff(10, 13)).toBe(3);
  });
});

describe('seasonOf', () => {
  const seasons = [{ name: 'S1', startMs: 1000 }, { name: 'S2', startMs: 2000 }];
  it('returns the latest season starting at or before startMs', () => {
    expect(seasonOf(seasons, 1500)).toBe('S1');
    expect(seasonOf(seasons, 2000)).toBe('S2');
    expect(seasonOf(seasons, 2500)).toBe('S2');
  });
  it('returns null before the first season and when none configured', () => {
    expect(seasonOf(seasons, 500)).toBeNull();
    expect(seasonOf([], 1500)).toBeNull();
    expect(seasonOf(seasons, null)).toBeNull();
  });
});

describe('filterCohort', () => {
  const target = mk({ matchId: 'T', zoneId: '1825', enemyComp: 'wlS', rating: 2000, startMs: Date.UTC(2026, 0, 1, 20) });
  const pool: PlayerMatch[] = [
    target,
    mk({ matchId: 'A', zoneId: '1825', enemyComp: 'wlS', rating: 2010 }),       // same map+comp
    mk({ matchId: 'B', zoneId: '572', enemyComp: 'wlS', rating: 2400 }),        // diff map, far rating
    mk({ matchId: 'C', zoneId: '1825', enemyComp: 'rmp', rating: 1990 }),       // same map, diff comp
    mk({ matchId: 'D', bracket: '2v2', zoneId: '1825', enemyComp: 'wlS' }),     // wrong bracket
  ];
  it('always enforces bracket and excludes the target', () => {
    const ids = filterCohort(pool, target, {}).map((m) => m.matchId);
    expect(ids).toEqual(['A', 'B', 'C']); // D dropped (2v2), T excluded
  });
  it('same-map narrows to the target zone', () => {
    expect(filterCohort(pool, target, { map: true }).map((m) => m.matchId)).toEqual(['A', 'C']);
  });
  it('same-comp narrows to the target enemy comp', () => {
    expect(filterCohort(pool, target, { comp: true }).map((m) => m.matchId)).toEqual(['A', 'B']);
  });
  it('rating-band keeps only matches within ± band', () => {
    expect(filterCohort(pool, target, { ratingBand: 50 }).map((m) => m.matchId)).toEqual(['A', 'C']);
  });
});
