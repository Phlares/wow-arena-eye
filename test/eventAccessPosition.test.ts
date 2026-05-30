import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { position, srcId, matchStartMs } from '../src/metrics/eventAccess.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

describe('matchStartMs', () => {
  it('skips leading events with no timestamp', () => {
    const events = [
      { logLine: { event: 'ZONE_CHANGE' } },                 // no timestamp
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, timestamp: 5000 },
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, timestamp: 6000 },
    ];
    expect(matchStartMs(events)).toBe(5000);
  });
  it('returns undefined when no event has a timestamp', () => {
    expect(matchStartMs([{ logLine: { event: 'X' } }])).toBeUndefined();
  });
});

describe('position accessor (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('reads x/y off advanced events', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const events: unknown[] = (arenaMatches[0] as { events: unknown[] }).events;
    const withPos = events.find((e) => srcId(e) && position(e) !== undefined);
    expect(withPos, 'at least one event carries a position').toBeTruthy();
    const p = position(withPos)!;
    expect(typeof p.x).toBe('number');
    expect(typeof p.y).toBe('number');
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});
