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
  rating: number | null;
  ratingDelta: number | null; // vs the previous match for this character in the result set
  result: string;
  sessionId: string | null;
  damageDone: number | null;
  dps: number | null;
  interruptsLanded: number | null;
}

export type SessionSummary = Session;

export interface FilterOptions {
  characters: string[];
  brackets: string[];
  myComps: { value: string; label: string }[];
  enemyComps: { value: string; label: string }[];
  maps: { value: string; label: string }[];
  ratingRange: { min: number; max: number } | null;
  dateRange: { minMs: number; maxMs: number } | null;
}

export interface MatchQuery {
  id?: string;            // exact match_id (internal — single-match fetch)
  character?: string;
  bracket?: string;
  myComp?: string;
  enemyComp?: string;
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
