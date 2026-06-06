export type UnitKind = 'player' | 'primary-pet' | 'temp-pet' | 'other';
export type Team = 'friendly' | 'enemy' | 'neutral';

export interface SpellTally { spellName: string; count: number; }

export interface Sample { tSec: number; x: number; y: number; facing?: number; hpPct?: number; inferred?: boolean; }

/** A unit's enriched position time series: observed + inferred samples (sorted by tSec),
 *  plus mobility-cast break times (tSec) where interpolation must not cross a teleport. */
export interface PositionTrack { unitId: string; samples: Sample[]; breaks: number[]; }

/** Result of a position query. `position` is undefined when genuinely unknowable
 *  (mid-teleport, beyond MAX_GAP_SEC of any sample); `lastKnown` always carries up to
 *  the 3 most recent real samples (with timestamps) so inference can decide for itself. */
export interface PositionQuery { position?: Sample; inferred: boolean; lastKnown: Sample[]; }

/** Per-player whole-match spacing summary (derived; raw tracks remain on MatchMetrics). */
export interface SpacingSummary { meleeRangeSec: number; isolatedSec: number; }

/** Escape-anchor state for a window's primary target (e.g. Demon Circle). */
export interface WindowEscape { anchorPlaced: boolean; anchorDistanceYd?: number; escapeAvailable: boolean; }

/** Spatial context of one offensive window, computed for its primary target. All
 *  distances in yards; undefined when positions are unresolvable. */
export interface WindowPositioning {
  primaryTargetId: string;
  threatDistanceStartYd?: number;
  threatDistanceMinYd?: number;
  nearestHealerYd?: number;
  teamSpreadYd?: number;
  escape?: WindowEscape;
}

/** Per-arena occluder grid inferred from occupancy. voidness is row-major, [0,1]
 *  (0 = walkable, 1 = enclosed void / occluder). */
export interface OccluderGrid {
  zoneId: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  cellSize: number; cols: number; rows: number;
  voidness: number[];
  sampleCount: number; coverage: number; isZAxisMap: boolean;
}

export type LosResult = 'clear' | 'likely-blocked' | 'blocked' | 'unknown';
/** `occlusion` is the peak void-ness along the ray, [0,1] (0 = fully clear). */
export interface LosQuery { result: LosResult; occlusion: number; approximate: boolean; }

export type DisruptorKind = 'smoke-bomb' | 'ice-wall' | 'deep-breath';
export interface LosDisruptor {
  kind: DisruptorKind; casterId: string; team: Team;
  pos?: { x: number; y: number }; radius?: number;
  startSec: number; endSec: number; modeled: boolean;
}

/** LoS annotation for one offensive window (its primary target). */
export interface WindowLineOfSight {
  primaryTargetId: string;
  result: LosResult;            // target ↔ nearest attacker at window start
  clearFraction?: number;       // fraction of window with clear LoS
  approximate: boolean;
  disruptorsActive: DisruptorKind[];
}

/** Match-level LoS summary (substrate for the verdict capstone). */
export interface MatchLineOfSight { zoneId: string; resolved: boolean; approximate: boolean; }

/** Fraction of sampled time one player pair spent in each distance band. Fractions are
 *  over `sampledSec` (resolved ticks only) so gaps never inflate a band. */
export interface DistanceBandRow {
  aId: string; bId: string;
  b0_5: number; b5_25: number; b25_40: number; b40plus: number;
  sampledSec: number;
}

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

/**
 * `spellsImmuned` is the SUPERSET: every immuned/blocked ability by spell — CC attempts AND non-CC (e.g. an immuned damage spell).
 * `ccImmuned` (count) and `ccImmunedByCategory` are the CC-only SUBSET of that.
 */
export interface ImmuneSide {
  spellsImmuned: SpellTally[];
  ccImmuned: number;
  ccImmunedByCategory: { category: DrCategory; count: number }[];
}

export type CdCategory = 'offensive' | 'defensive' | 'external' | 'important' | 'trinket';

/** Per-player summary for one tracked cooldown the unit cast. `availableSec` is the
 *  total seconds the CD sat ready across the match — the substrate for later
 *  offensive-throughput ("held without pressing") analysis. */
export interface CdUsageStat {
  spellId: number;
  name: string;
  category: CdCategory;
  casts: number;
  availableSec: number;
}

/** How a mitigation was used in a window — covers proactive damage-reduction (defensive/external/trinket/immunity) and reactive control (cc-control/interrupt). */
export type MitigationCategory = 'defensive' | 'external' | 'trinket' | 'immunity' | 'cc-control' | 'interrupt';

/** An offensive CD active during a window, attributed to the player who pressed it. */
export interface CdRef { spellId: number; spellName: string; unitId: string; startSec: number; endSec: number; }

/** One mitigation ability, attributed per player. In `used`, `usedAtSec` is set;
 *  in `available` it is omitted (the item was ready but not necessarily pressed). */
export interface MitigationItem { unitId: string; category: MitigationCategory; spellId: number; name: string; usedAtSec?: number; }

export interface WindowCounterPlay {
  /** Enemy CC landed on defending players during the window. */
  ccOnDefenders: { unitId: string; name: string; spell: string; sec: number }[];
  /** Names of immunity auras active on a primary threat during the window (e.g. they went while immune). */
  threatImmuneAuras: string[];
}

/** One enemy offensive window ("go"): who opened it, how bad it was, what mitigation
 *  the defending team had available vs used, and the enemy's counter-play. Symmetric:
 *  windows are detected for both teams (attackingTeam = whoever's offensive CDs opened it). */
export interface OffensiveWindow {
  attackingTeam: Team;
  defendingTeam: Team;
  startSec: number;
  endSec: number;
  openedBy: CdRef[];
  teamDamageTaken: number;
  damageByTarget: { unitId: string; name: string; damage: number }[];
  mitigation: { available: MitigationItem[]; used: MitigationItem[] };
  counterPlay: WindowCounterPlay;
  positioning?: WindowPositioning;
  lineOfSight?: WindowLineOfSight;
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
  spacing: SpacingSummary;
  interruptsSuffered: number;
  interruptsSufferedBySpell: SpellTally[];
  precognitionUptimeSec: number;        // union of this unit's own Precognition (377362) buff, seconds
  enemyPrecognitionUptimeSec: number;   // sum of Precognition uptime over opposite-team player units
  deathsWhileCcd: number;
  deathsWhileCcdBySpell: SpellTally[];
  defensivesUsed: number;
  defensivesUsedBySpell: SpellTally[];
  defensivesIntoBurst: number;
  cdUsage: CdUsageStat[];
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
export interface TimelineEvent { tSec: number; unitId: string; unitName: string; kind: TimelineKind; spell?: string; extra?: string; targetId?: string; targetName?: string; }

export interface MatchMetrics { teams: TeamGroup[]; timeline: TimelineEvent[]; playerUnitId?: string; coordination: { team: Team; summary: CoordinationSummary }[]; focusTracks: FocusTracks; offensiveWindows: OffensiveWindow[]; positionTracks: PositionTrack[]; distanceBands: DistanceBandRow[]; lineOfSight: MatchLineOfSight; losDisruptors: LosDisruptor[]; }

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
