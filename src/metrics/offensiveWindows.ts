import { type Team, type OffensiveWindow, type CdRef, type UnitMetrics } from './types.js';
import { type AuraState, type Interval } from './auraState.js';
import { cdInfo } from '../metadata/cooldowns.js';
import { matchStartMs } from './eventAccess.js';

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
  const m = match as { events?: unknown[] };
  const players = units.filter((u) => u.kind === 'player');

  const contribs: { iv: Interval; team: Team }[] = [];
  for (const p of players) {
    for (const iv of offensiveContribs(p.unitId, p.spec, auras)) {
      contribs.push({ iv, team: p.team });
    }
  }

  const matchStart = matchStartMs(m.events ?? []) ?? minStart(contribs);

  const merged = mergeWindows(contribs);

  return merged.map((w): OffensiveWindow => {
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
      teamDamageTaken: 0,
      damageByTarget: [],
      mitigation: { available: [], used: [] },
      counterPlay: { ccOnDefenders: [], threatImmuneAuras: [] },
    };
  });
}
