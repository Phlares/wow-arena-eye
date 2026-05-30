import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { position, srcId } from '../src/metrics/eventAccess.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

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
