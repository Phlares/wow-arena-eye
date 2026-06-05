import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

mkdirSync('test-data', { recursive: true });
const TMP = 'test-data/tmp-config-sessiongap.json';
function withConfig(obj: unknown): ReturnType<typeof loadConfig> {
  writeFileSync(TMP, JSON.stringify(obj));
  try { return loadConfig(TMP); } finally { rmSync(TMP, { force: true }); }
}
const base = { sampleLogsDir: 'x', outputDir: 'o', player: { name: 'P', realm: 'R' } };

describe('loadConfig sessionGapMinutes', () => {
  it('defaults to 30 when absent', () => {
    expect(withConfig(base).sessionGapMinutes).toBe(30);
  });
  it('reads a positive number', () => {
    expect(withConfig({ ...base, sessionGapMinutes: 45 }).sessionGapMinutes).toBe(45);
  });
  it('rejects a non-positive or non-finite value', () => {
    expect(() => withConfig({ ...base, sessionGapMinutes: 0 })).toThrow(/sessionGapMinutes/);
    expect(() => withConfig({ ...base, sessionGapMinutes: 'x' })).toThrow(/sessionGapMinutes/);
  });
});
