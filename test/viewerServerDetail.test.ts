import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { handleApi } from '../src/viewer/server.js';

function db() {
  const d = new DatabaseSync(':memory:'); migrate(d);
  d.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,result,player_unit_id,player_name) VALUES (?,?,?,?,?,?,?)`).run('M1', 1, '3v3', '1825', 'win', 'P', 'Me');
  d.prepare('INSERT INTO match_detail (match_id,metrics_json) VALUES (?,?)')
    .run('M1', JSON.stringify({ playerUnitId: 'P', teams: [], timeline: [], offensiveWindows: [], losDisruptors: [], coordination: [], distanceBands: [], positionTracks: [], lineOfSight: {}, focusTracks: {} }));
  return d;
}

describe('GET /api/matches/:id/detail', () => {
  it('returns { metrics, rangeSeries } for a persisted match', () => {
    const r = handleApi(db(), 'GET', '/api/matches/M1/detail', new URLSearchParams(), 60000);
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.metrics.timeline).toEqual([]);
    expect(Array.isArray(body.rangeSeries)).toBe(true);
    expect(Array.isArray(body.roster)).toBe(true);
    expect(Array.isArray(body.goTracks)).toBe(true);
  });
  it('404s when the match has no detail row', () => {
    const r = handleApi(db(), 'GET', '/api/matches/NOPE/detail', new URLSearchParams(), 60000);
    expect(r.status).toBe(404);
  });
});
