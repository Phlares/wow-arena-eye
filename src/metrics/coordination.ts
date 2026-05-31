import { eventType, srcId, destId, amount, eventTimeMs } from './eventAccess.js';
import { unitTeam, type Team, type CoordinationSummary } from './types.js';

const FOCUS_WINDOW_MS = 3000;

export function computeCoordination(match: unknown, healerSpecIds: string[]): { team: Team; summary: CoordinationSummary }[] {
  const m = match as { events?: unknown[]; units?: Record<string, { name?: unknown; reaction?: unknown; spec?: unknown }> };
  const events = Array.isArray(m.events) ? m.events : [];
  const units = m.units ?? {};
  const healer = new Set(healerSpecIds);
  const teamOf = (id: string | undefined) => unitTeam((units[id ?? ''] ?? {}).reaction);
  const nameOf = (id: string | undefined) => { const u = units[id ?? '']; return u && typeof u.name === 'string' ? u.name : id ?? '?'; };
  const isHealer = (id: string | undefined) => healer.has(String((units[id ?? ''] ?? {}).spec));

  function countSwaps(dmg: unknown[]): number {
    let swaps = 0; let prev: string | undefined;
    for (const e of [...dmg].sort((a, b) => (eventTimeMs(a) ?? 0) - (eventTimeMs(b) ?? 0))) {
      const d = destId(e);
      if (prev !== undefined && d !== prev) swaps += 1;
      prev = d;
    }
    return swaps;
  }

  function summarize(team: Team): CoordinationSummary {
    const dmg = events.filter((e) => /DAMAGE/.test(eventType(e)) && teamOf(srcId(e)) === team && teamOf(destId(e)) !== team && teamOf(destId(e)) !== 'neutral');
    const byTarget = new Map<string, number>();
    for (const e of dmg) { const d = destId(e); if (d) byTarget.set(d, (byTarget.get(d) ?? 0) + amount(e)); }
    const targetPriority = [...byTarget.entries()].map(([id, damageTaken]) => ({ name: nameOf(id), damageTaken })).sort((a, b) => b.damageTaken - a.damageTaken);
    let focusFireWindows = 0;
    for (const tgt of byTarget.keys()) {
      const hits = dmg.filter((e) => destId(e) === tgt).map((e) => ({ src: srcId(e), ms: eventTimeMs(e) ?? 0 })).sort((a, b) => a.ms - b.ms);
      for (let i = 0; i < hits.length; i++) {
        const attackers = new Set<string>();
        for (let j = i; j < hits.length && hits[j].ms - hits[i].ms <= FOCUS_WINDOW_MS; j++) if (hits[j].src) attackers.add(hits[j].src!);
        if (attackers.size >= 2) { focusFireWindows += 1; break; }
      }
    }
    const healerPressureDamage = dmg.filter((e) => isHealer(destId(e))).reduce<number>((s, e) => s + amount(e), 0);
    return { focusFireWindows, topFocusTarget: targetPriority[0]?.name, targetPriority, healerPressureDamage, swaps: countSwaps(dmg) };
  }

  return (['friendly', 'enemy'] as Team[]).map((team) => ({ team, summary: summarize(team) }));
}
