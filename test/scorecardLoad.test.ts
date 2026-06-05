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

  it('groups metrics per match across multiple matches and applies null-column fallbacks', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const insMatch = db.prepare('INSERT INTO match (match_id,start_ms,bracket,zone_id,ally_comp_sig,enemy_comp_sig,player_rating,result,player_unit_id,player_name) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const insComb = db.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)');
    const insMetric = db.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)');

    // M1: full row, two metrics
    insMatch.run('M1', 100, '3v3', '1825', '256_265', 'wlS', 2000, 'win', 'P-1', 'Me-Realm');
    insComb.run('M1', 'P-1', 'Me', 'Realm', null, '265', 'friendly', 1);
    insMetric.run('M1', 'P-1', 'damageDone', 1000);
    insMetric.run('M1', 'P-1', 'deaths', 2);
    // M2: a distinct second match, one metric
    insMatch.run('M2', 200, '2v2', '1552', 'x', 'rmp', 1800, 'loss', 'P-2', 'Alt-Realm');
    insComb.run('M2', 'P-2', 'Alt', 'Realm', null, '258', 'friendly', 1);
    insMetric.run('M2', 'P-2', 'damageDone', 500);
    // M3: nullable columns all NULL
    insMatch.run('M3', null, null, null, null, null, null, null, 'P-3', null);
    insComb.run('M3', 'P-3', 'Ghost', null, null, null, 'friendly', 1);
    insMetric.run('M3', 'P-3', 'deaths', 0);

    const all = loadPlayerMatches(db);
    expect(all).toHaveLength(3);
    // per-match grouping: each match keeps only its own metrics (no merging)
    expect(all.find((m) => m.matchId === 'M1')!.metrics).toEqual({ damageDone: 1000, deaths: 2 });
    expect(all.find((m) => m.matchId === 'M2')!.metrics).toEqual({ damageDone: 500 });
    // null-column fallbacks
    const m3 = all.find((m) => m.matchId === 'M3')!;
    expect(m3).toMatchObject({ startMs: null, bracket: '', zoneId: '', allyComp: '', enemyComp: '', rating: null, result: 'unknown', character: '' });
    expect(m3.metrics).toEqual({ deaths: 0 });
    // character filter returns the right match, not just the right count
    expect(loadPlayerMatches(db, 'Me-Realm')[0].matchId).toBe('M1');
  });
});
