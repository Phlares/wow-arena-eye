import { eventType, srcId, destId, spellId, spellName, eventTimeMs } from './eventAccess.js';

export interface Interval { srcId: string; destId: string; spellId: number; name: string; start: number; end: number; }
export interface AuraState {
  activeOn(unitId: string, ms: number): { spellId: number; name: string }[];
  intervalsOn(unitId: string): Interval[];   // auras ON this unit (by dest)
  intervalsBy(unitId: string): Interval[];    // auras CAST BY this unit (by src)
}

export function buildAuraState(match: unknown): AuraState {
  const m = match as { events?: unknown[] };
  const events = Array.isArray(m.events) ? m.events : [];

  const byDest = new Map<string, Interval[]>();
  const bySrc = new Map<string, Interval[]>();
  const open = new Map<string, Map<number, Interval>>(); // keyed by destId then spellId
  const push = (map: Map<string, Interval[]>, key: string, iv: Interval) => {
    const arr = map.get(key) ?? [];
    arr.push(iv);
    map.set(key, arr);
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
      if (!u.has(sid)) u.set(sid, { srcId: srcId(ev) ?? '', destId: id, spellId: sid, name: spellName(ev), start: ms, end: Number.MAX_SAFE_INTEGER });
    } else if (t === 'SPELL_AURA_REMOVED' || t === 'SPELL_AURA_BROKEN' || t === 'SPELL_AURA_BROKEN_SPELL') {
      const iv = open.get(id)?.get(sid);
      if (iv) { iv.end = ms; open.get(id)!.delete(sid); push(byDest, id, iv); push(bySrc, iv.srcId, iv); }
    }
  }
  for (const [, u] of open) for (const iv of u.values()) { push(byDest, iv.destId, iv); push(bySrc, iv.srcId, iv); }

  const copy = (ivs: Interval[]): Interval[] => ivs.map((iv) => ({ ...iv }));
  return {
    activeOn(unitId, ms) {
      return (byDest.get(unitId) ?? []).filter((iv) => ms >= iv.start && ms < iv.end).map((iv) => ({ spellId: iv.spellId, name: iv.name }));
    },
    intervalsOn(unitId) { return copy(byDest.get(unitId) ?? []); },
    intervalsBy(unitId) { return copy(bySrc.get(unitId) ?? []); },
  };
}
