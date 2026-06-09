import { describe, it, expect } from 'vitest';
import { seasonOf, lastNSeasons } from '../src/util/seasons.js';

describe('seasonOf', () => {
  // A WoW season is the major.minor pair; mid-season patches (.0.5, .0.7) stay in the season.
  it.each([
    ['12.0.0', '12.0'],
    ['12.0.5', '12.0'],
    ['12.0.7', '12.0'],
    ['11.2.0', '11.2'],
    ['12.0.5.58997', '12.0'],
  ])('%s → %s', (build, season) => {
    expect(seasonOf(build)).toBe(season);
  });

  it('returns null for missing/garbage versions', () => {
    expect(seasonOf(null)).toBeNull();
    expect(seasonOf('')).toBeNull();
    expect(seasonOf('retail')).toBeNull();
    expect(seasonOf('12')).toBeNull();
  });
});

describe('lastNSeasons', () => {
  it('keeps the newest n distinct seasons, compared numerically (not lexicographically)', () => {
    const seasons = ['11.2', '12.0', '9.2', '12.0', '11.2', null];
    expect([...lastNSeasons(seasons, 1)]).toEqual(['12.0']);
    expect([...lastNSeasons(seasons, 2)].sort()).toEqual(['11.2', '12.0']);
    expect([...lastNSeasons(['9.2', '11.2'], 1)]).toEqual(['11.2']); // 11 > 9 numerically
  });

  it('Infinity keeps everything; empty input yields empty', () => {
    expect(lastNSeasons(['11.2', '12.0'], Infinity).size).toBe(2);
    expect(lastNSeasons([], 1).size).toBe(0);
  });
});
