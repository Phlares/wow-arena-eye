import { computeUnitMetrics } from './perUnit.js';
import { groupUnits } from './grouping.js';
import { buildTimeline } from './timeline.js';
import { buildAuraState } from './auraState.js';
import { computeCoordination } from './coordination.js';
import { computeFocusTracks } from './targeting.js';
import { collectCasts } from './cooldownTimeline.js';
import { computeOffensiveWindows } from './offensiveWindows.js';
import { HEALER_SPEC_IDS } from './registry.js';
import { buildPositionTracks } from './positionTracks.js';
import { attachSpacing, computeDistanceBands, addWindowPositioning } from './spacing.js';
import type { MatchMetrics } from './types.js';

export * from './types.js';

export function computeMatchMetrics(match: unknown): MatchMetrics {
  const m = match as { playerId?: unknown };
  const playerUnitId = typeof m.playerId === 'string' ? m.playerId : undefined;
  const auras = buildAuraState(match);
  const casts = collectCasts(match);
  const baseUnits = computeUnitMetrics(match, auras, casts);
  const tracks = buildPositionTracks(baseUnits, match);
  const units = attachSpacing(baseUnits, tracks);
  const focusTracks = computeFocusTracks(match);
  const windows = addWindowPositioning(computeOffensiveWindows(match, units, auras, casts), tracks, units, match, casts);
  return {
    teams: groupUnits(units, playerUnitId),
    timeline: buildTimeline(match),
    coordination: computeCoordination(match, HEALER_SPEC_IDS, focusTracks),
    focusTracks,
    offensiveWindows: windows,
    positionTracks: [...tracks.values()],
    distanceBands: computeDistanceBands(units, tracks),
    playerUnitId,
  };
}
