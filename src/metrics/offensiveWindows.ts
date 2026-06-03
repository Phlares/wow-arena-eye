import { type Team, type OffensiveWindow, type CdRef, type UnitMetrics, type MitigationItem, type MitigationCategory, unitTeam } from './types.js';
import { type AuraState, type Interval } from './auraState.js';
import { cdsForSpec, isOffensiveCd, type CdEntry } from '../metadata/cooldowns.js';
import { ccInfo, isInterrupt, isImmunity } from '../metadata/spells.js';
import { isAvailable, type CastEvent } from './cooldownTimeline.js';
import { matchStartMs, eventType, srcId, destId, eventTimeMs, amount, DAMAGE_EVENTS } from './eventAccess.js';

const OTHER: Record<Team, Team> = { friendly: 'enemy', enemy: 'friendly', neutral: 'neutral' };

const AVAILABLE_CATS = new Set<MitigationCategory>(['defensive', 'external', 'trinket', 'immunity']);

interface WindowAcc { dmgTotal: number; dmgByTarget: Map<string, number>; }

/** Offensive-CD active intervals cast by `unitId`. */
function offensiveContribs(unitId: string, auras: AuraState): Interval[] {
  return auras.intervalsBy(unitId).filter((iv) => isOffensiveCd(iv.spellId));
}

/** Merge overlapping intervals into windows per team, keeping all contributors.
 *  Intervals are partitioned by team first, then sorted by start within each team
 *  and greedily merged. This prevents cross-team interleaving from breaking same-team
 *  merges (e.g. E1[0,10], F1[5,15], E2[8,20] must yield one enemy window [0,20]).
 */
function mergeWindows(contribs: { iv: Interval; team: Team }[]): { team: Team; start: number; end: number; ivs: Interval[] }[] {
  const byTeam = new Map<Team, Interval[]>();
  for (const { iv, team } of contribs) {
    const arr = byTeam.get(team) ?? [];
    arr.push(iv);
    byTeam.set(team, arr);
  }
  const out: { team: Team; start: number; end: number; ivs: Interval[] }[] = [];
  for (const [team, ivs] of byTeam) {
    const sorted = [...ivs].sort((a, b) => a.start - b.start);
    for (const iv of sorted) {
      const last = out[out.length - 1];
      if (last && last.team === team && iv.start <= last.end) {
        last.end = Math.max(last.end, iv.end);
        last.ivs.push(iv);
      } else {
        out.push({ team, start: iv.start, end: iv.end, ivs: [iv] });
      }
    }
  }
  return out;
}

function minStart(cs: { iv: Interval }[]): number {
  return cs.reduce((mn, c) => Math.min(mn, c.iv.start), Number.MAX_SAFE_INTEGER);
}

export function computeOffensiveWindows(match: unknown, units: UnitMetrics[], auras: AuraState, casts: Map<string, CastEvent[]>): OffensiveWindow[] {
  const m = match as { units?: Record<string, Record<string, unknown>>; events?: unknown[] };
  const rawUnits = m.units ?? {};
  const nameOf = (id: string): string => { const u = rawUnits[id]; return u && typeof u.name === 'string' && u.name.length > 0 ? u.name : id; };
  const players = units.filter((u) => u.kind === 'player');

  const contribs: { iv: Interval; team: Team }[] = [];
  for (const p of players) {
    for (const iv of offensiveContribs(p.unitId, auras)) {
      contribs.push({ iv, team: p.team });
    }
  }

  const events = Array.isArray(m.events) ? m.events : [];
  const matchStart = matchStartMs(events) ?? minStart(contribs);

  // Bound windows to the match. An offensive buff applied but never closed (no AURA_REMOVED
  // before the log ends) leaves an unbounded interval end; without clamping, a window could
  // extend to a garbage far-future timestamp (endSec in the trillions). Clamp interval ends to
  // the later of the last event and the reported duration. Copy intervals (don't mutate auraState).
  const durationSec = typeof (m as { durationInSeconds?: unknown }).durationInSeconds === 'number'
    ? (m as { durationInSeconds: number }).durationInSeconds
    : undefined;
  const lastEventMs = events.reduce<number>((mx, ev) => {
    const t = eventTimeMs(ev);
    return t !== undefined && t > mx ? t : mx;
  }, matchStart);
  const matchEnd = Math.max(lastEventMs, durationSec !== undefined ? matchStart + durationSec * 1000 : matchStart);
  // Only clamp when we actually have a match end past the start (real logs always do; some
  // synthetic fixtures with a single t=0 event and no duration do not — leave those untouched).
  const clamped = matchEnd > matchStart
    ? contribs.map(({ iv, team }) => ({ iv: { ...iv, end: Math.min(iv.end, matchEnd) }, team }))
    : contribs;

  const merged = mergeWindows(clamped);

  // Build a per-unit, per-spell cast-time index once, to avoid re-scanning in the available loop.
  const castMsByUnitSpell = new Map<string, Map<number, number[]>>();
  for (const p of players) {
    const bySpell = new Map<number, number[]>();
    for (const c of casts.get(p.unitId) ?? []) {
      const arr = bySpell.get(c.spellId) ?? [];
      arr.push(c.ms);
      bySpell.set(c.spellId, arr);
    }
    castMsByUnitSpell.set(p.unitId, bySpell);
  }

  const teamOf = (id: string | undefined): Team => unitTeam((rawUnits[id ?? ''] ?? {}).reaction);
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

  // Per-spec CD inventory memo (avoid rebuilding cdsForSpec per defender per window).
  const specCdMemo = new Map<string, Map<number, CdEntry>>();
  const cdsBySpec = (spec: string | undefined): Map<number, CdEntry> => {
    const key = spec ?? '';
    let m2 = specCdMemo.get(key);
    if (!m2) { m2 = new Map(cdsForSpec(spec).map((e) => [e.spellId, e])); specCdMemo.set(key, m2); }
    return m2;
  };
  // Spell-name lookup from every observed cast (for naming available CDs that may be uncast).
  const nameBySpellId = new Map<number, string>();
  for (const list of casts.values()) for (const c of list) if (!nameBySpellId.has(c.spellId)) nameBySpellId.set(c.spellId, c.name);
  const cdName = (sid: number): string => nameBySpellId.get(sid) ?? String(sid);

  /** Extends CdEntry.category with spell-tag-derived categories (immunity/interrupt/cc-control) not tracked in the cooldown registry. */
  const mitigationCategoryOf = (spellId: number, spec: string | undefined): MitigationCategory | undefined => {
    const cd = cdsBySpec(spec).get(spellId);
    if (cd && (cd.category === 'defensive' || cd.category === 'external' || cd.category === 'trinket')) return cd.category;
    if (isImmunity(spellId)) return 'immunity';
    if (isInterrupt(spellId)) return 'interrupt';
    if (ccInfo(spellId)) return 'cc-control';
    return undefined;
  };

  return merged.map((w, i): OffensiveWindow => {
    const acc = accs[i];
    const openedBy: CdRef[] = w.ivs.map((iv) => ({
      spellId: iv.spellId,
      spellName: iv.name,
      unitId: iv.srcId,
      startSec: Math.round((iv.start - matchStart) / 1000),
      endSec: Math.round((iv.end - matchStart) / 1000),
    }));

    const defenders = players.filter((p) => p.team === OTHER[w.team]);

    // available: each defender's mitigation CDs that are ready at window start
    const available: MitigationItem[] = [];
    for (const def of defenders) {
      for (const cd of cdsBySpec(def.spec).values()) {
        const cat = mitigationCategoryOf(cd.spellId, def.spec);
        if (!cat || !AVAILABLE_CATS.has(cat)) continue;
        const msList = castMsByUnitSpell.get(def.unitId)?.get(cd.spellId) ?? [];
        if (isAvailable(msList, cd.cooldownMs, cd.charges, w.start)) {
          available.push({ unitId: def.unitId, category: cat, spellId: cd.spellId, name: cdName(cd.spellId) });
        }
      }
    }

    // used: defender casts within [start - 1s, end] resolvable to a mitigation category
    const used: MitigationItem[] = [];
    for (const def of defenders) {
      for (const c of casts.get(def.unitId) ?? []) {
        if (c.ms < w.start - 1000 || c.ms >= w.end) continue;
        const cat = mitigationCategoryOf(c.spellId, def.spec);
        if (!cat) continue;
        used.push({ unitId: def.unitId, category: cat, spellId: c.spellId, name: c.name, usedAtSec: Math.round((c.ms - matchStart) / 1000) });
      }
    }

    // counter-play: enemy CC landed on defenders during the window
    const ccOnDefenders: { unitId: string; name: string; spell: string; sec: number }[] = [];
    for (const def of defenders) {
      for (const iv of auras.intervalsOn(def.unitId)) {
        if (!ccInfo(iv.spellId)) continue;
        if (teamOf(iv.srcId) !== w.team) continue;             // CC cast by the attacking team
        if (iv.end <= w.start || iv.start >= w.end) continue;   // overlaps the window
        ccOnDefenders.push({ unitId: def.unitId, name: nameOf(def.unitId), spell: iv.name, sec: Math.round((Math.max(iv.start, w.start) - matchStart) / 1000) });
      }
    }

    // counter-play: immunity auras on a primary threat (an opener's caster) during the window
    const threatIds = new Set(w.ivs.map((iv) => iv.srcId));
    const threatImmuneSeen = new Set<string>();
    for (const tid of threatIds)
      for (const iv of auras.intervalsOn(tid))
        if (isImmunity(iv.spellId) && iv.start < w.end && iv.end > w.start) threatImmuneSeen.add(iv.name);
    const threatImmuneAuras = [...threatImmuneSeen];

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
      mitigation: { available, used },
      counterPlay: { ccOnDefenders, threatImmuneAuras },
    };
  });
}

