import { describe, it, expect } from 'vitest';
import { statSync } from 'node:fs';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { ingestLogsIntoDb } from '../src/cli/ingest-db.js';
import { loadIngestedFileSizes } from '../src/store/store.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

describe('ingestLogsIntoDb', () => {
  it('ingests a log file into the DB and reports a summary', async () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const summary = await ingestLogsIntoDb(db, [FIXTURE], [], undefined);
    expect(summary.ingested).toBe(1);
    expect(summary.skipped).toBe(0);
    expect((db.prepare('SELECT count(*) AS c FROM match').get() as { c: number }).c).toBe(1);
    expect((db.prepare("SELECT result FROM match").get() as { result: string }).result).toBe('win');
    expect(summary.noPlayer).toBe(0);
  });

  it('records each parsed file (path + size) so the next run can skip it unchanged', async () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    await ingestLogsIntoDb(db, [FIXTURE], [], undefined);
    const sizes = loadIngestedFileSizes(db);
    expect(sizes.get(FIXTURE)).toBe(statSync(FIXTURE).size);
  });

  it('does NOT ledger a file when any of its matches failed to store (so it retries next run)', async () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    db.exec('DROP TABLE match'); // force upsertMatch to throw while parseLogFile still succeeds
    const summary = await ingestLogsIntoDb(db, [FIXTURE], [], undefined);
    expect(summary.skipped).toBe(1);
    expect(loadIngestedFileSizes(db).has(FIXTURE)).toBe(false);
  });
});
