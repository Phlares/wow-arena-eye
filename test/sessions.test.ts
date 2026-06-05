import { describe, it, expect } from 'vitest';
import { sessionize, type SessionInput } from '../src/store/sessions.js';

const MIN = 60_000;
function mk(over: Partial<SessionInput>): SessionInput {
  return { matchId: 'M', startMs: 0, durationSec: 120, rating: 2000, result: 'win', allyCompLabel: 'WLS', ...over };
}

describe('sessionize', () => {
  it('splits when the idle gap (next start - prev end) exceeds the threshold', () => {
    // prev ends at 0 + 120s = 120000; next starts 30min+1ms later -> new session
    const a = mk({ matchId: 'A', startMs: 0, durationSec: 120 });
    const b = mk({ matchId: 'B', startMs: 120_000 + 30 * MIN + 1 });
    const sessions = sessionize([a, b], 30 * MIN);
    expect(sessions.map((s) => s.count)).toEqual([1, 1]);
  });
  it('keeps matches in one session when the gap is within the threshold', () => {
    const a = mk({ matchId: 'A', startMs: 0, durationSec: 120 });
    const b = mk({ matchId: 'B', startMs: 120_000 + 10 * MIN }); // 10min idle < 30min
    const sessions = sessionize([a, b], 30 * MIN);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].count).toBe(2);
  });
  it('summarizes a session: wins/losses, rating span, comps, time span, id', () => {
    const ms = [
      mk({ matchId: 'A', startMs: 0, durationSec: 100, rating: 2000, result: 'win', allyCompLabel: 'WLS' }),
      mk({ matchId: 'B', startMs: 200_000, durationSec: 100, rating: 2016, result: 'loss', allyCompLabel: 'WLDru' }),
    ];
    const [s] = sessionize(ms, 30 * MIN);
    expect(s).toMatchObject({ id: 'A', startMs: 0, endMs: 300_000, count: 2, wins: 1, losses: 1, ratingStart: 2000, ratingEnd: 2016 });
    expect(s.comps.sort()).toEqual(['WLDru', 'WLS']);
  });
  it('sorts unordered input by start time first', () => {
    const sessions = sessionize([mk({ matchId: 'B', startMs: 5 * MIN }), mk({ matchId: 'A', startMs: 0 })], 30 * MIN);
    expect(sessions[0].id).toBe('A');
  });
  it('treats null duration as zero-length for the gap', () => {
    const a = mk({ matchId: 'A', startMs: 0, durationSec: null });
    const b = mk({ matchId: 'B', startMs: 30 * MIN + 1 }); // gap from start (end=start) just over threshold
    expect(sessionize([a, b], 30 * MIN)).toHaveLength(2);
  });
  it('returns [] for no matches', () => {
    expect(sessionize([], 30 * MIN)).toEqual([]);
  });
});
