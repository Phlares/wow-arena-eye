import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { immuneEvent } from '../src/metrics/eventAccess.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

describe('immuneEvent (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('resolves an immune-blocked event with src/dest/kind/spell', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const events: unknown[] = (arenaMatches[0] as { events: unknown[] }).events;
    const hit = events.find((e) => immuneEvent(e) !== undefined);
    expect(hit, 'an immune/grounded event exists in the fixture').toBeTruthy();
    const info = immuneEvent(hit)!;
    expect(typeof info.srcId).toBe('string');
    expect(typeof info.destId).toBe('string');
    expect(['spell', 'damage', 'heal']).toContain(info.kind);
    expect(typeof info.spellId).toBe('number');
  });

  it('returns undefined for a normal damage event', () => {
    expect(immuneEvent({ logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'A', destUnitId: 'B' })).toBeUndefined();
  });
});
