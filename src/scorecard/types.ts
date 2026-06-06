/** One past match for the recording character, with its per-player scalar metrics pivoted. */
export interface PlayerMatch {
  matchId: string;
  startMs: number | null;
  bracket: string;
  zoneId: string;
  allyComp: string;
  enemyComp: string;
  rating: number | null;
  result: string;            // 'win' | 'loss' | 'unknown'
  character: string;         // player_name (e.g. 'Phlares-Stormrage-US')
  metrics: Record<string, number>;
}

export type Verdict = 'better' | 'worse' | 'average' | 'insufficient' | 'descriptive';
export type WinLikeness = 'win-like' | 'loss-like' | 'neutral';
export type Polarity = 'higher-better' | 'lower-better' | 'neutral';

/** A ranked season: a match belongs to the latest season whose startMs is ≤ its start. */
export interface Season { name: string; startMs: number; }

/** Active baseline narrowing. Bracket is always matched and is not part of Scope. */
export interface Scope {
  map?: boolean;             // same zone_id as target
  comp?: boolean;            // same enemy_comp_sig as target
  ratingBand?: number;       // within ± this of target rating
  timeOfDayHours?: number;   // within ± this many hours of target's local hour
  season?: boolean;          // only target's current season
}

export interface MetricScore {
  id: string;
  label: string;
  polarity: Polarity;
  value: number | null;      // target's value (null if absent on the match)
  mean: number;
  stdev: number;
  n: number;                 // cohort size used for mean/stdev
  z: number | null;
  verdict: Verdict;
  seasonBest: number | null; // best prior value this season (per polarity), null if none
  isNewBest: boolean;
  winLikeness: WinLikeness;
}

export interface Scorecard {
  matchId: string;
  character: string;
  bracket: string;
  zoneId: string;
  enemyComp: string;
  rating: number | null;
  result: string;
  startMs: number | null;
  season: string | null;
  cohort: { description: string; n: number; wins: number; losses: number };
  metrics: MetricScore[];
}
