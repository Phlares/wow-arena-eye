import type { XY } from '../src/metrics/positionHarvest.js';
export type { XY };
export interface GridBounds { minX: number; minY: number; maxX: number; maxY: number; }
export interface OccluderGridLite {
  zoneId: string; bounds: GridBounds; cellSize: number; cols: number; rows: number;
  voidness: number[]; sampleCount: number; coverage: number; isZAxisMap: boolean;
}
export interface GridOpts { cellSize?: number; saturationCount?: number; voidThreshold?: number; isZAxisMap?: boolean; bounds?: GridBounds }
export function worldToCell(bounds: GridBounds, cellSize: number, x: number, y: number): { col: number; row: number };
export function boundsOf(positions: XY[], cellSize: number): GridBounds;
export function floodFillExterior(voidness: number[], cols: number, rows: number, voidThreshold: number): boolean[];
export function gridFromCounts(zoneId: string, counts: number[], bounds: GridBounds, cellSize: number, cols: number, rows: number, sampleCount: number, opts?: GridOpts): OccluderGridLite;
export function buildOccluderGrid(zoneId: string, positions: XY[], opts?: GridOpts): OccluderGridLite;
export function accumulateCells(cellMap: Map<string, number>, positions: XY[], cellSize: number): Map<string, number>;
export function gridFromCellAccum(zoneId: string, cellMap: Map<string, number>, sampleCount: number, opts?: GridOpts): OccluderGridLite;
