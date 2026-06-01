import { eventType, srcId, destId, amount, eventTimeMs, DAMAGE_EVENTS } from './eventAccess.js';
import { unitTeam, resolvePlayer, type Team, type FocusTracks, type AttackerTrack, type FocusSegment } from './types.js';

const WINDOW_MS = 5000;
const STEP_MS = 500;
const DWELL_MS = 1000;

export interface FocusOpts { windowMs?: number; stepMs?: number; dwellMs?: number; }

interface Hit { target: string; ms: number; amount: number; }

/** Hold the previous *stable* target through any non-null run shorter than dwellTicks.
 *  A genuine disengage (null run >= dwellTicks) resets the memory. */
function debounce(raw: (string | null)[], dwellTicks: number): (string | null)[] {
  if (dwellTicks <= 1) return raw.slice();
  const out = raw.slice();
  let lastStable: string | null = null;
  let i = 0;
  while (i < out.length) {
    let j = i;
    while (j < out.length && out[j] === out[i]) j++;
    const runLen = j - i;
    const val = out[i];
    if (val === null) {
      if (runLen >= dwellTicks) lastStable = null;
    } else if (runLen < dwellTicks) {
      for (let k = i; k < j; k++) out[k] = lastStable;
    } else {
      lastStable = val;
    }
    i = j;
  }
  return out;
}

function encodeSegments(ticks: (string | null)[], stepMs: number, nameOf: (id: string) => string): FocusSegment[] {
  const segs: FocusSegment[] = [];
  let i = 0;
  while (i < ticks.length) {
    const val = ticks[i];
    let j = i;
    while (j < ticks.length && ticks[j] === val) j++;
    // fromSec/toSec are grid-snapped to the tick boundaries (toSec = exclusive end tick * step);
    // the final segment's toSec can therefore round up to ~stepMs past the last real event.
    if (val !== null) segs.push({ target: val, targetName: nameOf(val), fromSec: (i * stepMs) / 1000, toSec: (j * stepMs) / 1000 });
    i = j;
  }
  return segs;
}

export function computeFocusTracks(match: unknown, opts: FocusOpts = {}): FocusTracks {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const stepMs = opts.stepMs ?? STEP_MS;
  const dwellTicks = Math.max(1, Math.round((opts.dwellMs ?? DWELL_MS) / stepMs));

  const m = match as { events?: unknown[]; units?: Record<string, Record<string, unknown>> };
  const events = Array.isArray(m.events) ? m.events : [];
  const units = m.units ?? {};
  const teamOf = (id: string | undefined): Team => unitTeam((units[id ?? ''] ?? {}).reaction);
  const nameOf = (id: string): string => { const u = units[id]; return u && typeof u.name === 'string' ? u.name : id; };
  const attackerOf = (id: string | undefined): string | undefined => resolvePlayer(units, id);

  // Bucket hits per attacker; track match damage span.
  const hitsByAttacker = new Map<string, Hit[]>();
  let startMs: number | undefined;
  let endMs: number | undefined;
  for (const ev of events) {
    if (!DAMAGE_EVENTS.test(eventType(ev))) continue;
    const ms = eventTimeMs(ev);
    if (ms === undefined) continue;
    const attacker = attackerOf(srcId(ev));
    const target = destId(ev);
    if (!attacker || !target) continue;
    const at = teamOf(attacker);
    if (at === 'neutral' || at === teamOf(target)) continue; // enemy dest only (neutral dest = enemy summon, allowed)
    let arr = hitsByAttacker.get(attacker);
    if (!arr) { arr = []; hitsByAttacker.set(attacker, arr); }
    arr.push({ target, ms, amount: amount(ev) });
    if (startMs === undefined || ms < startMs) startMs = ms;
    if (endMs === undefined || ms > endMs) endMs = ms;
  }

  if (startMs === undefined || endMs === undefined) return { stepMs, tickCount: 0, startMs: 0, tracks: [] };
  const tickCount = Math.floor((endMs - startMs) / stepMs) + 1;

  const tracks: AttackerTrack[] = [];
  for (const [attacker, hits] of hitsByAttacker) {
    hits.sort((a, b) => a.ms - b.ms);
    const raw: (string | null)[] = new Array(tickCount).fill(null);
    const windowSum = new Map<string, number>();
    let lo = 0, hi = 0;
    let prevDominant: string | null = null;
    for (let i = 0; i < tickCount; i++) {
      const tickMs = startMs + i * stepMs;
      const loBound = tickMs - windowMs;
      while (hi < hits.length && hits[hi].ms <= tickMs) {
        windowSum.set(hits[hi].target, (windowSum.get(hits[hi].target) ?? 0) + hits[hi].amount);
        hi++;
      }
      while (lo < hi && hits[lo].ms < loBound) {
        const t = hits[lo].target;
        const c = (windowSum.get(t) ?? 0) - hits[lo].amount;
        if (c <= 0) windowSum.delete(t); else windowSum.set(t, c);
        lo++;
      }
      // argmax with hysteresis: keep incumbent unless a challenger STRICTLY exceeds it.
      let best: string | null = null;
      let bestDmg = 0;
      const incumbentDmg = prevDominant !== null ? (windowSum.get(prevDominant) ?? 0) : 0;
      if (incumbentDmg > 0) { best = prevDominant; bestDmg = incumbentDmg; }
      for (const [t, dmg] of windowSum) if (dmg > bestDmg) { best = t; bestDmg = dmg; }
      raw[i] = best;
      prevDominant = best;
    }
    const smoothed = debounce(raw, dwellTicks);
    tracks.push({ attacker, attackerName: nameOf(attacker), team: teamOf(attacker), ticks: smoothed, segments: encodeSegments(smoothed, stepMs, nameOf) });
  }
  return { stepMs, tickCount, startMs, tracks };
}
