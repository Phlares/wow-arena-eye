import { eventType, srcId, destId, spellName, amount, eventTimeMs, matchStartMs, DAMAGE_EVENTS } from './eventAccess.js';
import { round1 } from './spacing.js';
import type { DeathBlow } from './types.js';

/** How far back before a death to attribute the killing damage. */
const WINDOW_MS = 5000;
/** Cap on hits listed per death (keep the most recent). */
const MAX_HITS = 12;

/** Per-death preceding-damage: for each UNIT_DIED, the damage events landed on the victim in
 *  the WINDOW_MS before death (time-ordered, capped). Substrate for the death-hover "what killed
 *  me" view. `nameOf` resolves an attacker GUID to a display name. */
export function computeDeathBlows(match: unknown, nameOf: (id: string) => string): DeathBlow[] {
  const m = match as { events?: unknown[] };
  const events = Array.isArray(m.events) ? m.events : [];
  const start = matchStartMs(events) ?? 0;
  const dmg: { dest: string; srcName: string; spell: string; amount: number; ms: number }[] = [];
  const deaths: { victim: string; ms: number }[] = [];
  for (const ev of events) {
    const ms = eventTimeMs(ev);
    if (ms === undefined) continue;
    const t = eventType(ev);
    if (DAMAGE_EVENTS.test(t)) {
      const d = destId(ev);
      if (d) dmg.push({ dest: d, srcName: nameOf(srcId(ev) ?? '?'), spell: spellName(ev), amount: amount(ev), ms });
    } else if (t === 'UNIT_DIED') {
      const v = destId(ev);
      if (v) deaths.push({ victim: v, ms });
    }
  }
  return deaths.map((d) => ({
    victimId: d.victim,
    tSec: round1((d.ms - start) / 1000),
    recent: dmg
      .filter((h) => h.dest === d.victim && h.ms <= d.ms && h.ms >= d.ms - WINDOW_MS)
      .sort((a, b) => a.ms - b.ms)
      .slice(-MAX_HITS)
      .map((h) => ({ srcName: h.srcName, spell: h.spell, amount: Math.round(h.amount), tSec: round1((h.ms - start) / 1000) })),
  }));
}
