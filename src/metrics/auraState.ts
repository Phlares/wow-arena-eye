import { eventType, destId, spellId, spellName, eventTimeMs } from './eventAccess.js';

interface Interval { spellId: number; name: string; start: number; end: number; }
export interface AuraState {
  activeOn(unitId: string, ms: number): { spellId: number; name: string }[];
  intervalsOn(unitId: string): { spellId: number; name: string; start: number; end: number }[];
}

export function buildAuraState(match: unknown): AuraState {
  const m = match as { events?: unknown[] };
  const events = Array.isArray(m.events) ? m.events : [];

  const intervals = new Map<string, Interval[]>();
  const open = new Map<string, Map<number, Interval>>();
  const push = (id: string, iv: Interval) => {
    const arr = intervals.get(id) ?? [];
    arr.push(iv);
    intervals.set(id, arr);
  };

  for (const ev of events) {
    const t = eventType(ev);
    const id = destId(ev);
    const sid = spellId(ev);
    const ms = eventTimeMs(ev);
    if (!id || sid === undefined || ms === undefined) continue;
    if (t === 'SPELL_AURA_APPLIED' || t === 'SPELL_AURA_REFRESH') {
      let u = open.get(id);
      if (!u) { u = new Map(); open.set(id, u); }
      if (!u.has(sid)) u.set(sid, { spellId: sid, name: spellName(ev), start: ms, end: Number.MAX_SAFE_INTEGER });
    } else if (t === 'SPELL_AURA_REMOVED' || t === 'SPELL_AURA_BROKEN' || t === 'SPELL_AURA_BROKEN_SPELL') {
      const iv = open.get(id)?.get(sid);
      if (iv) { iv.end = ms; open.get(id)!.delete(sid); push(id, iv); }
    }
  }
  for (const [id, u] of open) for (const iv of u.values()) push(id, iv);

  return {
    activeOn(unitId, ms) {
      return (intervals.get(unitId) ?? [])
        .filter((iv) => ms >= iv.start && ms < iv.end)
        .map((iv) => ({ spellId: iv.spellId, name: iv.name }));
    },
    intervalsOn(unitId) {
      return (intervals.get(unitId) ?? []).map((iv) => ({ spellId: iv.spellId, name: iv.name, start: iv.start, end: iv.end }));
    },
  };
}
