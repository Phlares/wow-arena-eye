import type { Session } from '../store/sessions.js';

export interface MatchSummary {
  matchId: string;
  startMs: number | null;
  durationSec: number | null;
  bracket: string;
  character: string;
  mapId: string;
  mapName: string;
  allyComp: string;
  allyCompLabel: string;
  enemyComp: string;
  enemyCompLabel: string;
  rating: number | null; // MMR (DB player_rating) — see cr for the player's true rating
  ratingDelta: number | null; // MMR delta vs the previous game for this character+bracket (enrichRatingDeltas)
  cr: number | null;          // true rating (personalRating)
  crDelta: number | null;
  buildVersion: string;
  result: string;
  sessionId: string | null;
  damageDone: number | null;
  dps: number | null;
  interruptsLanded: number | null;
  interruptsSuffered: number | null;
  precognitionUptimeSec: number | null;
  enemyPrecognitionUptimeSec: number | null;
}

export type SessionSummary = Session;

export interface RangePoint { tSec: number; dist: number | null; }
export interface RosterEntry { name: string; className: string; specLabel: string; team: string; isHealer: boolean; }
export interface GoTrack { unitId: string; name: string; team: string; className: string; intervals: { startSec: number; endSec: number }[]; }
/** A reassignable range-lane target: the recording player's distance series to this player. */
export interface RangeTarget { unitId: string; name: string; className: string; team: string; isHealer: boolean; isPrimaryThreat: boolean; series: RangePoint[]; }

export interface FilterOptions {
  characters: string[];
  brackets: string[];
  classSpecTree: { className: string; specs: { id: string; specName: string }[] }[];
  maps: { value: string; label: string }[];
  ratingRange: { min: number; max: number } | null;
  dateRange: { minMs: number; maxMs: number } | null;
}

export interface MatchQuery {
  id?: string;            // exact match_id (internal — single-match fetch)
  character?: string;
  bracket?: string;
  allySpecs?: string;    // comma-separated spec ids
  allyClasses?: string;  // comma-separated class names
  enemySpecs?: string;
  enemyClasses?: string;
  map?: string;
  result?: string;
  minRating?: number;
  maxRating?: number;
  from?: number;
  to?: number;
  q?: string;
  sort?: 'startMs' | 'rating' | 'damageDone' | 'dps';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
