import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';

function cols(db: InstanceType<typeof DatabaseSync>): string[] {
  return (db.prepare('PRAGMA table_info(match)').all() as { name: string }[]).map((c) => c.name);
}

describe('migrate player_cr', () => {
  it('creates player_cr on a fresh DB', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    expect(cols(db)).toContain('player_cr');
  });
  it('adds player_cr to an existing DB that lacks it (idempotent)', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE match (
      match_id TEXT PRIMARY KEY, start_ms INTEGER, start_iso TEXT, bracket TEXT,
      zone_id TEXT, duration_sec REAL, result TEXT, player_unit_id TEXT, player_name TEXT,
      player_spec TEXT, player_team_id TEXT, winning_team_id TEXT, ally_comp_sig TEXT,
      enemy_comp_sig TEXT, player_rating INTEGER, enemy_mmr INTEGER, is_ranked INTEGER,
      build_version TEXT, video_path TEXT, sidecar_path TEXT, source_file TEXT,
      ingested_ms INTEGER, lines_unparsed INTEGER
    )`); // old shape: full match table, but no player_cr
    migrate(db);
    expect(cols(db)).toContain('player_cr');
    migrate(db); // run again — must not throw
    expect(cols(db).filter((c) => c === 'player_cr')).toHaveLength(1);
  });
});
