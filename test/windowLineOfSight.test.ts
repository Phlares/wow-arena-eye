import { describe, it, expect } from 'vitest';
import { addWindowLineOfSight } from '../src/metrics/windowLineOfSight.js';
import type { OccluderGrid, OffensiveWindow, PositionTrack, UnitMetrics, LosDisruptor } from '../src/metrics/types.js';

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
  expect(los.clearFraction).toBeCloseTo(0); // blocked throughout → ~0
});

function baseWindow(over: Partial<OffensiveWindow>): OffensiveWindow {
  return { attackingTeam: 'enemy', defendingTeam: 'friendly', startSec: 10, endSec: 20, openedBy: [], teamDamageTaken: 0, damageByTarget: [{ unitId: 'F1', name: 'F1', damage: 5000 }], mitigation: { available: [], used: [] }, counterPlay: { ccOnDefenders: [], threatImmuneAuras: [] }, ...over } as OffensiveWindow;
}

it('returns the window unchanged when there is no damage target', () => {
  const out = addWindowLineOfSight([baseWindow({ damageByTarget: [] })], gridPillar(), new Map(), [], []);
  expect(out[0].lineOfSight).toBeUndefined();
});

it('picks the MOST-VISIBLE attacker (clear) even when another is blocked, with coherent clearFraction', () => {
  // F1 target at (2,10). E1 behind the pillar (18,10) = blocked; E2 on the open top edge (18,2) = clear.
  const tracks = new Map<string, PositionTrack>([['F1', dense('F1', 2, 2)], ['E1', dense('E1', 18, 10)], ['E2', dense('E2', 18, 2)]]);
  const units = [player('F1', 'friendly'), player('E1', 'enemy'), player('E2', 'enemy')];
  const los = addWindowLineOfSight([baseWindow({})], gridPillar(), tracks, [], units)[0].lineOfSight!;
  expect(los.result).toBe('clear');            // most-visible attacker (E2) is clear
  expect(los.clearFraction).toBeCloseTo(1);    // and clearFraction tracks that same attacker
});

it('lists deduped active disruptors overlapping the window', () => {
  const tracks = new Map<string, PositionTrack>([['F1', dense('F1', 2, 2)], ['E1', dense('E1', 18, 2)]]);
  const units = [player('F1', 'friendly'), player('E1', 'enemy')];
  const ds: LosDisruptor[] = [
    { kind: 'ice-wall', casterId: 'E1', team: 'enemy', startSec: 12, endSec: 18, modeled: false },
    { kind: 'ice-wall', casterId: 'E1', team: 'enemy', startSec: 30, endSec: 36, modeled: false }, // outside window
  ];
  const los = addWindowLineOfSight([baseWindow({})], gridPillar(), tracks, ds, units)[0].lineOfSight!;
  expect(los.disruptorsActive).toEqual(['ice-wall']); // only the overlapping one, deduped
});
