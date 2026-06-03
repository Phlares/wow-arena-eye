import type { XY } from '../src/metrics/positionHarvest.js';
export type { XY };
export interface GridBounds { minX: number; minY: number; maxX: number; maxY: number; }
export interface OccluderGridLite {
  zoneId: string; bounds: GridBounds; cellSize: number; cols: number; rows: number;
  voidness: number[]; sampleCount: number; coverage: number; isZAxisMap: boolean;
}
export function worldToCell(bounds: GridBounds, cellSize: number, x: number, y: number): { col: number; row: number };
export function boundsOf(positions: XY[], cellSize: number): GridBounds;
export function floodFillExterior(voidness: number[], cols: number, rows: number, voidThreshold: number): boolean[];
export function buildOccluderGrid(zoneId: string, positions: XY[], opts?: { cellSize?: number; saturationCount?: number; voidThreshold?: number; isZAxisMap?: boolean; bounds?: GridBounds }): OccluderGridLite;
