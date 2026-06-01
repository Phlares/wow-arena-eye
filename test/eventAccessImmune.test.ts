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
    expect(info.kind).toBe('spell');
    expect(typeof info.spellId).toBe('number');
    expect(info.srcId).toContain('-');
    expect(info.spellId).toBeGreaterThan(0);
  });

  it('returns undefined for a normal damage event', () => {
    expect(immuneEvent({ logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'A', destUnitId: 'B' })).toBeUndefined();
  });
});

describe('immuneEvent (synthetic)', () => {
  it('returns undefined for SWING_MISSED (no spell — auto-attack immune is not a CC ability)', () => {
    expect(immuneEvent({ logLine: { event: 'SWING_MISSED', parameters: ['A','x','0x0','0x0','B','y','0x0','0x0','IMMUNE'] }, srcUnitId: 'A', destUnitId: 'B' })).toBeUndefined();
  });

  it('handles RANGE_MISSED with missType at param index 11', () => {
    const ev = {
      logLine: {
        event: 'RANGE_MISSED',
        parameters: ['srcGuid', 'srcName', '0x0', '0x0', 'destGuid', 'destName', '0x0', '0x0', '75', 'Auto Shot', '1', 'IMMUNE'],
      },
      srcUnitId: 'Player-3-C',
      destUnitId: 'Player-4-D',
      spellId: '75',
    };
    const info = immuneEvent(ev)!;
    expect(info).toBeTruthy();
    expect(info.kind).toBe('spell');
    expect(info.srcId).toBe('Player-3-C');
  });
});
