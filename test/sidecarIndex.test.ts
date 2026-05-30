import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSidecarIndex } from '../src/sidecar/sidecarIndex.js';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'wae-sc-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe('loadSidecarIndex', () => {
  it('parses a sidecar and derives start time from the filename', () => {
    const d = tempDir();
    writeFileSync(
      join(d, '2026-05-29 02-36-18 - YourName - 3v3 Nagrand (Win).json'),
      JSON.stringify({
        category: '3v3',
        zoneName: 'Nagrand',
        duration: 123,
        result: true,
        combatants: [{ _name: 'YourName', _specID: 265, _teamID: 0 }],
      }),
      'utf8',
    );
    const idx = loadSidecarIndex([d]);
    expect(idx.loaded).toBe(1);
    expect(idx.skipped).toBe(0);
    const e = idx.entries[0];
    expect(e.category).toBe('3v3');
    expect(e.zoneName).toBe('Nagrand');
    expect(e.result).toBe(true);
    expect(e.durationSec).toBe(123);
    expect(e.combatants).toEqual([{ name: 'YourName', specId: 265, teamId: 0 }]);
    expect(typeof e.startEpochMs).toBe('number');
  });

  it('skips non-sidecar / unparseable json and counts it', () => {
    const d = tempDir();
    writeFileSync(join(d, 'junk.json'), '{ not valid json', 'utf8');
    writeFileSync(join(d, 'notsidecar.json'), JSON.stringify({ hello: 'world' }), 'utf8');
    const idx = loadSidecarIndex([d]);
    expect(idx.loaded).toBe(0);
    expect(idx.skipped).toBe(2);
  });

  it('returns an empty index when a dir does not exist', () => {
    const idx = loadSidecarIndex(['/no/such/dir']);
    expect(idx.loaded).toBe(0);
    expect(idx.entries).toEqual([]);
  });
});
