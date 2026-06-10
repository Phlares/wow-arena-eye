import { describe, it, expect } from 'vitest';
import { applyRemoveRegions, finalizeOccluders, HEIGHT_LEVELS_YD } from '../src/metrics/occluderOverrides.js';
import type { OccluderGrid } from '../src/metrics/types.js';
import type { ZoneOverrides } from '../src/metrics/occluderOverrides.js';

function grid(): OccluderGrid {
  // 6x6, cellSize 2, world 0..12; a 2x2 high-void blob at cells (2-3, 2-3) = world (4..8, 4..8)
  const cols = 6, rows = 6;
  const voidness = new Array(cols * rows).fill(0.1);
  for (const r of [2, 3]) for (const c of [2, 3]) voidness[r * cols + c] = 0.95;
  return { zoneId: 'T', bounds: { minX: 0, minY: 0, maxX: 12, maxY: 12 }, cellSize: 2, cols, rows, voidness, sampleCount: 1, coverage: 1, isZAxisMap: false };
}

describe('applyRemoveRegions', () => {
  it('zeroes void-ness for cells whose center lies inside a remove polygon', () => {
    const g = grid();
    const overrides: ZoneOverrides = {
      remove: [{ points: [{ x: 3.5, y: 3.5 }, { x: 8.5, y: 3.5 }, { x: 8.5, y: 8.5 }, { x: 3.5, y: 8.5 }] }],
      add: [], slopes: [],
    };
    const out = applyRemoveRegions(g, overrides);
    expect(out.voidness[2 * 6 + 2]).toBe(0);            // blob cells erased
    expect(out.voidness[3 * 6 + 3]).toBe(0);
    expect(out.voidness[0]).toBe(0.1);                  // untouched floor
    expect(g.voidness[2 * 6 + 2]).toBe(0.95);           // input grid not mutated
  });

  it('no remove regions -> grid returned as-is', () => {
    const g = grid();
    expect(applyRemoveRegions(g, { remove: [], add: [], slopes: [] })).toBe(g);
  });
});

describe('finalizeOccluders', () => {
  it('appends manual add-polygons with their height in yards and passes slopes through', () => {
    const fitted = { zoneId: 'T', threshold: 0.85, walls: [], pillars: [[{ x: 4, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 8 }, { x: 4, y: 8 }]] };
    const overrides: ZoneOverrides = {
      remove: [],
      add: [{ heightLevel: 2, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }] }],
      slopes: [{ fromHeight: 0, toHeight: 3, points: [{ x: 1, y: 1 }, { x: 5, y: 5 }] }],
    };
    const out = finalizeOccluders(fitted, overrides);
    expect(out.pillars.length).toBe(1);                 // fitted geometry kept
    expect(out.manual.length).toBe(1);
    expect(out.manual[0].heightYd).toBe(HEIGHT_LEVELS_YD[2]);  // level 2 = 8yd
    expect(out.slopes.length).toBe(1);
    expect(out.slopes[0].fromHeightYd).toBe(0);
    expect(out.slopes[0].toHeightYd).toBe(20);          // level 3 = the Mugambala split
  });

  it('no overrides -> empty manual/slopes arrays, fitted unchanged', () => {
    const fitted = { zoneId: 'T', threshold: 0.85, walls: [], pillars: [] };
    const out = finalizeOccluders(fitted, undefined);
    expect(out.manual).toEqual([]);
    expect(out.slopes).toEqual([]);
  });
});
