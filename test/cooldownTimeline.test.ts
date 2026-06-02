import { describe, it, expect } from 'vitest';
import { chargesAt, isAvailable, readyIntervals } from '../src/metrics/cooldownTimeline.js';

describe('availability engine', () => {
  it('single-charge CD is unavailable during [cast, cast+cd) and available after', () => {
    const casts = [10_000];
    expect(isAvailable(casts, 30_000, 1, 5_000)).toBe(true);   // before cast
    expect(isAvailable(casts, 30_000, 1, 10_000)).toBe(false); // at cast (charge consumed)
    expect(isAvailable(casts, 30_000, 1, 39_000)).toBe(false); // still on CD
    expect(isAvailable(casts, 30_000, 1, 41_000)).toBe(true);  // recharged
  });

  it('two-charge CD allows a second press immediately, blocks the third', () => {
    const casts = [10_000, 11_000];
    expect(chargesAt(casts, 90_000, 2, 11_500)).toBe(0);        // both charges spent
    expect(chargesAt(casts, 90_000, 2, 9_000)).toBe(2);         // before any cast
    expect(isAvailable(casts, 90_000, 2, 10_500)).toBe(true);   // one charge left after first cast
  });

  it('readyIntervals reports the ready (held) spans for a single-charge CD', () => {
    const intervals = readyIntervals([10_000], 30_000, 1, 0, 60_000);
    expect(intervals).toEqual([{ start: 0, end: 10_000 }, { start: 40_000, end: 60_000 }]);
  });

  it('readyIntervals: never-cast CD is ready the whole match', () => {
    expect(readyIntervals([], 30_000, 1, 0, 60_000)).toEqual([{ start: 0, end: 60_000 }]);
  });

  it('readyIntervals: two-charge spell — ready until both spent, then back after a recharge', () => {
    // first recharge lands at 100_000 (10_000 + 90_000); both charges spent by 11_000
    expect(readyIntervals([10_000, 11_000], 90_000, 2, 0, 120_000))
      .toEqual([{ start: 0, end: 11_000 }, { start: 100_000, end: 120_000 }]);
  });

  it('cooldownMs === 0: charge returns immediately (no real cooldown)', () => {
    // a 0ms cooldown recharges instantly, so the spell is always available
    expect(isAvailable([10_000], 0, 1, 10_000)).toBe(true);
    expect(chargesAt([10_000, 20_000], 0, 1, 25_000)).toBe(1);
  });

  it('chargesAt: duplicate cast timestamps do not drive charges negative', () => {
    // two SPELL_CAST_SUCCESS at the same ms (dirty log) — second is a no-op, not -1
    expect(chargesAt([10_000, 10_000], 30_000, 1, 10_000)).toBe(0);
  });
});
