import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

const TMP = 'test-data/tmp-config-seasons.json';
function withConfig(obj: unknown): ReturnType<typeof loadConfig> {
  writeFileSync(TMP, JSON.stringify(obj));
  try { return loadConfig(TMP); } finally { rmSync(TMP, { force: true }); }
}
const base = { sampleLogsDir: 'x', outputDir: 'o', player: { name: 'Phlares', realm: 'Stormrage' } };

describe('loadConfig seasons', () => {
  it('defaults seasons to an empty array when absent', () => {
    expect(withConfig(base).seasons).toEqual([]);
  });
  it('reads a seasons array', () => {
    const cfg = withConfig({ ...base, seasons: [{ name: 'S1', startMs: 1000 }, { name: 'S2', startMs: 2000 }] });
    expect(cfg.seasons).toEqual([{ name: 'S1', startMs: 1000 }, { name: 'S2', startMs: 2000 }]);
  });
  it('throws when seasons is not an array', () => {
    expect(() => withConfig({ ...base, seasons: 'bad' })).toThrow(/seasons.*array/);
  });
  it('throws when seasons[].startMs is not a finite number', () => {
    expect(() => withConfig({ ...base, seasons: [{ name: 'S1', startMs: 'oops' }] })).toThrow(/startMs/);
  });
});

describe('loadConfig ingestSeasonsBack', () => {
  it('defaults to 1 (current season only — safe re-ingest)', () => {
    expect(withConfig(base).ingestSeasonsBack).toBe(1);
  });
  it('reads a positive integer', () => {
    expect(withConfig({ ...base, ingestSeasonsBack: 3 }).ingestSeasonsBack).toBe(3);
  });
  it('rejects zero/negative/non-integer values', () => {
    expect(() => withConfig({ ...base, ingestSeasonsBack: 0 })).toThrow(/ingestSeasonsBack/);
    expect(() => withConfig({ ...base, ingestSeasonsBack: 1.5 })).toThrow(/ingestSeasonsBack/);
    expect(() => withConfig({ ...base, ingestSeasonsBack: 'all' })).toThrow(/ingestSeasonsBack/);
  });
});
