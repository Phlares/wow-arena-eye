import { describe, it, expect } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { WoWCombatLogParser } from '@wowarenalogs/parser';
import { extractFirstArenaMatch } from '../src/util/extractMatchFixture.js';
import { parseLogFile, summarizeMatch } from '../src/parser/parserClient.js';

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

describe('extractFirstArenaMatch', () => {
  const SRC = process.env.WAE_SAMPLE_LOG;
  it.runIf(Boolean(SRC) && existsSync(SRC ?? ''))('extracts a single complete arena match', async () => {
    const dest = 'test-data/fixtures/extract-test.log';
    await extractFirstArenaMatch(SRC as string, dest);
    const text = readFileSync(dest, 'utf8');
    expect(text.split('\n')[0]).toContain('COMBAT_LOG_VERSION');
    expect((text.match(/ARENA_MATCH_START/g) ?? []).length).toBe(1);
    expect((text.match(/ARENA_MATCH_END/g) ?? []).length).toBe(1);
    rmSync(dest, { force: true });
  });
});

describe('parseLogFile golden (real 12.0.5 arena fixture)', () => {
  const FIXTURE = 'test-data/fixtures/arena-sample.log';
  it.runIf(existsSync(FIXTURE))('parses one structurally-valid arena match', async () => {
    const res = await parseLogFile(FIXTURE);
    expect(res.arenaMatches.length).toBeGreaterThanOrEqual(1);

    const s = summarizeMatch(res.arenaMatches[0]);
    expect(s.unitCount as number).toBeGreaterThanOrEqual(6); // 3v3 = 6 players (+ pets/totems)
    expect(s.eventCount as number).toBeGreaterThan(0);
    expect(s.durationInSeconds).toBeDefined();
    expect(s.winningTeamId).toBeDefined();
    expect(s.result).toBeDefined();
  });
});
