import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { projectMatch } from '../src/view/projectMatch.js';

describe('projectMatch (real fixture)', () => {
  const FIXTURE = 'test-data/fixtures/arena-sample.log';
  it.runIf(existsSync(FIXTURE))('projects a parsed arena match into a view model', async () => {
    const res = await parseLogFile(FIXTURE);
    const view = projectMatch(res.arenaMatches[0], 'arena');
    expect(view.kind).toBe('arena');
    expect(view.bracket).toBe('3v3');
    expect(view.durationSec).toBeGreaterThan(0);
    expect(view.combatants.length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(view.eventCounts).length).toBeGreaterThan(0);
    const totalEvents = Object.values(view.eventCounts).reduce((a, b) => a + b, 0);
    expect(totalEvents).toBeGreaterThan(0);
  });
});
