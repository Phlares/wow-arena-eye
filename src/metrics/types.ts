export type UnitKind = 'player' | 'primary-pet' | 'temp-pet' | 'other';
export type Team = 'friendly' | 'enemy' | 'neutral';

export interface SpellTally { spellName: string; count: number; }

export interface Sample { tSec: number; x: number; y: number; facing?: number; hpPct?: number; }

export type DrCategory = 'stun' | 'incapacitate' | 'disorient' | 'silence' | 'root' | 'disarm' | 'taunt' | 'knockback';

export interface CcCategoryStat { category: DrCategory; count: number; durationSec: number; }

export interface CcSide {
  timeSec: number;
  castDenialSec: number;
  hardCcSec: number;
  rootSec: number;
  count: number;
  byCategory: CcCategoryStat[];
}

export interface ImmuneSide {
  spellsImmuned: SpellTally[];
  ccImmuned: number;
  ccImmunedByCategory: { category: DrCategory; count: number }[];
}

export interface FocusSegment { target: string; targetName: string; fromSec: number; toSec: number; }

export interface AttackerTrack {
  attacker: string;        // owning player's unitId
  attackerName: string;
  team: Team;
  ticks: (string | null)[]; // smoothed dominant-target unitId per tick (null = not engaged)
  segments: FocusSegment[]; // run-length encoding of `ticks` (the retained track)
}

export interface FocusTracks { stepMs: number; tickCount: number; startMs: number; tracks: AttackerTrack[]; }

export interface AttackerFocus {
  attacker: string;
  attackerName: string;
  swaps: number;
  topTarget?: string;
  topTargetSec: number;
  engagedSec: number;
}

export interface CoordinationSummary {
  targetPriority: { name: string; damageTaken: number }[];
  topFocusTarget?: string;
  healerPressureDamage: number;
  swaps: number;                  // debounced dominant-target re-aligns (team sum)
  attackerFocus: AttackerFocus[];
  alignmentFraction: number;      // 0..1
  alignedTimeSec: number;
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
  deathsWhileCcd: number;
  deathsWhileCcdBySpell: SpellTally[];
  defensivesUsed: number;
  defensivesUsedBySpell: SpellTally[];
  defensivesIntoBurst: number;
  ccReceived: CcSide;
  ccDone: CcSide;
  immuneReceived: ImmuneSide;
  immuneDone: ImmuneSide;
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

export interface MatchMetrics { teams: TeamGroup[]; timeline: TimelineEvent[]; playerUnitId?: string; coordination: { team: Team; summary: CoordinationSummary }[]; focusTracks: FocusTracks; }

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

const OWNER_SENTINELS = new Set(['0', '0000000000000000']);

/** Sanitized owner unit id from a raw units-map entry, or undefined if absent / a no-owner sentinel. */
export function ownerIdOf(unit: { ownerId?: unknown } | undefined): string | undefined {
  const raw = unit && typeof unit.ownerId === 'string' ? unit.ownerId : undefined;
  return raw && !OWNER_SENTINELS.has(raw) ? raw : undefined;
}

/** The owning PLAYER unitId for a source: the unit itself if it's a player, else its
 *  owner if that owner is a player, else undefined (pet→owner; NPC/totem→undefined). */
export function resolvePlayer(units: Record<string, { type?: unknown; ownerId?: unknown }>, id: string | undefined): string | undefined {
  const u = id ? units[id] : undefined;
  if (!u) return undefined;
  const owner = ownerIdOf(u);
  if (owner) { const ou = units[owner]; return ou && unitKind(ou.type) === 'player' ? owner : undefined; }
  return unitKind(u.type) === 'player' ? id : undefined;
}
