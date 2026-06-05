import { describe, it, expect } from 'vitest';
import { renderScorecardText } from '../src/scorecard/render.js';
import type { Scorecard } from '../src/scorecard/types.js';

const sc: Scorecard = {
  matchId: 'T', character: 'Phlares-Stormrage-US', bracket: '3v3', zoneId: '1825',
  enemyComp: 'wlS', rating: 2000, result: 'loss', startMs: 0, season: null,
  cohort: { description: '3v3, same comp', n: 12, wins: 7, losses: 5 },
  metrics: [
    { id: 'deaths', label: 'Deaths', polarity: 'lower-better', value: 5, mean: 1.2, stdev: 0.9, n: 12, z: 4.2, verdict: 'worse', seasonBest: 0, isNewBest: false, winLikeness: 'loss-like' },
    { id: 'dps', label: 'DPS', polarity: 'higher-better', value: 9000, mean: 7000, stdev: 1000, n: 12, z: 2, verdict: 'better', seasonBest: 9000, isNewBest: true, winLikeness: 'win-like' },
  ],
};

describe('renderScorecardText', () => {
  it('includes header, cohort, metric labels, verdicts, and a new-best marker', () => {
    const out = renderScorecardText(sc);
    expect(out).toContain('Phlares-Stormrage-US');
    expect(out).toContain('3v3, same comp');
    expect(out).toContain('n=12');
    expect(out).toContain('Deaths');
    expect(out).toContain('DPS');
    expect(out).toContain('worse');
    expect(out).toContain('better');
    expect(out).toContain('win-like');
    expect(out.toLowerCase()).toContain('best'); // new-best marker for DPS
  });
});
