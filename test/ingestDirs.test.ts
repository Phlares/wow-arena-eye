import { describe, it, expect } from 'vitest';
import { resolveIngestDirs } from '../src/cli/ingest-db.js';

describe('resolveIngestDirs', () => {
  it('uses explicit args when present', () => {
    expect(resolveIngestDirs(['a', 'b'], { liveLogsDir: 'L', sampleLogsDir: 'S' })).toEqual(['a', 'b']);
  });
  it('defaults to liveLogsDir when no args', () => {
    expect(resolveIngestDirs([], { liveLogsDir: 'L', sampleLogsDir: 'S' })).toEqual(['L']);
  });
  it('falls back to sampleLogsDir when liveLogsDir is absent', () => {
    expect(resolveIngestDirs([], { sampleLogsDir: 'S' })).toEqual(['S']);
  });
});
