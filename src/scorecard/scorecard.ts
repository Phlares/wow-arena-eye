import type { MetricScore, PlayerMatch, Polarity, Scope, Scorecard, Season, Verdict, WinLikeness } from './types.js';
import { filterCohort, seasonOf, stats } from './cohort.js';

export const MIN_COHORT = 5;
const Z_AVG_BAND = 0.5;

/** Defaults for the optional numeric scope flags when a flag is given without a value. */
export const DEFAULT_RATING_BAND = 150;
export const DEFAULT_TIME_OF_DAY_HOURS = 2;

/** Curated, polarity-aware indicators. ids are a subset of the store's metric table
 *  (metricRows.ts UNIT_METRICS). Polarity is tuned for a ranged caster (Affliction). */
// `rate: true` = the metric accumulates over match time, so it's verdicted on its per-minute rate
// (value*60/durationSec), not the raw total — otherwise long matches always beat short ones. The
// rate-normalized damage row makes the old per-second `dps` entry redundant, so `dps` was dropped.
export const SCORECARD_METRICS: { id: string; label: string; polarity: Polarity; rate?: true }[] = [
  { id: 'damageDone', label: 'Damage done', polarity: 'higher-better', rate: true },
  // deaths are discrete events, not a duration — rate-normalizing them would mislead (a 0-death win
  // shouldn't read "twice as good" just because the match was short), so they stay raw counts.
  { id: 'deaths', label: 'Deaths', polarity: 'lower-better' },
  { id: 'deathsWhileCcd', label: "Deaths while CC'd", polarity: 'lower-better' },
  { id: 'interruptsLanded', label: 'Kicks landed', polarity: 'higher-better', rate: true },
  { id: 'interruptsSuffered', label: 'Own casts kicked', polarity: 'lower-better', rate: true },
  { id: 'ccDone.hardCcSec', label: 'Hard CC done (s)', polarity: 'higher-better', rate: true },
  { id: 'ccReceived.hardCcSec', label: 'Hard CC taken (s)', polarity: 'lower-better', rate: true },
  { id: 'ccReceived.timeSec', label: 'Total CC taken (s)', polarity: 'lower-better', rate: true },
  { id: 'defensivesIntoBurst', label: 'Defensives into burst', polarity: 'higher-better' },
  { id: 'spacing.isolatedSec', label: 'Time isolated (s)', polarity: 'lower-better', rate: true },
  { id: 'spacing.meleeRangeSec', label: 'Time in melee (s)', polarity: 'lower-better', rate: true },
  // Reactive PvP-talent uptime — reported for context, not graded (see 'neutral' polarity).
  { id: 'precognitionUptimeSec', label: 'Precognition uptime (s)', polarity: 'neutral', rate: true },
  { id: 'enemyPrecognitionUptimeSec', label: 'Enemy Precognition (s)', polarity: 'neutral', rate: true },
  // Already an average over the match (not accumulative) → descriptive, not rate-normalized.
  { id: 'avgHealerDistanceYd', label: 'Avg dist from healer (yd)', polarity: 'neutral' },
];

export interface BuildOpts { scope: Scope; seasons: Season[]; minCohort?: number; gapMs?: number; }

function num(m: PlayerMatch, id: string): number | undefined {
  const v = m.metrics[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** A metric's value for one match: per-minute (value*60/durationSec) when `rate`, else the raw
 *  value. undefined when absent, or (for rate) when the match has no usable duration. */
function valueOf(m: PlayerMatch, id: string, rate: boolean | undefined): number | undefined {
  const v = num(m, id);
  if (v === undefined) return undefined;
  if (!rate) return v;
  return m.durationSec && m.durationSec > 0 ? (v * 60) / m.durationSec : undefined;
}

/** The finite (rate-aware) values of one metric across a set of matches (missing dropped). */
function collect(matches: PlayerMatch[], id: string, rate: boolean | undefined): number[] {
  return matches.map((m) => valueOf(m, id, rate)).filter((v): v is number => v !== undefined);
}

function verdictFor(value: number | null, mean: number, stdev: number, n: number, polarity: Polarity, minCohort: number): { verdict: Verdict; z: number | null } {
  if (value === null) return { verdict: 'insufficient', z: null };
  // Neutral metrics are always descriptive (report value for context) — even with a small cohort,
  // which only suppresses the comparative z-score, not the value itself.
  if (polarity === 'neutral') return { verdict: 'descriptive', z: n < minCohort ? null : stdev === 0 ? 0 : (value - mean) / stdev };
  if (n < minCohort) return { verdict: 'insufficient', z: null };
  if (stdev === 0) {
    if (value === mean) return { verdict: 'average', z: 0 };
    const higher = value > mean;
    const good = polarity === 'higher-better' ? higher : !higher;
    return { verdict: good ? 'better' : 'worse', z: null };
  }
  const z = (value - mean) / stdev;
  if (Math.abs(z) < Z_AVG_BAND) return { verdict: 'average', z };
  const good = polarity === 'higher-better' ? z > 0 : z < 0;
  return { verdict: good ? 'better' : 'worse', z };
}

function winLikenessFor(value: number | null, winVals: number[], lossVals: number[]): WinLikeness {
  if (value === null || winVals.length === 0 || lossVals.length === 0) return 'neutral';
  const wm = stats(winVals).mean, lm = stats(lossVals).mean;
  const dw = Math.abs(value - wm), dl = Math.abs(value - lm);
  if (dw < dl) return 'win-like';
  if (dl < dw) return 'loss-like';
  return 'neutral';
}

/** Score one match (targetMatchId) against the recording character's history. */
export function buildScorecard(matches: PlayerMatch[], targetMatchId: string, opts: BuildOpts): Scorecard {
  const target = matches.find((m) => m.matchId === targetMatchId);
  if (!target) throw new Error(`scorecard: match ${targetMatchId} not found in store`);
  const minCohort = opts.minCohort ?? MIN_COHORT;
  const cohort = filterCohort(matches, target, opts.scope, opts.seasons, opts.gapMs);
  const wins = cohort.filter((m) => m.result === 'win');
  const losses = cohort.filter((m) => m.result === 'loss');
  // season-best cohort: same bracket + same season, ignoring the narrower scope (target excluded).
  // the season filter only bites when seasons are configured; otherwise it spans all history.
  const seasonScoped = opts.seasons.length > 0;
  const seasonCohort = filterCohort(matches, target, { season: seasonScoped }, opts.seasons, opts.gapMs);

  const metrics: MetricScore[] = SCORECARD_METRICS.map((def) => {
    const value = valueOf(target, def.id, def.rate) ?? null;
    const st = stats(collect(cohort, def.id, def.rate));
    const { verdict, z } = verdictFor(value, st.mean, st.stdev, st.n, def.polarity, minCohort);
    // Neutral metrics have no "best" direction (no season-best), but every metric — neutral
    // included — gets a data-driven win/loss lean (nearer the win-mean or the loss-mean).
    const neutral = def.polarity === 'neutral';
    const seasonVals = collect(seasonCohort, def.id, def.rate);
    const seasonBest = neutral || !seasonVals.length
      ? null
      : (def.polarity === 'higher-better' ? Math.max(...seasonVals) : Math.min(...seasonVals));
    const isNewBest = !neutral && value !== null && (seasonBest === null
      || (def.polarity === 'higher-better' ? value > seasonBest : value < seasonBest));
    const winLikeness = winLikenessFor(value, collect(wins, def.id, def.rate), collect(losses, def.id, def.rate));
    return { id: def.id, label: def.label, polarity: def.polarity, value, mean: st.mean, stdev: st.stdev, n: st.n, z, verdict, seasonBest, isNewBest, winLikeness };
  });

  const parts: string[] = [`${target.bracket}`];
  if (opts.scope.lastNGames !== undefined) parts.push(`last ${opts.scope.lastNGames} games`);
  if (opts.scope.lastNSessions !== undefined) parts.push(`last ${opts.scope.lastNSessions} session${opts.scope.lastNSessions === 1 ? '' : 's'}`);
  if (opts.scope.map) parts.push('same map');
  if (opts.scope.comp) parts.push('same comp');
  if (opts.scope.ratingBand !== undefined) parts.push(`rating ±${opts.scope.ratingBand}`);
  if (opts.scope.timeOfDayHours !== undefined) parts.push(`±${opts.scope.timeOfDayHours}h`);
  if (opts.scope.season) parts.push('this season');

  return {
    matchId: target.matchId, character: target.character, bracket: target.bracket,
    zoneId: target.zoneId, enemyComp: target.enemyComp, rating: target.rating,
    result: target.result, startMs: target.startMs, season: seasonOf(opts.seasons, target.startMs),
    cohort: { description: parts.join(', '), n: cohort.length, wins: wins.length, losses: losses.length },
    metrics,
  };
}
