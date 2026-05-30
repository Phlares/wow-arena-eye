import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { eventType, srcId, destId, spellName, extraSpellName, auraType } from '../src/metrics/eventAccess.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

describe('eventAccess (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('reads core fields off real parsed events', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const events: unknown[] = (arenaMatches[0] as { events: unknown[] }).events;

    const cast = events.find((e) => eventType(e) === 'SPELL_CAST_SUCCESS');
    expect(cast, 'a SPELL_CAST_SUCCESS event exists').toBeTruthy();
    expect(srcId(cast)).toBeTruthy();
    expect(spellName(cast).length).toBeGreaterThan(0);

    const interrupt = events.find((e) => eventType(e) === 'SPELL_INTERRUPT');
    if (interrupt) {
      expect(srcId(interrupt)).toBeTruthy();
      expect(destId(interrupt)).toBeTruthy();
      expect((extraSpellName(interrupt) ?? '').length).toBeGreaterThan(0);
    }

    const dispel = events.find((e) => eventType(e) === 'SPELL_DISPEL');
    if (dispel) {
      expect(['BUFF', 'DEBUFF']).toContain(auraType(dispel));
    }
  });
});
