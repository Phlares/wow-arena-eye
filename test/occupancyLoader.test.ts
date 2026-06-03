import { describe, it, expect } from 'vitest';
import { loadOccluderGrid, Z_AXIS_MAPS, COVERAGE_FLOOR } from '../src/metadata/occupancy.js';

describe('occluder grid loader', () => {
  it('exposes the z-axis arena set and a coverage floor', () => {
    expect(Z_AXIS_MAPS.has('1911')).toBe(true); // Mugambala
    expect(Z_AXIS_MAPS.has('1825')).toBe(false); // Hook Point (flat)
    expect(COVERAGE_FLOOR).toBeGreaterThan(0);
  });
  it('returns undefined for an arena with no committed grid', () => {
    expect(loadOccluderGrid('9999999')).toBeUndefined();
  });
});
