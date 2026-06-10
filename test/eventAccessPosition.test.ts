import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { position, srcId, matchStartMs, advancedUnitId } from '../src/metrics/eventAccess.js';

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

describe('advancedUnitId', () => {
  it('returns the advanced infoGUID — the unit the advanced position/hp belong to', () => {
    // SPELL_PERIODIC_DAMAGE: WoW's advanced block describes the DEST unit, and the parser
    // surfaces that GUID as advancedActorId. The accessor must NOT fall back to srcUnitId.
    const ev = {
      logLine: { event: 'SPELL_PERIODIC_DAMAGE' },
      srcUnitId: 'Player-60-0FC9DC20', destUnitId: 'Player-76-0BFD93E9',
      advancedActorId: 'Player-76-0BFD93E9',
      advancedActorPositionX: 455.31, advancedActorPositionY: 401.93,
    };
    expect(advancedUnitId(ev)).toBe('Player-76-0BFD93E9');
  });
  it('returns undefined when the advanced block is absent or nil', () => {
    expect(advancedUnitId({ srcUnitId: 'Player-60-0FC9DC20' })).toBeUndefined();
    expect(advancedUnitId({ advancedActorId: '0000000000000000' })).toBeUndefined();
    expect(advancedUnitId({ advancedActorId: '' })).toBeUndefined();
  });
  it.runIf(existsSync(FIXTURE))('every positioned event in the real fixture carries an advanced unit id', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const events: unknown[] = (arenaMatches[0] as { events: unknown[] }).events;
    const positioned = events.filter((e) => position(e) !== undefined);
    expect(positioned.length).toBeGreaterThan(0);
    for (const e of positioned) expect(advancedUnitId(e)).toBeTruthy();
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
