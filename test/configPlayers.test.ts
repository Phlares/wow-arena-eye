import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

const TMP = 'test-data/tmp-config.json';
function withConfig(obj: unknown): ReturnType<typeof loadConfig> {
  writeFileSync(TMP, JSON.stringify(obj));
  try { return loadConfig(TMP); } finally { rmSync(TMP, { force: true }); }
}
const base = { sampleLogsDir: 'x', outputDir: 'o', player: { name: 'Phlares', realm: 'Stormrage' } };

describe('loadConfig players registry', () => {
  it('normalizes a singular player into a one-element registry', () => {
    expect(withConfig(base).players).toEqual([{ name: 'Phlares', realm: 'Stormrage', guid: undefined }]);
  });
  it('accepts a players array and includes the singular player', () => {
    const cfg = withConfig({ ...base, players: [{ name: 'Altlock', realm: 'Stormrage', guid: 'Player-60-X' }] });
    expect(cfg.players.map((p) => p.name)).toContain('Phlares');
    expect(cfg.players.map((p) => p.name)).toContain('Altlock');
  });
});
