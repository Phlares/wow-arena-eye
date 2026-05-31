import { describe, it, expect } from 'vitest';
import { sampleAt } from '../src/metrics/sampleAt.js';
import type { Sample } from '../src/metrics/types.js';

const track: Sample[] = [
  { tSec: 0, x: 0, y: 0, hpPct: 1 },
  { tSec: 10, x: 10, y: 0, hpPct: 0.5 },
  { tSec: 20, x: 10, y: 10, hpPct: 0 },
];

describe('sampleAt', () => {
  it('lerps position and step-holds hp between samples', () => {
    const s = sampleAt(track, 5)!;
    expect(s.x).toBeCloseTo(5, 5);
    expect(s.y).toBeCloseTo(0, 5);
    expect(s.hpPct).toBe(1);
  });
  it('returns exact sample at a boundary', () => {
    expect(sampleAt(track, 10)).toMatchObject({ x: 10, y: 0, hpPct: 0.5 });
  });
  it('clamps before first / after last; undefined for empty', () => {
    expect(sampleAt(track, -5)).toMatchObject({ x: 0, y: 0 });
    expect(sampleAt(track, 999)).toMatchObject({ x: 10, y: 10 });
    expect(sampleAt([], 5)).toBeUndefined();
  });
});
