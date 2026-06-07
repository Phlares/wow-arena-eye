import { describe, it, expect } from 'vitest';
import { latestMatchId } from '../src/cli/scorecard.js';
import type { PlayerMatch } from '../src/scorecard/types.js';

function mk(matchId: string, startMs: number, character = 'Me'): PlayerMatch {
  return { matchId, startMs, bracket: '3v3', zoneId: '1825', allyComp: 'a', enemyComp: 'e',
    rating: 2000, durationSec: 120, result: 'win', character, metrics: {} };
}

describe('latestMatchId', () => {
  it('returns the most recent match overall', () => {
    expect(latestMatchId([mk('A', 100), mk('C', 300), mk('B', 200)])).toBe('C');
  });
  it('restricts to a character when given', () => {
    const ms = [mk('A', 100, 'Me'), mk('C', 300, 'Alt'), mk('B', 200, 'Me')];
    expect(latestMatchId(ms, 'Me')).toBe('B');
  });
  it('returns undefined for an empty store', () => {
    expect(latestMatchId([])).toBeUndefined();
  });
  it('ignores matches with a null startMs', () => {
    const ms: PlayerMatch[] = [
      { matchId: 'NT', startMs: null, bracket: '3v3', zoneId: '1825', allyComp: 'a', enemyComp: 'e', rating: 2000, durationSec: 120, result: 'win', character: 'Me', metrics: {} },
      mk('A', 100),
    ];
    expect(latestMatchId(ms, 'Me')).toBe('A');
  });
});
