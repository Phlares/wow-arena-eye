import type { OccluderGrid, OffensiveWindow, PositionTrack, UnitMetrics, LosDisruptor, WindowLineOfSight, DisruptorKind } from './types.js';
import { losAt, clearFraction } from './lineOfSight.js';
import { keepTrack } from './spacing.js';

/** Bolt a lineOfSight annotation onto each window: its primary target vs the MOST-VISIBLE
 *  attacking-team player (lowest occlusion at window start). If even the clearest sightline is
 *  blocked, the target had broken LoS on all attackers. clearFraction tracks that same attacker
 *  so result + clearFraction describe one coherent sightline. */
export function addWindowLineOfSight(
  windows: OffensiveWindow[], grid: OccluderGrid, tracks: Map<string, PositionTrack>,
  disruptors: LosDisruptor[], units: UnitMetrics[],
): OffensiveWindow[] {
  const players = units.filter((u) => u.kind === 'player');
  return windows.map((w) => {
    const targetId = w.damageByTarget[0]?.unitId;
    const target = targetId ? tracks.get(targetId) : undefined;
    if (!targetId || !target) return w;
    const attackers = players.filter((p) => p.team === w.attackingTeam).map((p) => tracks.get(p.unitId)).filter(keepTrack);
    // Pick the most-visible attacker (lowest occlusion, ignoring unresolved) at window start.
    let best: { result: WindowLineOfSight['result']; occlusion: number; track?: PositionTrack } = { result: 'unknown', occlusion: Infinity };
    for (const at of attackers) {
      const q = losAt(grid, target, at, w.startSec, disruptors, w.defendingTeam);
      if (q.result !== 'unknown' && q.occlusion < best.occlusion) best = { result: q.result, occlusion: q.occlusion, track: at };
    }
    // clearFraction over the SAME (most-visible) attacker, so the two fields are coherent.
    const cf = best.track ? clearFraction(grid, target, best.track, w.startSec, w.endSec, disruptors, w.defendingTeam) : undefined;
    const active = disruptors.filter((d) => d.startSec <= w.endSec && d.endSec >= w.startSec).map((d) => d.kind);
    const los: WindowLineOfSight = {
      primaryTargetId: targetId,
      result: best.result,
      clearFraction: cf,
      approximate: grid.isZAxisMap,
      disruptorsActive: [...new Set<DisruptorKind>(active)],
    };
    return { ...w, lineOfSight: los };
  });
}
