import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';

const tempDirs: string[] = [];
function writeTempConfig(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'wae-cfg-'));
  tempDirs.push(dir);
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(obj), 'utf8');
  return path;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('loadConfig', () => {
  it('loads a valid config and defaults videoDirs to []', () => {
    const path = writeTempConfig({
      sampleLogsDir: '/logs',
      outputDir: './output',
      player: { name: 'Tester', realm: 'TestRealm' },
    });
    const cfg = loadConfig(path);
    expect(cfg.sampleLogsDir).toBe('/logs');
    expect(cfg.outputDir).toBe('./output');
    expect(cfg.player.name).toBe('Tester');
    expect(cfg.videoDirs).toEqual([]);
  });

  it('throws a clear error when a required field is missing', () => {
    const path = writeTempConfig({ outputDir: './output', player: { name: 'X', realm: 'Y' } });
    expect(() => loadConfig(path)).toThrow(/sampleLogsDir/);
  });

  it('throws when player identity is incomplete', () => {
    const path = writeTempConfig({ sampleLogsDir: '/logs', outputDir: './o', player: { name: 'X' } });
    expect(() => loadConfig(path)).toThrow(/player\.realm/);
  });

  it('throws when the config file does not exist', () => {
    expect(() => loadConfig('/definitely/not/a/real/path/config.json')).toThrow(/could not read\/parse/);
  });

  it('throws when videoDirs contains a non-string element', () => {
    const path = writeTempConfig({
      sampleLogsDir: '/logs',
      outputDir: './o',
      videoDirs: ['/ok', 123],
      player: { name: 'X', realm: 'Y' },
    });
    expect(() => loadConfig(path)).toThrow(/videoDirs/);
  });
});
