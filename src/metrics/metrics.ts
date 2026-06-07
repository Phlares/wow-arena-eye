import { computeUnitMetrics } from './perUnit.js';
import { groupUnits } from './grouping.js';
import { buildTimeline } from './timeline.js';
import { buildAuraState } from './auraState.js';
import { computeCoordination } from './coordination.js';
import { computeFocusTracks } from './targeting.js';
import { collectCasts } from './cooldownTimeline.js';
import { computeOffensiveWindows } from './offensiveWindows.js';
import { computeAttackerGoTracks } from './attackerGoTracks.js';
import { computeDeathBlows } from './deathBlows.js';
import { computeAnchors } from './anchors.js';
import { HEALER_SPEC_IDS } from './registry.js';
import { buildPositionTracks } from './positionTracks.js';
import { attachSpacing, computeDistanceBands } from './spacing.js';
import { addWindowPositioning } from './windowPositioning.js';
import { loadOccluderGrid, COVERAGE_FLOOR, Z_AXIS_MAPS } from '../metadata/occupancy.js';
import { collectLosDisruptors } from './losDisruptors.js';
import { addWindowLineOfSight } from './windowLineOfSight.js';
import type { MatchMetrics } from './types.js';

export * from './types.js';

export function computeMatchMetrics(match: unknown): MatchMetrics {
  const m = match as { playerId?: unknown; units?: Record<string, { name?: unknown }> };
  const playerUnitId = typeof m.playerId === 'string' ? m.playerId : undefined;
  const rawUnits = m.units ?? {};
  const nameOf = (id: string): string => { const u = rawUnits[id]; return u && typeof u.name === 'string' && u.name.length > 0 ? u.name : id; };
  const auras = buildAuraState(match);
  const casts = collectCasts(match);
  const baseUnits = computeUnitMetrics(match, auras, casts);
  const tracks = buildPositionTracks(baseUnits, match, casts);
  const units = attachSpacing(baseUnits, tracks);
  const focusTracks = computeFocusTracks(match);
  const baseWindows = computeOffensiveWindows(match, units, auras, casts);
  const windows = addWindowPositioning(baseWindows, tracks, units, match, casts);
  const zoneId = String((match as { startInfo?: { zoneId?: unknown } }).startInfo?.zoneId ?? '');
  const grid = loadOccluderGrid(zoneId);
  const usableGrid = grid && grid.coverage >= COVERAGE_FLOOR ? grid : undefined;
  const losDisruptors = collectLosDisruptors(match);
  const windowsWithLos = usableGrid ? addWindowLineOfSight(windows, usableGrid, tracks, losDisruptors, units) : windows;
  const lineOfSight = { zoneId, resolved: !!usableGrid, approximate: usableGrid ? usableGrid.isZAxisMap : Z_AXIS_MAPS.has(zoneId) };
  return {
    teams: groupUnits(units, playerUnitId),
    timeline: buildTimeline(match),
    coordination: computeCoordination(match, HEALER_SPEC_IDS, focusTracks),
    focusTracks,
    offensiveWindows: windowsWithLos,
    attackerGoTracks: computeAttackerGoTracks(match, units, auras),
    deathBlows: computeDeathBlows(match, nameOf),
    anchors: computeAnchors(match, tracks, casts),
    positionTracks: [...tracks.values()],
    distanceBands: computeDistanceBands(units, tracks),
    lineOfSight,
    losDisruptors,
    playerUnitId,
  };
}
