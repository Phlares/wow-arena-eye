import { computeCcDurations, sumCcDurations, type Window, type CcDurations } from './ccTime.js';
import { ccInfo, interruptLockoutSec } from '../metadata/spells.js';
import { resolvePlayer, unitTeam, unitKind, type CcSide } from './types.js';
import type { AuraState, Interval } from './auraState.js';

type Units = Record<string, { type?: unknown; reaction?: unknown; ownerId?: unknown }>;
export interface LandedInterrupt { ms: number; spellId: number; targetId: string; }
export interface SufferedInterrupt { ms: number; spellId: number; }

const teamOf = (units: Units, id: string) => unitTeam((units[id] ?? {}).reaction);
const emptyCcSide = (): CcSide => ({ timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0, byCategory: [] });

function counts(intervals: { spellId: number }[]): { count: number; byCount: Map<string, number> } {
  let count = 0;
  const byCount = new Map<string, number>();
  for (const iv of intervals) {
    const cc = ccInfo(iv.spellId);
    if (!cc) continue;
    count++;
    byCount.set(cc.category, (byCount.get(cc.category) ?? 0) + 1);
  }
  return { count, byCount };
}

function toCcSide(d: CcDurations, count: number, byCount: Map<string, number>): CcSide {
  return {
    timeSec: d.timeControlledSec,
    castDenialSec: d.castDenialSec,
    hardCcSec: d.hardCcSec,
    rootSec: d.rootSec,
    count,
    byCategory: d.byCategory.map((b) => ({ category: b.category, count: byCount.get(b.category) ?? 0, durationSec: b.durationSec })),
  };
}

/** CC suffered by playerId from enemy players (single union). Received CC is the player's own — no petIds (pets don't receive owner-credited CC), unlike ccDoneSide. */
export function ccReceivedSide(playerId: string, units: Units, auras: AuraState, suffered: SufferedInterrupt[], matchEndMs: number): CcSide {
  if (unitKind((units[playerId] ?? {}).type) !== 'player') return emptyCcSide();
  const myTeam = teamOf(units, playerId);
  const intervals = auras.intervalsOn(playerId).filter((iv) => {
    const caster = resolvePlayer(units, iv.srcId);
    return !!caster && teamOf(units, caster) !== myTeam;
  });
  const windows: Window[] = suffered.map((x) => ({ start: x.ms, end: x.ms + interruptLockoutSec(x.spellId) * 1000 }));
  const d = computeCcDurations(intervals, windows, matchEndMs);
  const { count, byCount } = counts(intervals);
  return toCcSide(d, count, byCount);
}

/** CC playerId (+pets) landed on enemy players: per-target union, summed across targets. */
export function ccDoneSide(playerId: string, petIds: string[], units: Units, auras: AuraState, landed: LandedInterrupt[], matchEndMs: number): CcSide {
  if (unitKind((units[playerId] ?? {}).type) !== 'player') return emptyCcSide();
  const myTeam = teamOf(units, playerId);
  const byTarget = new Map<string, Interval[]>();
  const allIntervals: Interval[] = [];
  for (const casterId of [playerId, ...petIds]) {
    for (const iv of auras.intervalsBy(casterId)) {
      const tgt = iv.destId;
      if (unitKind((units[tgt] ?? {}).type) !== 'player' || teamOf(units, tgt) === myTeam) continue;
      const arr = byTarget.get(tgt) ?? []; arr.push(iv); byTarget.set(tgt, arr);
      allIntervals.push(iv);
    }
  }
  const windowsByTarget = new Map<string, Window[]>();
  for (const x of landed) {
    const tgt = x.targetId;
    if (unitKind((units[tgt] ?? {}).type) !== 'player' || teamOf(units, tgt) === myTeam) continue;
    const arr = windowsByTarget.get(tgt) ?? []; arr.push({ start: x.ms, end: x.ms + interruptLockoutSec(x.spellId) * 1000 }); windowsByTarget.set(tgt, arr);
  }
  const targets = new Set([...byTarget.keys(), ...windowsByTarget.keys()]);
  const parts = [...targets].map((tgt) => computeCcDurations(byTarget.get(tgt) ?? [], windowsByTarget.get(tgt) ?? [], matchEndMs));
  const summed = sumCcDurations(parts);
  const { count, byCount } = counts(allIntervals);
  return toCcSide(summed, count, byCount);
}
