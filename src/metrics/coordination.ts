import { eventType, srcId, destId, amount, eventTimeMs } from './eventAccess.js';
import { unitTeam, type Team, type CoordinationSummary } from './types.js';

const FOCUS_WINDOW_MS = 3000;
const DAMAGE_EVENTS = /^(SPELL_DAMAGE|SPELL_PERIODIC_DAMAGE|RANGE_DAMAGE|SWING_DAMAGE|SWING_DAMAGE_LANDED)$/;

export function computeCoordination(match: unknown, healerSpecIds: string[]): { team: Team; summary: CoordinationSummary }[] {
  const m = match as { events?: unknown[]; units?: Record<string, { name?: unknown; reaction?: unknown; spec?: unknown }> };
  const events = Array.isArray(m.events) ? m.events : [];
  const units = m.units ?? {};
  const healer = new Set(healerSpecIds);
  const teamOf = (id: string | undefined) => unitTeam((units[id ?? ''] ?? {}).reaction);
  const nameOf = (id: string | undefined) => { const u = units[id ?? '']; return u && typeof u.name === 'string' ? u.name : id ?? '?'; };
  const isHealer = (id: string | undefined) => healer.has(String((units[id ?? ''] ?? {}).spec));

  function summarize(team: Team): CoordinationSummary {
    const dmg = events.filter((e) => DAMAGE_EVENTS.test(eventType(e)) && teamOf(srcId(e)) === team && teamOf(destId(e)) !== team);
    const byTarget = new Map<string, { total: number; hits: { src: string | undefined; ms: number }[] }>();
    for (const e of dmg) {
      const d = destId(e);
      if (!d) continue;
      let entry = byTarget.get(d);
      if (!entry) { entry = { total: 0, hits: [] }; byTarget.set(d, entry); }
      entry.total += amount(e);
      entry.hits.push({ src: srcId(e), ms: eventTimeMs(e) ?? 0 });
    }
    const targetPriority = [...byTarget.entries()].map(([id, v]) => ({ name: nameOf(id), damageTaken: v.total })).sort((a, b) => b.damageTaken - a.damageTaken);
    let focusFireWindows = 0;
    for (const { hits } of byTarget.values()) {
      hits.sort((a, b) => a.ms - b.ms);
      let lo = 0;
      const window = new Map<string, number>();
      for (let hi = 0; hi < hits.length; hi++) {
        const src = hits[hi].src ?? '';
        window.set(src, (window.get(src) ?? 0) + 1);
        while (hits[hi].ms - hits[lo].ms > FOCUS_WINDOW_MS) {
          const ls = hits[lo].src ?? '';
          const c = (window.get(ls) ?? 0) - 1;
          if (c <= 0) window.delete(ls); else window.set(ls, c);
          lo++;
        }
        if (window.size >= 2) { focusFireWindows += 1; lo = hi + 1; window.clear(); }
      }
    }
    const healerPressureDamage = dmg.filter((e) => isHealer(destId(e))).reduce<number>((s, e) => s + amount(e), 0);
    // swaps: deliberate target changes on DIRECT casts only (exclude DoT ticks / swing noise), per attacker
    const directSorted = dmg
      .filter((e) => { const t = eventType(e); return t === 'SPELL_DAMAGE' || t === 'RANGE_DAMAGE'; })
      .sort((a, b) => (eventTimeMs(a) ?? 0) - (eventTimeMs(b) ?? 0));
    const lastTarget = new Map<string, string>();
    let swaps = 0;
    for (const e of directSorted) {
      const s = srcId(e); const d = destId(e);
      if (!s || !d) continue;
      const prev = lastTarget.get(s);
      if (prev !== undefined && prev !== d) swaps += 1;
      lastTarget.set(s, d);
    }
    return { focusFireWindows, topFocusTarget: targetPriority[0]?.name, targetPriority, healerPressureDamage, swaps };
  }

  return (['friendly', 'enemy'] as Team[]).map((team) => ({ team, summary: summarize(team) }));
}
