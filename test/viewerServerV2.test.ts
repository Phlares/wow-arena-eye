import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { handleApi } from '../src/viewer/server.js';

function db() {
  const d = new DatabaseSync(':memory:'); migrate(d);
  const ins = (id: string, t: number, cr: number, mmr: number, espec: string) => {
    d.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,duration_sec,ally_comp_sig,enemy_comp_sig,player_rating,player_cr,build_version,result,player_unit_id,player_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, t, '3v3', '1825', 100, 'a', 'e', mmr, cr, '12.0.5', 'win', 'P', 'Me-R');
    d.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)').run(id, 'P', 'Me', 'R', null, '265', 'friendly', 1);
    d.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)').run(id, 'E', 'Foe', 'R', null, espec, 'enemy', 0);
    d.prepare(`INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)`).run(id, 'P', 'damageDone', 1000);
  };
  ins('M1', 1000, 1800, 2000, '250'); // enemy DK
  ins('M2', 5000, 1816, 2014, '62');  // enemy Mage
  return d;
}

describe('handleApi v2', () => {
  it('GET /api/matches enriches CR/MMR deltas chronologically', () => {
    const res = handleApi(db(), 'GET', '/api/matches', new URLSearchParams('character=Me-R'), 30 * 60_000);
    const m2 = JSON.parse(res.body).matches.find((m: { matchId: string }) => m.matchId === 'M2');
    expect(m2.crDelta).toBe(16);
    expect(m2.ratingDelta).toBe(14); // MMR delta
  });
  it('GET /api/matches applies enemyClasses', () => {
    const res = handleApi(db(), 'GET', '/api/matches', new URLSearchParams('enemyClasses=Death Knight'), 30 * 60_000);
    expect(JSON.parse(res.body).matches.map((m: { matchId: string }) => m.matchId)).toEqual(['M1']);
  });
  it('GET /api/filters returns a classSpecTree', () => {
    const res = handleApi(db(), 'GET', '/api/filters', new URLSearchParams(''), 30 * 60_000);
    expect(JSON.parse(res.body).classSpecTree.some((t: { className: string }) => t.className === 'Warlock')).toBe(true);
  });
});
