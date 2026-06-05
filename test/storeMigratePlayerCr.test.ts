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
    db.exec('CREATE TABLE match (match_id TEXT PRIMARY KEY, player_rating INTEGER)'); // old shape
    migrate(db);
    expect(cols(db)).toContain('player_cr');
    migrate(db); // run again — must not throw
    expect(cols(db).filter((c) => c === 'player_cr')).toHaveLength(1);
  });
});
