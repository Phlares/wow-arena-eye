import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { handleApi } from '../src/viewer/server.js';

function seedMatch(db: InstanceType<typeof DatabaseSync>, id: string, t: number, dmg: number) {
  db.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,duration_sec,result,player_unit_id,player_name) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, t, '3v3', '1', 120, 'win', 'P', 'Me');
  db.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)').run(id, 'P', 'P', 'R', null, '265', 'friendly', 1);
  db.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)').run(id, 'P', 'damageDone', dmg);
}

function db() {
  const d = new DatabaseSync(':memory:'); migrate(d);
  seedMatch(d, 'M1', 5000, 100); // target
  seedMatch(d, 'M0', 1000, 200); // a prior game
  return d;
}

describe('GET /api/matches/:id/scorecard', () => {
  it('returns a Scorecard for a stored match', () => {
    const r = handleApi(db(), 'GET', '/api/matches/M1/scorecard', new URLSearchParams('mode=overall'), 1_800_000);
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(Array.isArray(body.metrics)).toBe(true);
    expect(body.metrics.some((m: { id: string }) => m.id === 'damageDone')).toBe(true);
    expect(body.cohort).toBeDefined();
  });
  it('404s when the match is not in the store', () => {
    const r = handleApi(db(), 'GET', '/api/matches/NOPE/scorecard', new URLSearchParams(), 1_800_000);
    expect(r.status).toBe(404);
  });
});
