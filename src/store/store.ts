import { DatabaseSync } from './sqlite.js';
import type { MatchMetrics } from '../metrics/types.js';
import { migrate } from './schema.js';
import { extractMetricRows, compSignatures } from './metricRows.js';

export interface UpsertOpts {
  playerUnitId?: string;
  sourceFile?: string;
  buildVersion?: string;
  videoPath?: string;
  sidecarPath?: string;
  /** sidecar MMR fallback when the log lacks endInfo MMR. */
  enemyMmrFallback?: number;
  nowMs?: number;
}

type SqlVal = string | number | null;
const s = (v: unknown): SqlVal => (v === undefined || v === null ? null : String(v));
const n = (v: unknown): SqlVal => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const i = (v: unknown): SqlVal => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/** "Phlares-Stormrage-US" -> ["Phlares", "Stormrage-US"]; no dash -> [name, null]. */
function splitNameRealm(full: string): [string, string | null] {
  const dash = full.indexOf('-');
  return dash === -1 ? [full, null] : [full.slice(0, dash), full.slice(dash + 1)];
}

/** Open (or create) the DB at `path` and ensure the schema exists. */
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  migrate(db);
  return db;
}

/** Write one match idempotently (delete-then-insert keyed on match_id, in a transaction). */
export function upsertMatch(db: DatabaseSync, rawMatch: unknown, metrics: MatchMetrics, opts: UpsertOpts): void {
  const m = rawMatch as {
    id?: unknown; startInfo?: Record<string, unknown>; endInfo?: Record<string, unknown>;
    durationInSeconds?: unknown; winningTeamId?: unknown; playerId?: unknown; playerTeamId?: unknown;
    units?: Record<string, { info?: { teamId?: unknown } }>; linesNotParsedCount?: unknown;
  };
  const matchId = String(m.id);
  const si = m.startInfo ?? {};
  const ei = m.endInfo ?? {};
  const pid = opts.playerUnitId;

  const { combatants, metrics: rows } = extractMetricRows(metrics, pid);
  const { ally, enemy } = compSignatures(combatants);
  const playerCombatant = combatants.find((c) => c.isPlayer);

  const rawTeam = pid && m.units?.[pid]?.info?.teamId != null
    ? String(m.units[pid]!.info!.teamId)
    : (pid && m.playerId === pid && m.playerTeamId != null ? String(m.playerTeamId) : null);
  const winning = m.winningTeamId != null ? String(m.winningTeamId) : null;
  const result = rawTeam != null && winning != null ? (rawTeam === winning ? 'win' : 'loss') : 'unknown';

  const mmrFor = (team: string | null) => (team === '0' ? ei.team0MMR : team === '1' ? ei.team1MMR : undefined);
  const playerRating = mmrFor(rawTeam);
  const enemyMmr = mmrFor(rawTeam === '0' ? '1' : rawTeam === '1' ? '0' : null) ?? opts.enemyMmrFallback;
  const startMs = typeof si.timestamp === 'number' ? si.timestamp : null;
  const now = opts.nowMs ?? Date.now();

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM metric WHERE match_id=?').run(matchId);
    db.prepare('DELETE FROM combatant WHERE match_id=?').run(matchId);
    db.prepare('DELETE FROM match WHERE match_id=?').run(matchId);

    db.prepare(
      `INSERT INTO match (match_id,start_ms,start_iso,bracket,zone_id,duration_sec,result,
        player_unit_id,player_name,player_spec,player_team_id,winning_team_id,
        ally_comp_sig,enemy_comp_sig,player_rating,enemy_mmr,is_ranked,build_version,
        video_path,sidecar_path,source_file,ingested_ms,lines_unparsed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      matchId, n(startMs), startMs != null ? new Date(startMs).toISOString() : null,
      s(si.bracket), s(si.zoneId), n(m.durationInSeconds), result,
      s(pid), s(playerCombatant?.name), s(playerCombatant?.spec), rawTeam, winning,
      ally, enemy, i(playerRating), i(enemyMmr), si.isRanked ? 1 : 0, s(opts.buildVersion),
      s(opts.videoPath), s(opts.sidecarPath), s(opts.sourceFile), now, n(m.linesNotParsedCount),
    );

    const ci = db.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)');
    for (const c of combatants) {
      const [name, realm] = splitNameRealm(c.name);
      ci.run(matchId, c.unitId, name, realm, null, c.spec, c.team, c.isPlayer ? 1 : 0);
    }
    const mi = db.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)');
    for (const r of rows) mi.run(matchId, r.scope, r.metricId, r.value);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
