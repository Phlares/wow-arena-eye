import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { upsertMatch } from '../src/store/store.js';
import { resolvePlayerUnitId } from '../src/store/resolvePlayer.js';
import { parseLogFile } from '../src/parser/parserClient.js';
import { computeMatchMetrics } from '../src/metrics/metrics.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

async function fixtureMatch() {
  const { arenaMatches } = await parseLogFile(FIXTURE);
  return arenaMatches[0];
}

describe('upsertMatch (real fixture, :memory:)', () => {
  it('writes one match with correct identity, outcome, and player', async () => {
    const m = await fixtureMatch();
    const db = new DatabaseSync(':memory:');
    migrate(db);
    upsertMatch(db, m, computeMatchMetrics(m), { playerUnitId: resolvePlayerUnitId(m, []) });

    const row = db.prepare('SELECT * FROM match').get() as Record<string, unknown>;
    expect(row.bracket).toBe('3v3');
    expect(row.zone_id).toBe('1825');
    expect(row.result).toBe('win');
    expect(row.player_team_id).toBe('1');
    expect(row.player_name).toBe('Phlares-Stormrage-US');
    expect(row.player_spec).toBe('265');
    expect(row.player_rating).toBe(2425);

    const combatants = db.prepare('SELECT * FROM combatant').all();
    expect(combatants).toHaveLength(6);
    expect(db.prepare('SELECT count(*) AS c FROM combatant WHERE is_player=1').get()).toEqual({ c: 1 });

    const playerId = (db.prepare('SELECT unit_id FROM combatant WHERE is_player=1').get() as { unit_id: string }).unit_id;
    const dmg = db.prepare('SELECT value FROM metric WHERE scope=? AND metric_id=?').get(playerId, 'damageDone');
    expect(dmg).toEqual({ value: 2021381 });

    const exported = db.prepare('SELECT damageDone FROM dataset_export').all();
    expect(exported).toEqual([{ damageDone: 2021381 }]);
  });

  it('is idempotent — re-ingesting the same match does not duplicate rows', async () => {
    const m = await fixtureMatch();
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const metrics = computeMatchMetrics(m);
    const opts = { playerUnitId: resolvePlayerUnitId(m, []) };
    upsertMatch(db, m, metrics, opts);
    const before = ['match', 'combatant', 'metric'].map((t) => (db.prepare(`SELECT count(*) AS c FROM ${t}`).get() as { c: number }).c);
    upsertMatch(db, m, metrics, opts);
    const after = ['match', 'combatant', 'metric'].map((t) => (db.prepare(`SELECT count(*) AS c FROM ${t}`).get() as { c: number }).c);
    expect(after).toEqual(before);
    expect((db.prepare('SELECT count(*) AS c FROM match').get() as { c: number }).c).toBe(1);
  });
});
