import type { PositionTrack, AnchorPlacements } from './types.js';
import { positionAt } from './positionTracks.js';
import { anchorInfo } from '../metadata/repositioning.js';
import { matchStartMs } from './eventAccess.js';
import { round1 } from './spacing.js';
import type { CastEvent } from './cooldownTimeline.js';

/** Per-player escape-anchor placements (e.g. Demonic Circle: Summon). The placement position is
 *  the caster's position at cast time, sampled from their position track (CastEvent carries no
 *  position). Substrate for the range-to-anchor ("range to my port") detail-view target. */
export function computeAnchors(match: unknown, tracks: Map<string, PositionTrack>, casts: Map<string, CastEvent[]>): AnchorPlacements[] {
  const m = match as { events?: unknown[] };
  const events = Array.isArray(m.events) ? m.events : [];
  const startMs = matchStartMs(events) ?? 0;
  const out: AnchorPlacements[] = [];
  for (const [unitId, list] of casts) {
    const track = tracks.get(unitId);
    if (!track) continue;
    const placements: { tSec: number; x: number; y: number }[] = [];
    for (const c of list) {
      if (!anchorInfo(c.spellId)) continue;
      const tSec = (c.ms - startMs) / 1000;
      const pos = positionAt(track, tSec);
      if (pos) placements.push({ tSec: round1(tSec), x: pos.x, y: pos.y });
    }
    if (placements.length) out.push({ unitId, placements });
  }
  return out;
}
