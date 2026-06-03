import { describe, it, expect } from 'vitest';
import { addWindowLineOfSight } from '../src/metrics/windowLineOfSight.js';
import type { OccluderGrid, OffensiveWindow, PositionTrack, UnitMetrics } from '../src/metrics/types.js';

function gridPillar(): OccluderGrid {
  const voidness = new Array(100).fill(0);
  for (const [c, r] of [[4,4],[5,4],[4,5],[5,5]]) voidness[r*10+c] = 1;
  return { zoneId: 'T', bounds: { minX:0,minY:0,maxX:20,maxY:20 }, cellSize:2, cols:10, rows:10, voidness, sampleCount:9999, coverage:0.9, isZAxisMap:false };
}
const dense = (id: string, x: number, y: number): PositionTrack => ({ unitId: id, samples: Array.from({length:26},(_,i)=>({tSec:i,x,y})), breaks: [] });
const player = (unitId: string, team: 'friendly'|'enemy'): UnitMetrics => ({ unitId, name: unitId, kind: 'player', team } as unknown as UnitMetrics);

it('annotates a window with target↔nearest-attacker LoS', () => {
  const tracks = new Map<string, PositionTrack>([['F1', dense('F1',2,10)], ['E1', dense('E1',18,10)]]);
  const units = [player('F1','friendly'), player('E1','enemy')];
  const w: OffensiveWindow = { attackingTeam:'enemy', defendingTeam:'friendly', startSec:10, endSec:20, openedBy:[], teamDamageTaken:0, damageByTarget:[{unitId:'F1',name:'F1',damage:5000}], mitigation:{available:[],used:[]}, counterPlay:{ccOnDefenders:[],threatImmuneAuras:[]} } as OffensiveWindow;
  const out = addWindowLineOfSight([w], gridPillar(), tracks, [], units);
  const los = out[0].lineOfSight!;
  expect(los.primaryTargetId).toBe('F1');
  expect(los.result).toBe('blocked'); // pillar between F1 and E1
});
