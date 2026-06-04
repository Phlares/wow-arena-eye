import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/store/schema.js';

describe('store schema', () => {
  it('creates the match/combatant/metric tables and dataset_export view', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const objs = db
      .prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table','view')")
      .all()
      .map((r) => `${(r as { type: string }).type}:${(r as { name: string }).name}`);
    expect(objs).toContain('table:match');
    expect(objs).toContain('table:combatant');
    expect(objs).toContain('table:metric');
    expect(objs).toContain('view:dataset_export');
  });

  it('migrate is idempotent (IF NOT EXISTS)', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    migrate(db); // must not throw
    expect((db.prepare('SELECT count(*) AS c FROM match').get() as { c: number }).c).toBe(0);
  });
});
