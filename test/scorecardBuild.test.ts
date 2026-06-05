import { describe, it, expect } from 'vitest';
import { buildScorecard, MIN_COHORT } from '../src/scorecard/scorecard.js';
import type { PlayerMatch } from '../src/scorecard/types.js';

function mk(matchId: string, result: string, metrics: Record<string, number>): PlayerMatch {
  return { matchId, startMs: 0, bracket: '3v3', zoneId: '1825', allyComp: 'a', enemyComp: 'e',
    rating: 2000, result, character: 'Me', metrics };
}
// 6 history matches + 1 target (>= MIN_COHORT after excluding target)
function pool(targetMetrics: Record<string, number>): PlayerMatch[] {
  const hist: PlayerMatch[] = [];
  for (let k = 0; k < 6; k++) hist.push(mk('H' + k, k < 3 ? 'win' : 'loss', { deaths: 1, damageDone: 1000, dps: 100 }));
  return [mk('T', 'loss', targetMetrics), ...hist];
}

describe('buildScorecard', () => {
  it('marks a high-deaths match worse (deaths is lower-better)', () => {
    const sc = buildScorecard(pool({ deaths: 5, damageDone: 1000, dps: 100 }), 'T', { scope: {}, seasons: [] });
    const deaths = sc.metrics.find((m) => m.id === 'deaths')!;
    expect(deaths.verdict).toBe('worse');
    expect(deaths.value).toBe(5);
    expect(deaths.n).toBe(6);
  });
  it('marks high damage better (higher-better) and average when near the mean', () => {
    const sc = buildScorecard(pool({ deaths: 1, damageDone: 5000, dps: 100 }), 'T', { scope: {}, seasons: [] });
    expect(sc.metrics.find((m) => m.id === 'damageDone')!.verdict).toBe('better');
    expect(sc.metrics.find((m) => m.id === 'dps')!.verdict).toBe('average'); // equals mean
  });
  it('flags insufficient when the cohort is below MIN_COHORT', () => {
    const small = [mk('T', 'loss', { deaths: 9 }), mk('H0', 'win', { deaths: 1 })]; // cohort n=1
    const sc = buildScorecard(small, 'T', { scope: {}, seasons: [] });
    expect(sc.metrics.find((m) => m.id === 'deaths')!.verdict).toBe('insufficient');
  });
  it('computes win-likeness from the win/loss split means', () => {
    // wins have deaths 0, losses have deaths 4; a target with deaths 0 is win-like
    const hist: PlayerMatch[] = [];
    for (let k = 0; k < 3; k++) hist.push(mk('W' + k, 'win', { deaths: 0 }));
    for (let k = 0; k < 3; k++) hist.push(mk('L' + k, 'loss', { deaths: 4 }));
    const sc = buildScorecard([mk('T', 'loss', { deaths: 0 }), ...hist], 'T', { scope: {}, seasons: [] });
    expect(sc.metrics.find((m) => m.id === 'deaths')!.winLikeness).toBe('win-like');
  });
  it('throws when the target match id is not present', () => {
    expect(() => buildScorecard(pool({ deaths: 1 }), 'NOPE', { scope: {}, seasons: [] })).toThrow();
  });
});

it('exposes MIN_COHORT', () => { expect(MIN_COHORT).toBeGreaterThan(0); });
