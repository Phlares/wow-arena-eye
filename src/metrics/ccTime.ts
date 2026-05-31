import { ccInfo } from '../metadata/spells.js';
import type { DrCategory } from './types.js';

export interface Window { start: number; end: number; }

export interface CcDurations {
  timeControlledSec: number;
  castDenialSec: number;
  hardCcSec: number;
  rootSec: number;
  byCategory: { category: DrCategory; durationSec: number }[];
}

const HARD = new Set<DrCategory>(['stun', 'incapacitate', 'disorient']);

/** Summed length (seconds, 0.1s precision) of the union of [start,end) windows. */
export function unionSeconds(windows: Window[]): number {
  const valid = windows.filter((w) => w.end > w.start).sort((a, b) => a.start - b.start);
  if (valid.length === 0) return 0;
  let totalMs = 0;
  let curStart = valid[0].start;
  let curEnd = valid[0].end;
  for (let i = 1; i < valid.length; i++) {
    const w = valid[i];
    if (w.start <= curEnd) curEnd = Math.max(curEnd, w.end);
    else { totalMs += curEnd - curStart; curStart = w.start; curEnd = w.end; }
  }
  totalMs += curEnd - curStart;
  return Math.round(totalMs / 100) / 10;
}

/**
 * Bucket a unit's CC aura intervals (+ interrupt-lockout windows) into cast-denial / hard-CC / roots,
 * union-merged so overlapping CCs are not double-counted. Open-ended auras are clamped to matchEndMs.
 */
export function computeCcDurations(
  intervals: { spellId: number; name: string; start: number; end: number }[],
  interruptWindows: Window[],
  matchEndMs: number,
): CcDurations {
  const clampEnd = (end: number) => (end > matchEndMs ? matchEndMs : end);
  const castDenial: Window[] = [...interruptWindows];
  const hard: Window[] = [];
  const root: Window[] = [];
  const byCat = new Map<DrCategory, Window[]>();
  const pushCat = (c: DrCategory, w: Window) => { const a = byCat.get(c) ?? []; a.push(w); byCat.set(c, a); };

  for (const iv of intervals) {
    const cc = ccInfo(iv.spellId);
    if (!cc) continue;
    const w: Window = { start: iv.start, end: clampEnd(iv.end) };
    if (w.end <= w.start) continue;
    pushCat(cc.category, w);
    if (cc.category === 'silence') castDenial.push(w);
    else if (cc.category === 'root') root.push(w);
    else if (HARD.has(cc.category)) hard.push(w);
    // disarm / taunt / knockback: tracked in byCategory only, excluded from the three buckets + total
  }

  return {
    timeControlledSec: unionSeconds([...castDenial, ...hard, ...root]),
    castDenialSec: unionSeconds(castDenial),
    hardCcSec: unionSeconds(hard),
    rootSec: unionSeconds(root),
    byCategory: [...byCat.entries()].map(([category, ws]) => ({ category, durationSec: unionSeconds(ws) })),
  };
}
