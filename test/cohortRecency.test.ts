import { describe, it, expect } from 'vitest';
import { filterCohort } from '../src/scorecard/cohort.js';
import type { PlayerMatch } from '../src/scorecard/types.js';

const pm = (id: string, t: number): PlayerMatch => ({ matchId: id, startMs: t, bracket: '3v3', zoneId: '1',
  allyComp: '', enemyComp: '', rating: 1800, durationSec: 30, result: 'win', character: 'Me', metrics: {} });

const GAP = 1_800_000; // 30 min
// Session 1 {a,b}; gap; Session 2 {c,d,e}; gap; target T (own session); gap; late (after target).
const all = [pm('a', 0), pm('b', 60_000), pm('c', 10_000_000), pm('d', 10_060_000), pm('e', 10_120_000), pm('T', 20_000_000), pm('late', 30_000_000)];
const target = all.find((m) => m.matchId === 'T')!;

describe('filterCohort recency', () => {
  it('overall (no recency) keeps all same-bracket except the target', () => {
    expect(filterCohort(all, target, {}, []).length).toBe(6); // a,b,c,d,e,late
  });
  it('lastNGames takes the N most-recent games strictly before the target', () => {
    expect(filterCohort(all, target, { lastNGames: 2 }, []).map((m) => m.matchId).sort()).toEqual(['d', 'e']);
  });
  it('lastNSessions keeps the matches in the N sessions before the target session', () => {
    expect(filterCohort(all, target, { lastNSessions: 1 }, [], GAP).map((m) => m.matchId).sort()).toEqual(['c', 'd', 'e']);
    expect(filterCohort(all, target, { lastNSessions: 2 }, [], GAP).map((m) => m.matchId).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
