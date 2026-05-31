import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { eventType, spellId, amount, hpPct } from '../src/metrics/eventAccess.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

describe('amount / spellId / hpPct (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('reads damage amount + spellId + hp off real events', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const events: unknown[] = (arenaMatches[0] as { events: unknown[] }).events;
    const dmg = events.find((e) => eventType(e) === 'SPELL_DAMAGE');
    expect(dmg, 'a SPELL_DAMAGE event exists').toBeTruthy();
    expect(typeof amount(dmg)).toBe('number');
    expect(amount(dmg)).toBeGreaterThan(0);
    expect(typeof spellId(dmg)).toBe('number');
    expect(spellId(dmg)).toBeGreaterThan(0);
    const adv = events.find((e) => hpPct(e) !== undefined);
    expect(adv, 'some event carries HP').toBeTruthy();
    const p = hpPct(adv)!;
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});
