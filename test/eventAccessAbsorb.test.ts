import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { eventType, absorbInfo, srcId } from '../src/metrics/eventAccess.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

describe('absorbInfo (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('returns the shield owner and amount, distinct from the attacker', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const match = arenaMatches[0] as { events: unknown[]; units: Record<string, unknown> };
    const abs = match.events.find((e) => eventType(e) === 'SPELL_ABSORBED' && absorbInfo(e) !== undefined);
    expect(abs, 'an absorbed event with resolvable shield owner exists').toBeTruthy();
    const info = absorbInfo(abs)!;
    expect(typeof info.shieldOwnerId).toBe('string');
    expect(info.shieldOwnerId.length).toBeGreaterThan(0);
    expect(info.amount).toBeGreaterThan(0);
    // The shield owner is the absorbing caster, NOT the attacking source.
    expect(info.shieldOwnerId).not.toBe(srcId(abs));
    // And it is a real unit in the match.
    expect(match.units[info.shieldOwnerId]).toBeTruthy();
  });

  it('returns undefined for non-absorb events', () => {
    expect(absorbInfo({ logLine: { event: 'SPELL_DAMAGE' } })).toBeUndefined();
  });
});
