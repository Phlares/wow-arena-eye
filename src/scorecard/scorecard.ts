import type { MetricScore, PlayerMatch, Polarity, Scope, Scorecard, Verdict, WinLikeness } from './types.js';
import { filterCohort, seasonOf, stats } from './cohort.js';

export const MIN_COHORT = 5;
const Z_AVG_BAND = 0.5;

/** Curated, polarity-aware indicators. ids are a subset of the store's metric table
 *  (metricRows.ts UNIT_METRICS). Polarity is tuned for a ranged caster (Affliction). */
export const SCORECARD_METRICS: { id: string; label: string; polarity: Polarity }[] = [
  { id: 'damageDone', label: 'Damage done', polarity: 'higher-better' },
  { id: 'dps', label: 'DPS', polarity: 'higher-better' },
  { id: 'deaths', label: 'Deaths', polarity: 'lower-better' },
  { id: 'deathsWhileCcd', label: "Deaths while CC'd", polarity: 'lower-better' },
  { id: 'interruptsLanded', label: 'Kicks landed', polarity: 'higher-better' },
  { id: 'interruptsSuffered', label: 'Own casts kicked', polarity: 'lower-better' },
  { id: 'ccDone.hardCcSec', label: 'Hard CC done (s)', polarity: 'higher-better' },
  { id: 'ccReceived.hardCcSec', label: 'Hard CC taken (s)', polarity: 'lower-better' },
  { id: 'ccReceived.timeSec', label: 'Total CC taken (s)', polarity: 'lower-better' },
  { id: 'defensivesIntoBurst', label: 'Defensives into burst', polarity: 'higher-better' },
  { id: 'spacing.isolatedSec', label: 'Time isolated (s)', polarity: 'lower-better' },
  { id: 'spacing.meleeRangeSec', label: 'Time in melee (s)', polarity: 'lower-better' },
];

export interface BuildOpts { scope: Scope; seasons: { name: string; startMs: number }[]; minCohort?: number; }

function num(m: PlayerMatch, id: string): number | undefined {
  const v = m.metrics[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function verdictFor(value: number | null, mean: number, stdev: number, n: number, polarity: Polarity, minCohort: number): { verdict: Verdict; z: number | null } {
  if (value === null || n < minCohort) return { verdict: 'insufficient', z: null };
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
  const cohort = filterCohort(matches, target, opts.scope, opts.seasons);
  const wins = cohort.filter((m) => m.result === 'win');
  const losses = cohort.filter((m) => m.result === 'loss');
  // season-best cohort: same bracket + same season, ignoring the narrower scope (target excluded)
  const seasonCohort = filterCohort(matches, target, { season: opts.seasons.length > 0 }, opts.seasons);

  const metrics: MetricScore[] = SCORECARD_METRICS.map((def) => {
    const value = num(target, def.id) ?? null;
    const vals = cohort.map((m) => num(m, def.id)).filter((v): v is number => v !== undefined);
    const st = stats(vals);
    const { verdict, z } = verdictFor(value, st.mean, st.stdev, st.n, def.polarity, minCohort);
    const seasonVals = seasonCohort.map((m) => num(m, def.id)).filter((v): v is number => v !== undefined);
    const seasonBest = seasonVals.length
      ? (def.polarity === 'higher-better' ? Math.max(...seasonVals) : Math.min(...seasonVals))
      : null;
    const isNewBest = value !== null && (seasonBest === null
      || (def.polarity === 'higher-better' ? value > seasonBest : value < seasonBest));
    const winLikeness = winLikenessFor(value, wins.map((m) => num(m, def.id)).filter((v): v is number => v !== undefined),
      losses.map((m) => num(m, def.id)).filter((v): v is number => v !== undefined));
    return { id: def.id, label: def.label, polarity: def.polarity, value, mean: st.mean, stdev: st.stdev, n: st.n, z, verdict, seasonBest, isNewBest, winLikeness };
  });

  const parts: string[] = [`${target.bracket}`];
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
