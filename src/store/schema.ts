import type { DatabaseSync } from './sqlite.js';

/** All DDL for the match store. `IF NOT EXISTS` everywhere so migrate() is idempotent. */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS match (
  match_id        TEXT PRIMARY KEY,
  start_ms        INTEGER,
  start_iso       TEXT,
  bracket         TEXT,
  zone_id         TEXT,
  duration_sec    REAL,
  result          TEXT,
  player_unit_id  TEXT,
  player_name     TEXT,
  player_spec     TEXT,
  player_team_id  TEXT,
  winning_team_id TEXT,
  ally_comp_sig   TEXT,
  enemy_comp_sig  TEXT,
  player_rating   INTEGER,
  player_cr       INTEGER,
  enemy_mmr       INTEGER,
  is_ranked       INTEGER,
  build_version   TEXT,
  video_path      TEXT,
  sidecar_path    TEXT,
  source_file     TEXT,
  ingested_ms     INTEGER,
  lines_unparsed  INTEGER
);
CREATE TABLE IF NOT EXISTS combatant (
  match_id  TEXT,
  unit_id   TEXT,
  name      TEXT,
  realm     TEXT,
  class     TEXT,
  spec      TEXT,
  team      TEXT,
  is_player INTEGER,
  PRIMARY KEY (match_id, unit_id)
);
CREATE TABLE IF NOT EXISTS metric (
  match_id  TEXT,
  scope     TEXT,
  metric_id TEXT,
  value     REAL,
  PRIMARY KEY (match_id, scope, metric_id)
);
-- Full MatchMetrics JSON per match (lazy-loaded only by the detail endpoint; keeps match lean).
CREATE TABLE IF NOT EXISTS match_detail (
  match_id     TEXT PRIMARY KEY REFERENCES match(match_id),
  metrics_json TEXT NOT NULL
);
-- Incremental-ingest ledger: a log file already parsed at this size is skipped on the next run
-- (combat logs are append-only, so same size = same content; a grown file re-ingests and its
-- matches upsert idempotently).
CREATE TABLE IF NOT EXISTS ingest_file (
  path        TEXT PRIMARY KEY,
  size_bytes  INTEGER NOT NULL,
  ingested_ms INTEGER
);
CREATE INDEX IF NOT EXISTS ix_match_start     ON match(start_ms);
CREATE INDEX IF NOT EXISTS ix_match_enemycomp ON match(enemy_comp_sig);
CREATE INDEX IF NOT EXISTS ix_match_zone      ON match(zone_id);
CREATE INDEX IF NOT EXISTS ix_metric_lookup   ON metric(metric_id, scope);
-- NOTE: the metric_id values in the CASEs below mirror metricRows.ts UNIT_METRICS — keep in sync.
CREATE VIEW IF NOT EXISTS dataset_export AS
SELECT m.match_id, m.start_ms, m.bracket, m.zone_id, m.result,
       m.ally_comp_sig, m.enemy_comp_sig, m.player_rating, m.player_spec,
       MAX(CASE WHEN x.metric_id = 'damageDone'        THEN x.value END) AS damageDone,
       MAX(CASE WHEN x.metric_id = 'dps'               THEN x.value END) AS dps,
       MAX(CASE WHEN x.metric_id = 'healingDone'       THEN x.value END) AS healingDone,
       MAX(CASE WHEN x.metric_id = 'deaths'            THEN x.value END) AS deaths,
       MAX(CASE WHEN x.metric_id = 'deathsWhileCcd'    THEN x.value END) AS deathsWhileCcd,
       MAX(CASE WHEN x.metric_id = 'interruptsLanded'  THEN x.value END) AS interruptsLanded,
       MAX(CASE WHEN x.metric_id = 'interruptsSuffered' THEN x.value END) AS interruptsSuffered,
       MAX(CASE WHEN x.metric_id = 'precognitionUptimeSec' THEN x.value END) AS precognitionUptimeSec,
       MAX(CASE WHEN x.metric_id = 'enemyPrecognitionUptimeSec' THEN x.value END) AS enemyPrecognitionUptimeSec,
       MAX(CASE WHEN x.metric_id = 'avgHealerDistanceYd' THEN x.value END) AS avgHealerDistanceYd,
       MAX(CASE WHEN x.metric_id = 'ccDone.hardCcSec'  THEN x.value END) AS ccDone_hardCcSec,
       MAX(CASE WHEN x.metric_id = 'defensivesIntoBurst' THEN x.value END) AS defensivesIntoBurst
FROM match m
JOIN combatant c ON c.match_id = m.match_id AND c.is_player = 1
JOIN metric x    ON x.match_id = m.match_id AND x.scope = c.unit_id
GROUP BY m.match_id;
`;

/** Create all tables/indices/views if absent. Safe to call repeatedly. Also adds columns
 *  that were introduced after a DB was first created (additive migrations). */
export function migrate(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL); // creates everything on a fresh DB (view included); IF NOT EXISTS = no-op otherwise
  // `CREATE VIEW IF NOT EXISTS` won't refresh an existing-but-stale view, so on an old DB whose
  // dataset_export predates a column, drop+recreate it. Guarded so steady-state opens never drop
  // the view (avoids a needless rebuild and the brief "no such view" window for a concurrent reader).
  const viewCols = (db.prepare('PRAGMA table_info(dataset_export)').all() as { name: string }[]).map((c) => c.name);
  if (viewCols.length > 0 && !viewCols.includes('avgHealerDistanceYd')) {
    db.exec('DROP VIEW dataset_export');
    db.exec(SCHEMA_SQL);
  }
  const matchCols = (db.prepare('PRAGMA table_info(match)').all() as { name: string }[]).map((c) => c.name);
  if (!matchCols.includes('player_cr')) db.exec('ALTER TABLE match ADD COLUMN player_cr INTEGER');
}
