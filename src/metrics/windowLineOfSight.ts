import type { OccluderGrid, OffensiveWindow, PositionTrack, UnitMetrics, LosDisruptor, WindowLineOfSight, DisruptorKind } from './types.js';
import { losAt, clearFraction } from './lineOfSight.js';

/** Bolt a lineOfSight annotation onto each window (its primary target ↔ nearest attacker). */
export function addWindowLineOfSight(
  windows: OffensiveWindow[], grid: OccluderGrid, tracks: Map<string, PositionTrack>,
  disruptors: LosDisruptor[], units: UnitMetrics[],
): OffensiveWindow[] {
  const players = units.filter((u) => u.kind === 'player');
  return windows.map((w) => {
    const targetId = w.damageByTarget[0]?.unitId;
    const target = targetId ? tracks.get(targetId) : undefined;
    if (!targetId || !target) return w;
    const attackers = players.filter((p) => p.team === w.attackingTeam).map((p) => tracks.get(p.unitId)).filter((t): t is PositionTrack => !!t);
    // nearest attacker by LoS occlusion proxy: pick the lowest-occlusion (most-visible) result at window start
    let best = { result: 'unknown' as WindowLineOfSight['result'], occlusion: Infinity };
    for (const at of attackers) {
      const q = losAt(grid, target, at, w.startSec, disruptors, w.defendingTeam);
      if (q.result !== 'unknown' && q.occlusion < best.occlusion) best = { result: q.result, occlusion: q.occlusion };
    }
    const nearest = attackers[0];
    const cf = nearest ? clearFraction(grid, target, nearest, w.startSec, w.endSec, disruptors, w.defendingTeam) : undefined;
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
