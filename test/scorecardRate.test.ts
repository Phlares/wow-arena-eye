import { describe, it, expect } from 'vitest';
import { buildScorecard, SCORECARD_METRICS } from '../src/scorecard/scorecard.js';
import type { PlayerMatch } from '../src/scorecard/types.js';

const mk = (id: string, dmg: number, dur: number, result = 'win', extra: Record<string, number> = {}): PlayerMatch => ({
  matchId: id, startMs: 1000, bracket: '3v3', zoneId: '1', allyComp: '', enemyComp: '', rating: 1800,
  durationSec: dur, result, character: 'Me', metrics: { damageDone: dmg, ...extra },
});

describe('rate-normalized verdicting', () => {
  it('judges damage on per-minute rate, so a long match does not beat a short one on raw total', () => {
    // every match is exactly 2M/min despite wildly different totals/lengths → verdict 'average'
    const matches = [mk('T', 2_000_000, 60), mk('a', 6_000_000, 180), mk('b', 1_000_000, 30), mk('c', 4_000_000, 120), mk('d', 3_000_000, 90), mk('e', 2_000_000, 60)];
    const score = buildScorecard(matches, 'T', { scope: {}, seasons: [] }).metrics.find((m) => m.id === 'damageDone')!;
    expect(score.verdict).toBe('average');
  });
  it('dropped the standalone dps metric (folded into rate-normalized damage)', () => {
    expect(SCORECARD_METRICS.some((d) => d.id === 'dps')).toBe(false);
  });
  it('descriptive (neutral) metrics still get a win/loss lean', () => {
    const matches = [
      mk('T', 0, 60, 'win', { precognitionUptimeSec: 8 }),
      mk('w1', 0, 60, 'win', { precognitionUptimeSec: 8 }),
      mk('w2', 0, 60, 'win', { precognitionUptimeSec: 9 }),
      mk('l1', 0, 60, 'loss', { precognitionUptimeSec: 2 }),
      mk('l2', 0, 60, 'loss', { precognitionUptimeSec: 1 }),
      mk('w3', 0, 60, 'win', { precognitionUptimeSec: 7 }),
    ];
    const s = buildScorecard(matches, 'T', { scope: {}, seasons: [] }).metrics.find((m) => m.id === 'precognitionUptimeSec')!;
    expect(s.verdict).toBe('descriptive');
    expect(s.winLikeness).toBe('win-like'); // 8 is nearer the win-mean than the loss-mean
  });
});
