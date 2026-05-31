export type UnitKind = 'player' | 'primary-pet' | 'temp-pet' | 'other';
export type Team = 'friendly' | 'enemy' | 'neutral';

export interface SpellTally { spellName: string; count: number; }

export interface Sample { tSec: number; x: number; y: number; facing?: number; hpPct?: number; }

export type DrCategory = 'stun' | 'incapacitate' | 'disorient' | 'silence' | 'root' | 'knockback' | 'fear' | 'disarm';

export interface CcTakenEntry { category: DrCategory; count: number; durationSec: number; }

export interface CoordinationSummary {
  focusFireWindows: number;
  topFocusTarget?: string;
  targetPriority: { name: string; damageTaken: number }[];
  healerPressureDamage: number;
  swaps: number;
}

export interface UnitMetrics {
  unitId: string;
  name: string;
  kind: UnitKind;
  team: Team;
  spec?: string;
  ownerId?: string;
  casts: number;
  topCasts: SpellTally[];
  interruptsLanded: number;
  interruptsLandedBySpell: SpellTally[];
  dispels: number;
  purges: number;
  purgesBySpell: SpellTally[];
  cleanses: number;
  cleansesBySpell: SpellTally[];
  spellsteals: number;
  spellstealsBySpell: SpellTally[];
  deaths: number;
  deathTimesSec: number[];
  distanceMoved: number;
  positionSamples: number;
  timeStationarySec: number;
  track: Sample[];
  interruptsSuffered: number;
  interruptsSufferedBySpell: SpellTally[];
  ccTaken: number;
  ccTakenByCategory: CcTakenEntry[];
  deathsWhileCcd: number;
  deathsWhileCcdBySpell: SpellTally[];
  defensivesUsed: number;
  defensivesUsedBySpell: SpellTally[];
  defensivesIntoBurst: number;
  damageDone: number;
  healingDone: number;
  absorbDone: number;
  dps: number;
  hps: number;
}

/** Combined player+pet totals. Intentionally carries only interruptsLandedBySpell;
 *  other by-spell breakdowns (purges/cleanses/steals) are shown per-unit, not combined. */
export interface CombinedTotals {
  casts: number;
  interruptsLanded: number;
  interruptsLandedBySpell: SpellTally[];
  dispels: number;
  purges: number;
  cleanses: number;
  spellsteals: number;
  deaths: number;
  damageDone: number;
  healingDone: number;
}

export interface PlayerGroup { player: UnitMetrics; pets: UnitMetrics[]; combined: CombinedTotals; }
export interface TeamGroup { team: Team; players: PlayerGroup[]; unownedPets: UnitMetrics[]; }

export type TimelineKind = 'cast' | 'interrupt' | 'dispel' | 'steal' | 'death';
export interface TimelineEvent { tSec: number; unitId: string; unitName: string; kind: TimelineKind; spell?: string; extra?: string; }

export interface MatchMetrics { teams: TeamGroup[]; timeline: TimelineEvent[]; playerUnitId?: string; coordination: { team: Team; summary: CoordinationSummary }[]; }

export function tally(names: string[]): SpellTally[] {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].map(([spellName, count]) => ({ spellName, count })).sort((a, b) => b.count - a.count);
}

/** Merge several SpellTally[] into one, summing counts by spell, sorted desc. */
export function mergeTallies(lists: SpellTally[][]): SpellTally[] {
  const counts = new Map<string, number>();
  for (const list of lists) for (const s of list) counts.set(s.spellName, (counts.get(s.spellName) ?? 0) + s.count);
  return [...counts.entries()].map(([spellName, count]) => ({ spellName, count })).sort((a, b) => b.count - a.count);
}

export function unitKind(type: unknown): UnitKind {
  return type === 1 || type === '1' ? 'player' : type === 3 || type === '3' ? 'primary-pet' : type === 4 || type === '4' ? 'temp-pet' : 'other';
}

export function unitTeam(reaction: unknown): Team {
  const r = String(reaction);
  return r === '1' || r === 'Friendly' ? 'friendly' : r === '2' || r === 'Hostile' ? 'enemy' : 'neutral';
}
