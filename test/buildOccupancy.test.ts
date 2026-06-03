import { describe, it, expect } from 'vitest';
import { worldToCell, buildOccluderGrid } from '../scripts/build-occupancy.mjs';

describe('occupancy grid builder', () => {
  it('maps world coords to grid cells', () => {
    const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
    expect(worldToCell(bounds, 2, 1, 1)).toEqual({ col: 0, row: 0 });
    expect(worldToCell(bounds, 2, 19, 19)).toEqual({ col: 9, row: 9 });
  });

  it('marks an enclosed never-visited region as occluder, border void as walkable', () => {
    // 20x20 yard arena, 2yd cells = 10x10. Visit every cell MANY times EXCEPT a central 2x2 block
    // (cols 4-5, rows 4-5) which is never visited → enclosed void → occluder. Leave one border
    // column (col 9) unvisited too → exterior void → must NOT become occluder.
    const positions: { x: number; y: number }[] = [];
    for (let c = 0; c < 9; c++) for (let r = 0; r < 10; r++) {
      if (c >= 4 && c <= 5 && r >= 4 && r <= 5) continue; // central hole
      for (let k = 0; k < 10; k++) positions.push({ x: c * 2 + 1, y: r * 2 + 1 });
    }
    const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
    const grid = buildOccluderGrid('TEST', positions, { cellSize: 2, saturationCount: 8, bounds });
    const at = (c: number, r: number) => grid.voidness[r * grid.cols + c];
    expect(at(4, 4)).toBeGreaterThan(0.9);  // central hole = occluder
    expect(at(5, 5)).toBeGreaterThan(0.9);
    expect(at(0, 0)).toBeLessThan(0.2);     // walkable
    expect(at(9, 0)).toBeLessThan(0.2);     // border-unvisited but exterior → zeroed, NOT occluder
    expect(grid.zoneId).toBe('TEST');
    expect(grid.coverage).toBeGreaterThan(0);
  });
});
