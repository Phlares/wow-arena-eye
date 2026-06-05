import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { loadPlayerMatches } from '../src/scorecard/loadMatches.js';

function seed(db: InstanceType<typeof DatabaseSync>) {
  db.prepare('INSERT INTO match (match_id,start_ms,bracket,zone_id,ally_comp_sig,enemy_comp_sig,player_rating,result,player_unit_id,player_name) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('M1', 100, '3v3', '1825', '256_265', 'wlS', 2000, 'win', 'P-1', 'Me-Realm');
  db.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)')
    .run('M1', 'P-1', 'Me', 'Realm', null, '265', 'friendly', 1);
  db.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)')
    .run('M1', 'E-1', 'Foe', 'Realm', null, '270', 'enemy', 0);
  db.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)').run('M1', 'P-1', 'damageDone', 1000);
  db.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)').run('M1', 'P-1', 'deaths', 2);
  db.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)').run('M1', 'E-1', 'damageDone', 9999); // enemy, must be ignored
}

describe('loadPlayerMatches', () => {
  it('pivots the recording player metrics per match and ignores other combatants', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    seed(db);
    const ms = loadPlayerMatches(db);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ matchId: 'M1', bracket: '3v3', zoneId: '1825', enemyComp: 'wlS', rating: 2000, result: 'win', character: 'Me-Realm' });
    expect(ms[0].metrics).toEqual({ damageDone: 1000, deaths: 2 }); // enemy's 9999 excluded
  });
  it('filters by character when given', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    seed(db);
    expect(loadPlayerMatches(db, 'Nobody')).toHaveLength(0);
    expect(loadPlayerMatches(db, 'Me-Realm')).toHaveLength(1);
  });
});
