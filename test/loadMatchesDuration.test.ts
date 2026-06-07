import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { loadPlayerMatches } from '../src/scorecard/loadMatches.js';

describe('loadPlayerMatches duration', () => {
  it('exposes durationSec from the match row', () => {
    const db = new DatabaseSync(':memory:'); migrate(db);
    db.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,duration_sec,result,player_unit_id,player_name) VALUES (?,?,?,?,?,?,?,?)`)
      .run('M1', 1000, '3v3', '1', 161, 'win', 'P', 'Me');
    db.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)').run('M1', 'P', 'P', 'R', null, '265', 'friendly', 1);
    db.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)').run('M1', 'P', 'damageDone', 100);
    const [pm] = loadPlayerMatches(db, 'Me');
    expect(pm.durationSec).toBe(161);
  });
});
