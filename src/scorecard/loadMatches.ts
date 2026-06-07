import type { DatabaseSync } from '../store/sqlite.js';
import type { PlayerMatch } from './types.js';

interface Row {
  match_id: string; start_ms: number | null; bracket: string | null; zone_id: string | null;
  duration_sec: number | null; ally_comp_sig: string | null; enemy_comp_sig: string | null;
  player_rating: number | null; result: string | null; player_name: string | null; metric_id: string; value: number;
}

/** Load the recording character's matches with per-player metrics pivoted into a map.
 *  Joins match ⨝ combatant(is_player=1) ⨝ metric(scope=that unit). One row per metric;
 *  pivoted here. Optionally restrict to one character (player_name). */
export function loadPlayerMatches(db: DatabaseSync, character?: string): PlayerMatch[] {
  const sql =
    `SELECT m.match_id, m.start_ms, m.bracket, m.zone_id, m.duration_sec, m.ally_comp_sig, m.enemy_comp_sig,
            m.player_rating, m.result, m.player_name, x.metric_id, x.value
     FROM match m
     JOIN combatant c ON c.match_id = m.match_id AND c.is_player = 1
     JOIN metric x ON x.match_id = m.match_id AND x.scope = c.unit_id
     ${character ? 'WHERE m.player_name = ?' : ''}
     ORDER BY m.start_ms`;
  const stmt = db.prepare(sql);
  const rows = (character ? stmt.all(character) : stmt.all()) as unknown as Row[];
  const byMatch = new Map<string, PlayerMatch>();
  for (const r of rows) {
    let pm = byMatch.get(r.match_id);
    if (!pm) {
      pm = {
        matchId: r.match_id, startMs: r.start_ms, bracket: r.bracket ?? '', zoneId: r.zone_id ?? '',
        allyComp: r.ally_comp_sig ?? '', enemyComp: r.enemy_comp_sig ?? '', rating: r.player_rating,
        durationSec: r.duration_sec, result: r.result ?? 'unknown', character: r.player_name ?? '', metrics: {},
      };
      byMatch.set(r.match_id, pm);
    }
    pm.metrics[r.metric_id] = r.value;
  }
  return [...byMatch.values()];
}
