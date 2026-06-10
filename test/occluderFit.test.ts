import { describe, it, expect } from 'vitest';
import { fitOccluders, simplifyLoop } from '../src/metrics/occluderFit.js';
import type { OccluderGrid } from '../src/metrics/types.js';

/** 12x12 grid: 1-cell high-void border ring (the arena wall) + a 3x3 pillar at cols 5-7, rows 5-7. */
function grid(): OccluderGrid {
  const cols = 12, rows = 12;
  const voidness = new Array(cols * rows).fill(0.05);
  for (let c = 0; c < cols; c++) for (const r of [0, rows - 1]) voidness[r * cols + c] = 0.95;
  for (let r = 0; r < rows; r++) for (const c of [0, cols - 1]) voidness[r * cols + c] = 0.95;
  for (let r = 5; r <= 7; r++) for (let c = 5; c <= 7; c++) voidness[r * cols + c] = 0.92;
  return {
    zoneId: 'T', bounds: { minX: 0, minY: 0, maxX: 24, maxY: 24 },
    cellSize: 2, cols, rows, voidness, sampleCount: 1, coverage: 1, isZAxisMap: false,
  };
}

describe('fitOccluders', () => {
  it('separates the border wall from the interior pillar and fits world-coord polygons', () => {
    const out = fitOccluders(grid());
    expect(out.walls.length).toBe(1);
    expect(out.pillars.length).toBe(1);
    const pillar = out.pillars[0];
    // 3x3 cells at cols/rows 5..7, cellSize 2 → square from (10,10) to (16,16)
    const xs = pillar.map((p) => p.x), ys = pillar.map((p) => p.y);
    expect(Math.min(...xs)).toBe(10);
    expect(Math.max(...xs)).toBe(16);
    expect(Math.min(...ys)).toBe(10);
    expect(Math.max(...ys)).toBe(16);
    expect(pillar.length).toBe(4); // simplified to its 4 corners
  });

  it('drops components below minCells', () => {
    const g = grid();
    g.voidness[3 * g.cols + 3] = 0.99; // lone noisy cell
    const out = fitOccluders(g, { minCells: 4 });
    expect(out.pillars.length).toBe(1); // still only the 3x3 pillar
  });
});

describe('simplifyLoop', () => {
  it('collapses collinear staircase-free runs to corner points', () => {
    const square = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 },
      { x: 0, y: 2 }, { x: 0, y: 1 },
    ];
    const out = simplifyLoop(square, 0.1);
    expect(out.length).toBe(4);
  });

  it('smooths a one-cell staircase into a diagonal at epsilon ≥ cell size', () => {
    const stair = [
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 1 },
      { x: 3, y: 2 }, { x: 5, y: 2 }, { x: 5, y: 5 }, { x: 0, y: 5 },
    ];
    const out = simplifyLoop(stair, 1.2);
    expect(out.length).toBeLessThan(stair.length); // staircase vertices removed
  });
});
