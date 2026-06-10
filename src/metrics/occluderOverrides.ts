import type { OccluderGrid } from './types.js';
import type { FittedOccluders, Pt } from './occluderFit.js';
import { pointInPolygon } from './losVector.js';

/** Hand-painted corrections to the auto-fitted occluder geometry (drawn in the occluder
 *  editor, saved to src/metadata/occluderOverrides.json). Three kinds:
 *  - remove: regions where the occupancy inference is WRONG - their cells are zeroed before
 *    fitting, so bogus pillars never form
 *  - add: occluder polygons the inference missed, each at a height LEVEL
 *  - slopes: polylines marking sloped LoS boundaries (ramps/ledges) with from->to heights
 *  Height levels: 0 = ground, 1 ~ one character (3yd), 2 ~ 8yd, 3 = 20yd (Mugambala split). */

export const HEIGHT_LEVELS_YD = [0, 3, 8, 20] as const;
export type HeightLevel = 0 | 1 | 2 | 3;

export interface AddShape { heightLevel: HeightLevel; points: Pt[]; label?: string }
export interface RemoveShape { points: Pt[]; label?: string }
export interface SlopeLine { fromHeight: HeightLevel; toHeight: HeightLevel; points: Pt[]; label?: string }
export interface ZoneOverrides { add: AddShape[]; remove: RemoveShape[]; slopes: SlopeLine[] }
export interface OverridesFile { version: number; zones: Record<string, ZoneOverrides> }

export interface ManualOccluder { heightYd: number; points: Pt[]; label?: string }
export interface SlopeOut { fromHeightYd: number; toHeightYd: number; points: Pt[]; label?: string }
export interface FinalOccluders extends FittedOccluders { manual: ManualOccluder[]; slopes: SlopeOut[] }

/** Zero the void-ness of every cell whose CENTER falls inside a remove region, so the
 *  polygon fit never sees the bad inference. Returns the input grid when there is nothing
 *  to remove; never mutates it. */
export function applyRemoveRegions(grid: OccluderGrid, overrides: ZoneOverrides | undefined): OccluderGrid {
  const regions = overrides?.remove ?? [];
  if (!regions.length) return grid;
  const voidness = [...grid.voidness];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const center = {
        x: grid.bounds.minX + (c + 0.5) * grid.cellSize,
        y: grid.bounds.minY + (r + 0.5) * grid.cellSize,
      };
      if (regions.some((reg) => pointInPolygon(center, reg.points))) voidness[r * grid.cols + c] = 0;
    }
  }
  return { ...grid, voidness };
}

/** A height LEVEL from (possibly hand-edited) JSON resolved to yards, clamped to the table. */
function heightYd(level: number): number {
  return HEIGHT_LEVELS_YD[Math.max(0, Math.min(HEIGHT_LEVELS_YD.length - 1, Math.round(level) || 0))];
}

/** Attach the hand-painted additions/slopes (heights resolved to yards) to a fitted result.
 *  NOTE: remove regions act on CELL CENTERS — a painted region smaller than one grid cell
 *  (~2yd) may cover no center and silently do nothing; paint at least a full cell. */
export function finalizeOccluders(fitted: FittedOccluders, overrides: ZoneOverrides | undefined): FinalOccluders {
  return {
    ...fitted,
    manual: (overrides?.add ?? []).map((a) => ({
      heightYd: heightYd(a.heightLevel), points: a.points, ...(a.label ? { label: a.label } : {}),
    })),
    slopes: (overrides?.slopes ?? []).map((s) => ({
      fromHeightYd: heightYd(s.fromHeight), toHeightYd: heightYd(s.toHeight),
      points: s.points, ...(s.label ? { label: s.label } : {}),
    })),
  };
}
