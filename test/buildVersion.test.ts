import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { readBuildVersion } from '../src/util/buildVersion.js';

mkdirSync('test-data', { recursive: true });

describe('readBuildVersion', () => {
  it('reads BUILD_VERSION from the log header', () => {
    const p = 'test-data/tmp-bv.txt';
    writeFileSync(p, '5/17/2026 20:15:32.251-4  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.0.5,PROJECT_ID,1\nfoo\n');
    try { expect(readBuildVersion(p)).toBe('12.0.5'); } finally { rmSync(p, { force: true }); }
  });
  it('returns null when the header is absent', () => {
    const p = 'test-data/tmp-bv2.txt';
    writeFileSync(p, 'no header here\n');
    try { expect(readBuildVersion(p)).toBeNull(); } finally { rmSync(p, { force: true }); }
  });
});
