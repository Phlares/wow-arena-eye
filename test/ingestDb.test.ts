import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { ingestLogsIntoDb } from '../src/cli/ingest-db.js';

describe('ingestLogsIntoDb', () => {
  it('ingests a log file into the DB and reports a summary', async () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const summary = await ingestLogsIntoDb(db, ['test-data/fixtures/arena-sample.log'], [], undefined);
    expect(summary.ingested).toBe(1);
    expect(summary.skipped).toBe(0);
    expect((db.prepare('SELECT count(*) AS c FROM match').get() as { c: number }).c).toBe(1);
    expect((db.prepare("SELECT result FROM match").get() as { result: string }).result).toBe('win');
    expect(summary.noPlayer).toBe(0);
  });
});
