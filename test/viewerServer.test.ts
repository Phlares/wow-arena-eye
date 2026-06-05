import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { handleApi } from '../src/viewer/server.js';

function db() {
  const d = new DatabaseSync(':memory:');
  migrate(d);
  d.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,duration_sec,ally_comp_sig,enemy_comp_sig,player_rating,result,player_unit_id,player_name)
    VALUES ('A',1000,'3v3','2547',120,'105_265','62_64',2000,'win','P','Me-R')`).run();
  d.prepare(`INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES ('A','P','Me','R',NULL,'265','friendly',1)`).run();
  d.prepare(`INSERT INTO metric (match_id,scope,metric_id,value) VALUES ('A','P','damageDone',1000)`).run();
  return d;
}

describe('handleApi', () => {
  it('GET /api/matches returns matches + sessions', () => {
    const res = handleApi(db(), 'GET', '/api/matches', new URLSearchParams(''), 30 * 60_000);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.matches[0].matchId).toBe('A');
    expect(body.matches[0].sessionId).toBe('A');
    expect(body.sessions[0]).toMatchObject({ id: 'A', count: 1, wins: 1 });
  });
  it('GET /api/matches honors filters', () => {
    const res = handleApi(db(), 'GET', '/api/matches', new URLSearchParams('result=loss'), 30 * 60_000);
    expect(JSON.parse(res.body).matches).toHaveLength(0);
  });
  it('GET /api/filters returns option lists', () => {
    const res = handleApi(db(), 'GET', '/api/filters', new URLSearchParams(''), 30 * 60_000);
    expect(JSON.parse(res.body).characters).toEqual(['Me-R']);
  });
  it('GET /api/matches/:id returns one match, 404 when absent', () => {
    expect(handleApi(db(), 'GET', '/api/matches/A', new URLSearchParams(''), 30 * 60_000).status).toBe(200);
    expect(handleApi(db(), 'GET', '/api/matches/NOPE', new URLSearchParams(''), 30 * 60_000).status).toBe(404);
  });
  it('404s an unknown api path', () => {
    expect(handleApi(db(), 'GET', '/api/nope', new URLSearchParams(''), 30 * 60_000).status).toBe(404);
  });
  it('405s a non-GET method', () => {
    expect(handleApi(db(), 'POST', '/api/matches', new URLSearchParams(''), 30 * 60_000).status).toBe(405);
  });
  it('GET /api/matches/:id returns the right match body', () => {
    const res = handleApi(db(), 'GET', '/api/matches/A', new URLSearchParams(''), 30 * 60_000);
    expect(JSON.parse(res.body).matchId).toBe('A');
  });
});
