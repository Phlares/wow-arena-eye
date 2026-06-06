import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { loadViewerMatches } from '../src/viewer/queries.js';

function db() {
  const d = new DatabaseSync(':memory:');
  migrate(d);
  d.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,duration_sec,ally_comp_sig,enemy_comp_sig,player_rating,player_cr,build_version,result,player_unit_id,player_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('M1', 1000, '3v3', '1825', 120, 'a', 'e', 2000, 1800, '12.0.5', 'win', 'P', 'Me-R');
  d.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)')
    .run('M1', 'P', 'P', 'R', null, '265', 'friendly', 1);
  const mi = d.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)');
  mi.run('M1', 'P', 'interruptsSuffered', 2);
  mi.run('M1', 'P', 'precognitionUptimeSec', 6.2);
  mi.run('M1', 'P', 'enemyPrecognitionUptimeSec', 12.4);
  return d;
}

describe('viewer pivots kicks-taken + precognition', () => {
  it('exposes interruptsSuffered + both precognition uptimes on the MatchSummary', () => {
    const [s] = loadViewerMatches(db(), {});
    expect(s.interruptsSuffered).toBe(2);
    expect(s.precognitionUptimeSec).toBeCloseTo(6.2, 3);
    expect(s.enemyPrecognitionUptimeSec).toBeCloseTo(12.4, 3);
  });
});
