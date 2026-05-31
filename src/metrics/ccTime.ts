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

// Max plausible duration of a SINGLE CC instance (ms). Bounds runaway unclosed auras
// (applied but never removed -> clamped to match end) without truncating legitimate CC,
// while the union across instances still accumulates repeated CC correctly. Values are
// generous upper bounds on a single undiminished instance: hard CC / silence top out
// ~8s (Polymorph, Fear, Counterspell-school-lock), roots can run long (Entangling Roots
// 30s base), disarm ~8s, knockback/taunt are near-instant.
const MAX_INSTANCE_MS: Record<DrCategory, number> = {
  stun: 10000, incapacitate: 10000, disorient: 10000, silence: 10000,
  root: 30000, disarm: 15000, taunt: 8000, knockback: 5000,
};

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
  // Single source of truth: bucket every CC window by its DR category.
  const byCat = new Map<DrCategory, Window[]>();
  for (const iv of intervals) {
    const cc = ccInfo(iv.spellId);
    if (!cc) continue;
    const end = Math.min(iv.end, matchEndMs, iv.start + MAX_INSTANCE_MS[cc.category]);
    if (end <= iv.start) continue;
    const ws = byCat.get(cc.category);
    if (ws) ws.push({ start: iv.start, end });
    else byCat.set(cc.category, [{ start: iv.start, end }]);
  }

  // Derive the three buckets from the per-category windows (disarm/taunt/knockback
  // stay in byCategory only — excluded from the buckets + total).
  const cat = (c: DrCategory): Window[] => byCat.get(c) ?? [];
  const castDenial = [...interruptWindows, ...cat('silence')];
  const hard = [...cat('stun'), ...cat('incapacitate'), ...cat('disorient')];
  const root = cat('root');

  return {
    timeControlledSec: unionSeconds([...castDenial, ...hard, ...root]),
    castDenialSec: unionSeconds(castDenial),
    hardCcSec: unionSeconds(hard),
    rootSec: unionSeconds(root),
    byCategory: [...byCat.entries()].map(([category, ws]) => ({ category, durationSec: unionSeconds(ws) })),
  };
}
