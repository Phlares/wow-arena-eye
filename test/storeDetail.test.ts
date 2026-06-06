import { describe, it, expect } from 'vitest';
import { migrate } from '../src/store/schema.js';
import { DatabaseSync } from '../src/store/sqlite.js';

describe('match_detail', () => {
  it('migrate creates a match_detail table with match_id + metrics_json', () => {
    const db = new DatabaseSync(':memory:'); migrate(db);
    const cols = (db.prepare('PRAGMA table_info(match_detail)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['match_id', 'metrics_json']));
  });
});
