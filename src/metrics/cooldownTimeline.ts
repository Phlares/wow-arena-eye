import { eventType, srcId, spellId, spellName, eventTimeMs } from './eventAccess.js';

export interface CastEvent { spellId: number; name: string; ms: number; }

/** unitId -> chronological SPELL_CAST_SUCCESS events (spellId + name + ms).
 *  Output arrays are sorted by ms ascending. */
export function collectCasts(match: unknown): Map<string, CastEvent[]> {
  const m = match as { events?: unknown[] };
  const events = Array.isArray(m.events) ? m.events : [];
  const out = new Map<string, CastEvent[]>();
  for (const ev of events) {
    if (eventType(ev) !== 'SPELL_CAST_SUCCESS') continue;
    const s = srcId(ev);
    const sid = spellId(ev);
    const ms = eventTimeMs(ev);
    if (!s || sid === undefined || ms === undefined) continue;
    const arr = out.get(s) ?? [];
    arr.push({ spellId: sid, name: spellName(ev), ms });
    out.set(s, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.ms - b.ms);
  return out;
}

/** Charges available at `atMs` given cast timestamps, cooldown length, and max charges.
 *  Charges regenerate sequentially: a recharge timer of `cooldownMs` runs whenever below max.
 *  See also readyIntervals for the interval-sweep variant of this walk. */
export function chargesAt(castMs: number[], cooldownMs: number, maxCharges: number, atMs: number): number {
  const casts = castMs.filter((c) => c <= atMs).sort((a, b) => a - b);
  let charges = maxCharges;
  let nextRecharge = Infinity;
  for (const c of casts) {
    while (charges < maxCharges && nextRecharge <= c) { charges++; nextRecharge = charges < maxCharges ? nextRecharge + cooldownMs : Infinity; }
    if (charges === 0) continue; // cast with no charge (shouldn't happen in clean logs)
    if (charges === maxCharges) nextRecharge = c + cooldownMs;
    charges--;
  }
  while (charges < maxCharges && nextRecharge <= atMs) { charges++; nextRecharge = charges < maxCharges ? nextRecharge + cooldownMs : Infinity; }
  return charges;
}

export function isAvailable(castMs: number[], cooldownMs: number, maxCharges: number, atMs: number): boolean {
  return chargesAt(castMs, cooldownMs, maxCharges, atMs) > 0;
}

/** Maximal intervals within [startMs, endMs] where ≥1 charge is available.
 *  Assumes the spell is fully stocked at startMs and ignores casts before it — intended for
 *  WHOLE-MATCH spans. For a sub-window, carry-in charge state must be precomputed first.
 *  Exposes hold/idle durations (the substrate for later offensive-throughput analysis). */
export function readyIntervals(castMs: number[], cooldownMs: number, maxCharges: number, startMs: number, endMs: number): { start: number; end: number }[] {
  const casts = castMs.filter((c) => c >= startMs && c < endMs).sort((a, b) => a - b);
  let charges = maxCharges;
  let nextRecharge = Infinity;
  let ci = 0;
  let readyStart: number | null = charges > 0 ? startMs : null;
  const out: { start: number; end: number }[] = [];
  let now = startMs;
  while (now < endMs) {
    const nextCast = ci < casts.length ? casts[ci] : Infinity;
    const ev = Math.min(nextCast, nextRecharge, endMs);
    now = ev;
    if (ev === endMs) break;
    if (nextRecharge <= nextCast) {
      charges++;
      if (readyStart === null) readyStart = now;
      nextRecharge = charges < maxCharges ? now + cooldownMs : Infinity;
    } else {
      ci++;
      if (charges === maxCharges) nextRecharge = now + cooldownMs;
      if (charges > 0) charges--;
      if (charges === 0 && readyStart !== null) { out.push({ start: readyStart, end: now }); readyStart = null; }
    }
  }
  if (readyStart !== null) out.push({ start: readyStart, end: endMs });
  return out;
}
