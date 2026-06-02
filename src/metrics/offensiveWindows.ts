import { type Team, type OffensiveWindow, type CdRef, type UnitMetrics, unitTeam } from './types.js';
import { type AuraState, type Interval } from './auraState.js';
import { cdInfo } from '../metadata/cooldowns.js';
import { matchStartMs, eventType, srcId, destId, eventTimeMs, amount, DAMAGE_EVENTS } from './eventAccess.js';

const OTHER: Record<Team, Team> = { friendly: 'enemy', enemy: 'friendly', neutral: 'neutral' };

/** Offensive-CD active intervals cast by `unitId`, resolved against that unit's spec. */
function offensiveContribs(unitId: string, specId: string | undefined, auras: AuraState): Interval[] {
  return auras.intervalsBy(unitId).filter((iv) => cdInfo(iv.spellId, specId)?.category === 'offensive');
}

/** Merge overlapping intervals (sorted by start) into windows, keeping all contributors. */
function mergeWindows(contribs: { iv: Interval; team: Team }[]): { team: Team; start: number; end: number; ivs: Interval[] }[] {
  const sorted = [...contribs].sort((a, b) => a.iv.start - b.iv.start);
  const out: { team: Team; start: number; end: number; ivs: Interval[] }[] = [];
  // Intervals from both teams are sorted together by start time; the `last.team === team` guard prevents cross-team merges, so output windows may interleave teams in chronological order.
  for (const { iv, team } of sorted) {
    const last = out[out.length - 1];
    if (last && last.team === team && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
      last.ivs.push(iv);
    } else {
      out.push({ team, start: iv.start, end: iv.end, ivs: [iv] });
    }
  }
  return out;
}

function minStart(cs: { iv: Interval }[]): number {
  return cs.reduce((mn, c) => Math.min(mn, c.iv.start), Number.MAX_SAFE_INTEGER);
}

export function computeOffensiveWindows(match: unknown, units: UnitMetrics[], auras: AuraState, _casts?: unknown): OffensiveWindow[] {
  const m = match as { units?: Record<string, Record<string, unknown>>; events?: unknown[] };
  const rawUnits = m.units ?? {};
  const nameOf = (id: string): string => { const u = rawUnits[id]; return u && typeof u.name === 'string' && u.name.length > 0 ? u.name : id; };
  const players = units.filter((u) => u.kind === 'player');

  const contribs: { iv: Interval; team: Team }[] = [];
  for (const p of players) {
    for (const iv of offensiveContribs(p.unitId, p.spec, auras)) {
      contribs.push({ iv, team: p.team });
    }
  }

  const matchStart = matchStartMs(m.events ?? []) ?? minStart(contribs);

  const merged = mergeWindows(contribs);

  const teamOf = (id: string | undefined): Team => unitTeam((rawUnits[id ?? ''] ?? {}).reaction);
  const events = Array.isArray(m.events) ? m.events : [];
  interface WindowAcc { dmgTotal: number; dmgByTarget: Map<string, number>; }
  const accs: WindowAcc[] = merged.map(() => ({ dmgTotal: 0, dmgByTarget: new Map<string, number>() }));
  for (const ev of events) {
    const t = eventType(ev);
    if (!DAMAGE_EVENTS.test(t)) continue;
    const ms = eventTimeMs(ev);
    if (ms === undefined) continue;
    const s = srcId(ev), d = destId(ev);
    const amt = amount(ev);
    if (amt <= 0 || !s || !d) continue;
    for (let i = 0; i < merged.length; i++) {
      const w = merged[i];
      if (ms < w.start || ms >= w.end) continue;
      if (teamOf(s) !== w.team || teamOf(d) !== OTHER[w.team]) continue;
      accs[i].dmgTotal += amt;
      accs[i].dmgByTarget.set(d, (accs[i].dmgByTarget.get(d) ?? 0) + amt);
    }
  }

  return merged.map((w, i): OffensiveWindow => {
    const acc = accs[i];
    const openedBy: CdRef[] = w.ivs.map((iv) => ({
      spellId: iv.spellId,
      spellName: iv.name,
      unitId: iv.srcId,
      startSec: Math.round((iv.start - matchStart) / 1000),
      endSec: Math.round((iv.end - matchStart) / 1000),
    }));
    return {
      attackingTeam: w.team,
      defendingTeam: OTHER[w.team],
      startSec: Math.round((w.start - matchStart) / 1000),
      endSec: Math.round((w.end - matchStart) / 1000),
      openedBy,
      teamDamageTaken: Math.round(acc.dmgTotal),
      damageByTarget: [...acc.dmgByTarget.entries()]
        .map(([unitId, damage]) => ({ unitId, name: nameOf(unitId), damage: Math.round(damage) }))
        .sort((a, b) => b.damage - a.damage),
      mitigation: { available: [], used: [] },
      counterPlay: { ccOnDefenders: [], threatImmuneAuras: [] },
    };
  });
}
