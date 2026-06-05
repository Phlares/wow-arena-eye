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

  it('suppresses vs-avg for insufficient, renders null value as em dash, omits ★ when value is null, and shows the season line', () => {
    const sc2: Scorecard = {
      matchId: 'T', character: 'Alt-Realm-US', bracket: '2v2', zoneId: '572',
      enemyComp: 'rmp', rating: null, result: 'win', startMs: 0, season: 'S4',
      cohort: { description: '2v2', n: 2, wins: 1, losses: 1 },
      metrics: [
        { id: 'healingDone', label: 'Healing done', polarity: 'higher-better', value: null, mean: 0, stdev: 0, n: 2, z: null, verdict: 'insufficient', seasonBest: null, isNewBest: true, winLikeness: 'neutral' },
      ],
    };
    const out = renderScorecardText(sc2);
    expect(out).toContain('—');                  // null value renders as em dash
    expect(out).toContain('· n/a');              // insufficient glyph
    expect(out).not.toContain('avg');            // vs-avg cell suppressed for insufficient (only place 'avg' would appear)
    expect(out).not.toContain('season best');    // ★ marker suppressed because value is null, despite isNewBest=true
    expect(out).toContain('season S4');          // optional season header line present
  });
});
