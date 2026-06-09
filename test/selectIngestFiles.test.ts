import { describe, it, expect } from 'vitest';
import { selectIngestFiles, parseIngestArgs } from '../src/cli/ingest-db.js';

// Fake corpus: two 12.0 files, one 11.2, one 10.1, one with an unreadable header.
const VERSIONS: Record<string, string | null> = {
  a: '12.0.5', b: '12.0.0', c: '11.2.0', d: '10.1.7', e: null,
};
const SIZES: Record<string, number> = { a: 100, b: 200, c: 300, d: 400, e: 500 };
const opts = (over: Partial<Parameters<typeof selectIngestFiles>[1]> = {}) => ({
  seasonsBack: 1,
  versionOf: (f: string) => VERSIONS[f] ?? null,
  sizeOf: (f: string) => SIZES[f] ?? 0,
  ingestedSizes: new Map<string, number>(),
  ...over,
});

describe('selectIngestFiles', () => {
  it('default (1 season back) keeps only the newest season present, plus unknown-version files', () => {
    const sel = selectIngestFiles(['a', 'b', 'c', 'd', 'e'], opts());
    expect(sel.files.sort()).toEqual(['a', 'b', 'e']); // 12.0 files + the headerless one (kept, honest)
    expect(sel.skippedSeason).toBe(2);
    expect(sel.seasons).toEqual(['12.0']);
  });

  it('seasonsBack=2 reaches one season further', () => {
    const sel = selectIngestFiles(['a', 'b', 'c', 'd'], opts({ seasonsBack: 2 }));
    expect(sel.files.sort()).toEqual(['a', 'b', 'c']);
    expect(sel.seasons).toEqual(['12.0', '11.2']);
  });

  it('Infinity (--all-seasons) keeps everything', () => {
    const sel = selectIngestFiles(['a', 'b', 'c', 'd', 'e'], opts({ seasonsBack: Infinity }));
    expect(sel.files.length).toBe(5);
    expect(sel.skippedSeason).toBe(0);
  });

  it('skips files already ingested at the same size; re-includes grown files', () => {
    const ingested = new Map([['a', 100], ['b', 150]]); // a unchanged, b grew 150→200
    const sel = selectIngestFiles(['a', 'b'], opts({ ingestedSizes: ingested }));
    expect(sel.files).toEqual(['b']);
    expect(sel.skippedUnchanged).toBe(1);
  });

  it('force re-includes unchanged files', () => {
    const ingested = new Map([['a', 100]]);
    const sel = selectIngestFiles(['a'], opts({ ingestedSizes: ingested, force: true }));
    expect(sel.files).toEqual(['a']);
    expect(sel.skippedUnchanged).toBe(0);
  });
});

describe('parseIngestArgs', () => {
  it('separates dirs from flags', () => {
    expect(parseIngestArgs(['D:/logs', '--seasons-back=2'])).toEqual({ dirs: ['D:/logs'], seasonsBack: 2, allSeasons: false, force: false });
    expect(parseIngestArgs(['--all-seasons', '--force'])).toEqual({ dirs: [], seasonsBack: undefined, allSeasons: true, force: true });
    expect(parseIngestArgs([])).toEqual({ dirs: [], seasonsBack: undefined, allSeasons: false, force: false });
  });

  it('rejects a malformed seasons-back value', () => {
    expect(() => parseIngestArgs(['--seasons-back=zero'])).toThrow(/seasons-back/);
    expect(() => parseIngestArgs(['--seasons-back=0'])).toThrow(/seasons-back/);
  });
});
