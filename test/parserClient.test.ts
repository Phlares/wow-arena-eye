import { describe, it, expect } from 'vitest';
import { WoWCombatLogParser } from '@wowarenalogs/parser';

describe('@wowarenalogs/parser import', () => {
  it('constructs a parser and accepts the version header line without throwing', () => {
    const parser = new WoWCombatLogParser(null);
    expect(parser).toBeTruthy();
    expect(() =>
      parser.parseLine(
        '5/28/2026 20:08:25.416-4  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.0.5,PROJECT_ID,1',
      ),
    ).not.toThrow();
  });
});
