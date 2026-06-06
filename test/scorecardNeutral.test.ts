import { describe, it, expect } from 'vitest';
import { buildScorecard, SCORECARD_METRICS } from '../src/scorecard/scorecard.js';
import type { PlayerMatch } from '../src/scorecard/types.js';

function pm(id: string, result: string, precog: number): PlayerMatch {
  return { matchId: id, startMs: 1000, bracket: '3v3', zoneId: '1', allyComp: '', enemyComp: '',
    rating: 1800, result, character: 'Me', metrics: { precognitionUptimeSec: precog } };
}

describe('neutral scorecard metric', () => {
  it('precognition is descriptive: no verdict, no season-best, neutral win-likeness', () => {
    const matches = [pm('t', 'win', 6), pm('a', 'win', 2), pm('b', 'loss', 10), pm('c', 'win', 4), pm('d', 'loss', 8), pm('e', 'win', 3)];
    const sc = buildScorecard(matches, 't', { scope: {}, seasons: [] });
    const score = sc.metrics.find((x) => x.id === 'precognitionUptimeSec')!;
    expect(score.verdict).toBe('descriptive');
    expect(score.seasonBest).toBeNull();
    expect(score.isNewBest).toBe(false);
    expect(score.winLikeness).toBe('neutral');
    expect(SCORECARD_METRICS.some((d) => d.id === 'enemyPrecognitionUptimeSec' && d.polarity === 'neutral')).toBe(true);
  });

  it('stays descriptive (not insufficient) even with a sub-minimum cohort', () => {
    const matches = [pm('t', 'win', 6), pm('a', 'loss', 3)]; // n=2 < default minCohort 5
    const score = buildScorecard(matches, 't', { scope: {}, seasons: [] }).metrics.find((x) => x.id === 'precognitionUptimeSec')!;
    expect(score.verdict).toBe('descriptive'); // informational metric still reports its value
    expect(score.value).toBe(6);
  });
});
