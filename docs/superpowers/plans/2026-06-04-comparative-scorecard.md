# Comparative Scorecard Implementation Plan

> **For agentic workers (FRESH SESSION):** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **PREREQUISITE — read first:** This depends on the match store (PR #16, `src/store/`). Before executing:
> 1. Confirm PR #16 is merged to `master` (`git log master --oneline | grep match-store` or check `src/store/store.ts` exists on master).
> 2. This branch `feat/scorecard` was cut from `feat/match-store`. Rebase it onto the updated master so it carries ONLY the scorecard work: `git fetch && git rebase --onto origin/master feat/match-store feat/scorecard` (or recreate `feat/scorecard` off master and cherry-pick the two doc commits). Verify `git log master..HEAD --oneline` shows only the spec + plan doc commits before starting Task 1.

**Goal:** A read-only CLI that scores one arena match for the recording character against that character's own history — "better / worse / average" and "win-like / loss-like" per metric, sliced by map / comp / rating-band / time-of-day / season-best.

**Architecture:** A pure `src/scorecard/` core (loadMatches → cohort stats → buildScorecard → render) over the existing SQLite store, plus a thin `src/cli/scorecard.ts`. No schema changes, no new ingestion.

**Tech Stack:** TypeScript ESM (NodeNext, local imports end `.js`), `node:sqlite` (via the existing `src/store/sqlite.js` wrapper; needs `--experimental-sqlite`), Vitest, tsx. Spec: `docs/superpowers/specs/2026-06-04-comparative-scorecard-design.md`.

**Commands:**
- Type-check: `npx tsc --noEmit`
- Pure tests: `npx vitest run test/<file> --no-file-parallelism`
- SQLite tests: `NODE_OPTIONS=--experimental-sqlite npx vitest run test/<file> --no-file-parallelism`
- NEVER bare `npx vitest run` / `npm test` (oversubscribes workers, hangs).

---

## File Structure

- **Create** `src/scorecard/types.ts` — shared types (`PlayerMatch`, `MetricScore`, `Scorecard`, `Verdict`, `WinLikeness`, `Scope`).
- **Create** `src/scorecard/loadMatches.ts` — `loadPlayerMatches(db, character?)`.
- **Create** `src/scorecard/cohort.ts` — `stats`, `seasonOf`, `filterCohort`, `hourDiff`.
- **Create** `src/scorecard/scorecard.ts` — `SCORECARD_METRICS`, `buildScorecard`, `MIN_COHORT`.
- **Create** `src/scorecard/render.ts` — `renderScorecardText`.
- **Create** `src/cli/scorecard.ts` — `latestMatchId` + `main`.
- **Modify** `src/config.ts` — add optional `seasons`.
- **Modify** `package.json` — add `scorecard` script.
- Tests: `test/scorecardCohort.test.ts`, `test/scorecardBuild.test.ts`, `test/scorecardRender.test.ts`, `test/scorecardLoad.test.ts`, `test/scorecardCli.test.ts`, `test/configSeasons.test.ts`.

---

## Task 1: Types + config.seasons

**Files:** Create `src/scorecard/types.ts`; Modify `src/config.ts`; Test `test/configSeasons.test.ts`.

- [ ] **Step 1: Create `src/scorecard/types.ts`**

```ts
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

export type Verdict = 'better' | 'worse' | 'average' | 'insufficient';
export type WinLikeness = 'win-like' | 'loss-like' | 'neutral';
export type Polarity = 'higher-better' | 'lower-better';

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
```

- [ ] **Step 2: Write the failing config test** — `test/configSeasons.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

const TMP = 'test-data/tmp-config-seasons.json';
function withConfig(obj: unknown): ReturnType<typeof loadConfig> {
  writeFileSync(TMP, JSON.stringify(obj));
  try { return loadConfig(TMP); } finally { rmSync(TMP, { force: true }); }
}
const base = { sampleLogsDir: 'x', outputDir: 'o', player: { name: 'Phlares', realm: 'Stormrage' } };

describe('loadConfig seasons', () => {
  it('defaults seasons to an empty array when absent', () => {
    expect(withConfig(base).seasons).toEqual([]);
  });
  it('reads a seasons array', () => {
    const cfg = withConfig({ ...base, seasons: [{ name: 'S1', startMs: 1000 }, { name: 'S2', startMs: 2000 }] });
    expect(cfg.seasons).toEqual([{ name: 'S1', startMs: 1000 }, { name: 'S2', startMs: 2000 }]);
  });
});
```

- [ ] **Step 3: Run it, verify it fails** — `npx vitest run test/configSeasons.test.ts --no-file-parallelism` → FAIL (`seasons` undefined).

- [ ] **Step 4: Add `seasons` to `src/config.ts`.** Add to the `Config` interface:
```ts
  seasons: { name: string; startMs: number }[];
```
In `loadConfig`, before the return, build it:
```ts
  let seasons: { name: string; startMs: number }[] = [];
  if (raw.seasons !== undefined) {
    if (!Array.isArray(raw.seasons)) throw new Error('Config error: "seasons" must be an array');
    seasons = (raw.seasons as Record<string, unknown>[]).map((sObj) => ({
      name: requireString(sObj, 'name', 'seasons[].name'),
      startMs: typeof sObj.startMs === 'number' ? sObj.startMs : (() => { throw new Error('Config error: seasons[].startMs must be a number'); })(),
    }));
  }
```
Then add `seasons,` to the returned object literal. (Read `src/config.ts` first to place this beside the existing `players` registry code.)

- [ ] **Step 5: Run config test** → PASS (2/2). `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**
```bash
git add src/scorecard/types.ts src/config.ts test/configSeasons.test.ts
git commit -m "feat: scorecard types + config.seasons"
```

---

## Task 2: Cohort selection + stats (`cohort.ts`)

**Files:** Create `src/scorecard/cohort.ts`; Test `test/scorecardCohort.test.ts`.

- [ ] **Step 1: Write the failing test** — `test/scorecardCohort.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stats, seasonOf, hourDiff, filterCohort } from '../src/scorecard/cohort.js';
import type { PlayerMatch } from '../src/scorecard/types.js';

function mk(over: Partial<PlayerMatch>): PlayerMatch {
  return { matchId: 'M', startMs: 0, bracket: '3v3', zoneId: '1825', allyComp: 'a', enemyComp: 'e',
    rating: 2000, result: 'win', character: 'Me', metrics: {}, ...over };
}

describe('stats', () => {
  it('computes mean/stdev/n/min/max (population stdev)', () => {
    expect(stats([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({ mean: 5, stdev: 2, n: 8, min: 2, max: 9 });
  });
  it('handles empty and single-value', () => {
    expect(stats([])).toEqual({ mean: 0, stdev: 0, n: 0, min: 0, max: 0 });
    expect(stats([3])).toEqual({ mean: 3, stdev: 0, n: 1, min: 3, max: 3 });
  });
});

describe('hourDiff', () => {
  it('wraps around midnight', () => {
    expect(hourDiff(23, 1)).toBe(2);
    expect(hourDiff(1, 23)).toBe(2);
    expect(hourDiff(10, 13)).toBe(3);
  });
});

describe('seasonOf', () => {
  const seasons = [{ name: 'S1', startMs: 1000 }, { name: 'S2', startMs: 2000 }];
  it('returns the latest season starting at or before startMs', () => {
    expect(seasonOf(seasons, 1500)).toBe('S1');
    expect(seasonOf(seasons, 2000)).toBe('S2');
    expect(seasonOf(seasons, 2500)).toBe('S2');
  });
  it('returns null before the first season and when none configured', () => {
    expect(seasonOf(seasons, 500)).toBeNull();
    expect(seasonOf([], 1500)).toBeNull();
    expect(seasonOf(seasons, null)).toBeNull();
  });
});

describe('filterCohort', () => {
  const target = mk({ matchId: 'T', zoneId: '1825', enemyComp: 'wlS', rating: 2000, startMs: Date.UTC(2026, 0, 1, 20) });
  const pool: PlayerMatch[] = [
    target,
    mk({ matchId: 'A', zoneId: '1825', enemyComp: 'wlS', rating: 2010 }),       // same map+comp
    mk({ matchId: 'B', zoneId: '572', enemyComp: 'wlS', rating: 2400 }),        // diff map, far rating
    mk({ matchId: 'C', zoneId: '1825', enemyComp: 'rmp', rating: 1990 }),       // same map, diff comp
    mk({ matchId: 'D', bracket: '2v2', zoneId: '1825', enemyComp: 'wlS' }),     // wrong bracket
  ];
  it('always enforces bracket and excludes the target', () => {
    const ids = filterCohort(pool, target, {}).map((m) => m.matchId);
    expect(ids).toEqual(['A', 'B', 'C']); // D dropped (2v2), T excluded
  });
  it('same-map narrows to the target zone', () => {
    expect(filterCohort(pool, target, { map: true }).map((m) => m.matchId)).toEqual(['A', 'C']);
  });
  it('same-comp narrows to the target enemy comp', () => {
    expect(filterCohort(pool, target, { comp: true }).map((m) => m.matchId)).toEqual(['A', 'B']);
  });
  it('rating-band keeps only matches within ± band', () => {
    expect(filterCohort(pool, target, { ratingBand: 50 }).map((m) => m.matchId)).toEqual(['A', 'C']);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run test/scorecardCohort.test.ts --no-file-parallelism` → FAIL (module not found).

- [ ] **Step 3: Implement `src/scorecard/cohort.ts`**:

```ts
import type { PlayerMatch, Scope } from './types.js';

export interface Stats { mean: number; stdev: number; n: number; min: number; max: number; }

/** Population mean/stdev/min/max. Empty → all zeros. */
export function stats(values: number[]): Stats {
  const n = values.length;
  if (n === 0) return { mean: 0, stdev: 0, n: 0, min: 0, max: 0 };
  let sum = 0, min = Infinity, max = -Infinity;
  for (const v of values) { sum += v; if (v < min) min = v; if (v > max) max = v; }
  const mean = sum / n;
  let sq = 0;
  for (const v of values) sq += (v - mean) * (v - mean);
  return { mean, stdev: Math.sqrt(sq / n), n, min, max };
}

/** Smallest circular distance between two hours-of-day (0..23). */
export function hourDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

/** Name of the latest season starting at or before startMs; null if before the first/none. */
export function seasonOf(seasons: { name: string; startMs: number }[], startMs: number | null): string | null {
  if (startMs === null) return null;
  let best: { name: string; startMs: number } | null = null;
  for (const s of seasons) {
    if (s.startMs <= startMs && (best === null || s.startMs > best.startMs)) best = s;
  }
  return best ? best.name : null;
}

/** The recording character's past matches matching the active scope. Always enforces the
 *  target's bracket and excludes the target match itself. */
export function filterCohort(
  matches: PlayerMatch[],
  target: PlayerMatch,
  scope: Scope,
  seasons: { name: string; startMs: number }[] = [],
): PlayerMatch[] {
  const targetHour = target.startMs !== null ? new Date(target.startMs).getHours() : null;
  const targetSeason = seasonOf(seasons, target.startMs);
  return matches.filter((m) => {
    if (m.matchId === target.matchId) return false;
    if (m.bracket !== target.bracket) return false;
    if (scope.map && m.zoneId !== target.zoneId) return false;
    if (scope.comp && m.enemyComp !== target.enemyComp) return false;
    if (scope.ratingBand !== undefined) {
      if (m.rating === null || target.rating === null) return false;
      if (Math.abs(m.rating - target.rating) > scope.ratingBand) return false;
    }
    if (scope.timeOfDayHours !== undefined) {
      if (m.startMs === null || targetHour === null) return false;
      if (hourDiff(new Date(m.startMs).getHours(), targetHour) > scope.timeOfDayHours) return false;
    }
    if (scope.season && seasonOf(seasons, m.startMs) !== targetSeason) return false;
    return true;
  });
}
```

- [ ] **Step 4: Run tests** → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/scorecard/cohort.ts test/scorecardCohort.test.ts
git commit -m "feat: scorecard cohort selection + stats (pure)"
```

---

## Task 3: Scorecard builder (`scorecard.ts`)

**Files:** Create `src/scorecard/scorecard.ts`; Test `test/scorecardBuild.test.ts`.

- [ ] **Step 1: Write the failing test** — `test/scorecardBuild.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildScorecard, MIN_COHORT } from '../src/scorecard/scorecard.js';
import type { PlayerMatch } from '../src/scorecard/types.js';

function mk(matchId: string, result: string, metrics: Record<string, number>): PlayerMatch {
  return { matchId, startMs: 0, bracket: '3v3', zoneId: '1825', allyComp: 'a', enemyComp: 'e',
    rating: 2000, result, character: 'Me', metrics };
}
// 6 history matches + 1 target (>= MIN_COHORT after excluding target)
function pool(targetMetrics: Record<string, number>): PlayerMatch[] {
  const hist: PlayerMatch[] = [];
  for (let k = 0; k < 6; k++) hist.push(mk('H' + k, k < 3 ? 'win' : 'loss', { deaths: 1, damageDone: 1000, dps: 100 }));
  return [mk('T', 'loss', targetMetrics), ...hist];
}

describe('buildScorecard', () => {
  it('marks a high-deaths match worse (deaths is lower-better)', () => {
    const sc = buildScorecard(pool({ deaths: 5, damageDone: 1000, dps: 100 }), 'T', { scope: {}, seasons: [] });
    const deaths = sc.metrics.find((m) => m.id === 'deaths')!;
    expect(deaths.verdict).toBe('worse');
    expect(deaths.value).toBe(5);
    expect(deaths.n).toBe(6);
  });
  it('marks high damage better (higher-better) and average when near the mean', () => {
    const sc = buildScorecard(pool({ deaths: 1, damageDone: 5000, dps: 100 }), 'T', { scope: {}, seasons: [] });
    expect(sc.metrics.find((m) => m.id === 'damageDone')!.verdict).toBe('better');
    expect(sc.metrics.find((m) => m.id === 'dps')!.verdict).toBe('average'); // equals mean
  });
  it('flags insufficient when the cohort is below MIN_COHORT', () => {
    const small = [mk('T', 'loss', { deaths: 9 }), mk('H0', 'win', { deaths: 1 })]; // cohort n=1
    const sc = buildScorecard(small, 'T', { scope: {}, seasons: [] });
    expect(sc.metrics.find((m) => m.id === 'deaths')!.verdict).toBe('insufficient');
  });
  it('computes win-likeness from the win/loss split means', () => {
    // wins have deaths 0, losses have deaths 4; a target with deaths 0 is win-like
    const hist: PlayerMatch[] = [];
    for (let k = 0; k < 3; k++) hist.push(mk('W' + k, 'win', { deaths: 0 }));
    for (let k = 0; k < 3; k++) hist.push(mk('L' + k, 'loss', { deaths: 4 }));
    const sc = buildScorecard([mk('T', 'loss', { deaths: 0 }), ...hist], 'T', { scope: {}, seasons: [] });
    expect(sc.metrics.find((m) => m.id === 'deaths')!.winLikeness).toBe('win-like');
  });
  it('throws when the target match id is not present', () => {
    expect(() => buildScorecard(pool({ deaths: 1 }), 'NOPE', { scope: {}, seasons: [] })).toThrow();
  });
});

it('exposes MIN_COHORT', () => { expect(MIN_COHORT).toBeGreaterThan(0); });
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run test/scorecardBuild.test.ts --no-file-parallelism` → FAIL (module not found).

- [ ] **Step 3: Implement `src/scorecard/scorecard.ts`**:

```ts
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
```

- [ ] **Step 4: Run tests** → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/scorecard/scorecard.ts test/scorecardBuild.test.ts
git commit -m "feat: buildScorecard — verdict (z-band + polarity), season-best, win-likeness"
```

---

## Task 4: Text rendering (`render.ts`)

**Files:** Create `src/scorecard/render.ts`; Test `test/scorecardRender.test.ts`.

- [ ] **Step 1: Write the failing test** — `test/scorecardRender.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderScorecardText } from '../src/scorecard/render.js';
import type { Scorecard } from '../src/scorecard/types.js';

const sc: Scorecard = {
  matchId: 'T', character: 'Phlares-Stormrage-US', bracket: '3v3', zoneId: '1825',
  enemyComp: 'wlS', rating: 2000, result: 'loss', startMs: 0, season: null,
  cohort: { description: '3v3, same comp', n: 12, wins: 7, losses: 5 },
  metrics: [
    { id: 'deaths', label: 'Deaths', polarity: 'lower-better', value: 5, mean: 1.2, stdev: 0.9, n: 12, z: 4.2, verdict: 'worse', seasonBest: 0, isNewBest: false, winLikeness: 'loss-like' },
    { id: 'dps', label: 'DPS', polarity: 'higher-better', value: 9000, mean: 7000, stdev: 1000, n: 12, z: 2, verdict: 'better', seasonBest: 9000, isNewBest: true, winLikeness: 'win-like' },
  ],
};

describe('renderScorecardText', () => {
  it('includes header, cohort, metric labels, verdicts, and a new-best marker', () => {
    const out = renderScorecardText(sc);
    expect(out).toContain('Phlares-Stormrage-US');
    expect(out).toContain('3v3, same comp');
    expect(out).toContain('n=12');
    expect(out).toContain('Deaths');
    expect(out).toContain('DPS');
    expect(out).toContain('worse');
    expect(out).toContain('better');
    expect(out).toContain('win-like');
    expect(out.toLowerCase()).toContain('best'); // new-best marker for DPS
  });
});
```

- [ ] **Step 2: Run it, verify it fails** → FAIL (module not found).

- [ ] **Step 3: Implement `src/scorecard/render.ts`**:

```ts
import type { MetricScore, Scorecard, Verdict } from './types.js';

const GLYPH: Record<Verdict, string> = { better: '▲ better', worse: '▼ worse', average: '= average', insufficient: '· n/a' };

function fmt(v: number | null): string {
  if (v === null) return '—';
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

function pad(s: string, w: number): string { return s.length >= w ? s : s + ' '.repeat(w - s.length); }

function row(m: MetricScore): string {
  const best = m.isNewBest && m.value !== null ? '  ★ season best' : '';
  const vs = m.verdict === 'insufficient' ? '' : `vs ${fmt(m.mean)} avg`;
  return `  ${pad(m.label, 22)} ${pad(fmt(m.value), 9)} ${pad(GLYPH[m.verdict], 11)} ${pad(vs, 14)} ${pad(m.winLikeness, 10)}${best}`;
}

/** Human-readable scorecard. The JSON form is just the Scorecard object (no renderer). */
export function renderScorecardText(sc: Scorecard): string {
  const when = sc.startMs !== null ? new Date(sc.startMs).toLocaleString() : 'unknown time';
  const head = [
    `Scorecard — ${sc.character}`,
    `  ${sc.bracket} on zone ${sc.zoneId} vs ${sc.enemyComp} — ${sc.result.toUpperCase()}${sc.rating !== null ? ` @ ${sc.rating}` : ''} — ${when}`,
    `  baseline: ${sc.cohort.description} · n=${sc.cohort.n} (${sc.cohort.wins}W/${sc.cohort.losses}L)${sc.season ? ` · season ${sc.season}` : ''}`,
    `  ${pad('metric', 22)} ${pad('value', 9)} ${pad('verdict', 11)} ${pad('', 14)} ${pad('win/loss', 10)}`,
  ];
  return [...head, ...sc.metrics.map(row)].join('\n');
}
```

- [ ] **Step 4: Run tests** → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/scorecard/render.ts test/scorecardRender.test.ts
git commit -m "feat: scorecard text renderer (aligned CLI table)"
```

---

## Task 5: Match loader (`loadMatches.ts`)

**Files:** Create `src/scorecard/loadMatches.ts`; Test `test/scorecardLoad.test.ts`.

- [ ] **Step 1: Write the failing test** — `test/scorecardLoad.test.ts` (seeds rows directly; no fixtures needed):

```ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { loadPlayerMatches } from '../src/scorecard/loadMatches.js';

function seed(db: InstanceType<typeof DatabaseSync>) {
  db.prepare('INSERT INTO match (match_id,start_ms,bracket,zone_id,ally_comp_sig,enemy_comp_sig,player_rating,result,player_unit_id,player_name) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('M1', 100, '3v3', '1825', '256_265', 'wlS', 2000, 'win', 'P-1', 'Me-Realm');
  db.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)')
    .run('M1', 'P-1', 'Me', 'Realm', null, '265', 'friendly', 1);
  db.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)')
    .run('M1', 'E-1', 'Foe', 'Realm', null, '270', 'enemy', 0);
  db.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)').run('M1', 'P-1', 'damageDone', 1000);
  db.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)').run('M1', 'P-1', 'deaths', 2);
  db.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)').run('M1', 'E-1', 'damageDone', 9999); // enemy, must be ignored
}

describe('loadPlayerMatches', () => {
  it('pivots the recording player metrics per match and ignores other combatants', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    seed(db);
    const ms = loadPlayerMatches(db);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ matchId: 'M1', bracket: '3v3', zoneId: '1825', enemyComp: 'wlS', rating: 2000, result: 'win', character: 'Me-Realm' });
    expect(ms[0].metrics).toEqual({ damageDone: 1000, deaths: 2 }); // enemy's 9999 excluded
  });
  it('filters by character when given', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    seed(db);
    expect(loadPlayerMatches(db, 'Nobody')).toHaveLength(0);
    expect(loadPlayerMatches(db, 'Me-Realm')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `NODE_OPTIONS=--experimental-sqlite npx vitest run test/scorecardLoad.test.ts --no-file-parallelism` → FAIL (module not found).

- [ ] **Step 3: Implement `src/scorecard/loadMatches.ts`**:

```ts
import type { DatabaseSync } from '../store/sqlite.js';
import type { PlayerMatch } from './types.js';

interface Row {
  match_id: string; start_ms: number | null; bracket: string | null; zone_id: string | null;
  ally_comp_sig: string | null; enemy_comp_sig: string | null; player_rating: number | null;
  result: string | null; player_name: string | null; metric_id: string; value: number;
}

/** Load the recording character's matches with per-player metrics pivoted into a map.
 *  Joins match ⨝ combatant(is_player=1) ⨝ metric(scope=that unit). One row per metric;
 *  pivoted here. Optionally restrict to one character (player_name). */
export function loadPlayerMatches(db: DatabaseSync, character?: string): PlayerMatch[] {
  const sql =
    `SELECT m.match_id, m.start_ms, m.bracket, m.zone_id, m.ally_comp_sig, m.enemy_comp_sig,
            m.player_rating, m.result, m.player_name, x.metric_id, x.value
     FROM match m
     JOIN combatant c ON c.match_id = m.match_id AND c.is_player = 1
     JOIN metric x ON x.match_id = m.match_id AND x.scope = c.unit_id
     ${character ? 'WHERE m.player_name = ?' : ''}
     ORDER BY m.start_ms`;
  const stmt = db.prepare(sql);
  const rows = (character ? stmt.all(character) : stmt.all()) as unknown as Row[];
  const byMatch = new Map<string, PlayerMatch>();
  for (const r of rows) {
    let pm = byMatch.get(r.match_id);
    if (!pm) {
      pm = {
        matchId: r.match_id, startMs: r.start_ms, bracket: r.bracket ?? '', zoneId: r.zone_id ?? '',
        allyComp: r.ally_comp_sig ?? '', enemyComp: r.enemy_comp_sig ?? '', rating: r.player_rating,
        result: r.result ?? 'unknown', character: r.player_name ?? '', metrics: {},
      };
      byMatch.set(r.match_id, pm);
    }
    pm.metrics[r.metric_id] = r.value;
  }
  return [...byMatch.values()];
}
```

- [ ] **Step 4: Run tests** → PASS (2/2). `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/scorecard/loadMatches.ts test/scorecardLoad.test.ts
git commit -m "feat: loadPlayerMatches — pivot player metrics per match from the store"
```

---

## Task 6: CLI (`cli/scorecard.ts`) + npm script

**Files:** Create `src/cli/scorecard.ts`; Modify `package.json`; Test `test/scorecardCli.test.ts`.

- [ ] **Step 1: Write the failing test** — `test/scorecardCli.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { latestMatchId } from '../src/cli/scorecard.js';
import type { PlayerMatch } from '../src/scorecard/types.js';

function mk(matchId: string, startMs: number, character = 'Me'): PlayerMatch {
  return { matchId, startMs, bracket: '3v3', zoneId: '1825', allyComp: 'a', enemyComp: 'e',
    rating: 2000, result: 'win', character, metrics: {} };
}

describe('latestMatchId', () => {
  it('returns the most recent match overall', () => {
    expect(latestMatchId([mk('A', 100), mk('C', 300), mk('B', 200)])).toBe('C');
  });
  it('restricts to a character when given', () => {
    const ms = [mk('A', 100, 'Me'), mk('C', 300, 'Alt'), mk('B', 200, 'Me')];
    expect(latestMatchId(ms, 'Me')).toBe('B');
  });
  it('returns undefined for an empty store', () => {
    expect(latestMatchId([])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run test/scorecardCli.test.ts --no-file-parallelism` → FAIL (module not found).

- [ ] **Step 3: Implement `src/cli/scorecard.ts`**:

```ts
import { fileURLToPath } from 'node:url';
import { openDb } from '../store/store.js';
import { loadConfig } from '../config.js';
import { loadPlayerMatches } from '../scorecard/loadMatches.js';
import { buildScorecard } from '../scorecard/scorecard.js';
import { renderScorecardText } from '../scorecard/render.js';
import type { PlayerMatch, Scope } from '../scorecard/types.js';

/** Most recent match (max startMs) overall, or for one character. undefined if none. */
export function latestMatchId(matches: PlayerMatch[], character?: string): string | undefined {
  let best: PlayerMatch | undefined;
  for (const m of matches) {
    if (character && m.character !== character) continue;
    if (m.startMs === null) continue;
    if (!best || best.startMs === null || m.startMs > best.startMs) best = m;
  }
  return best?.matchId;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
function has(flag: string): boolean { return process.argv.includes(flag); }

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath ?? './wow-arena-eye.local.db');
  const character = arg('--character');
  const matches = loadPlayerMatches(db, character);
  if (matches.length === 0) { console.error('No matches in the store. Run `npm run ingest-db -- <logsDir>` first.'); process.exit(1); }

  const targetId = arg('--match') ?? latestMatchId(matches, character);
  if (!targetId || !matches.some((m) => m.matchId === targetId)) {
    console.error(`Target match not found. Pass --match <id> or ingest matches. (have ${matches.length})`); process.exit(1);
  }

  const scope: Scope = {};
  if (has('--map')) scope.map = true;
  if (has('--comp')) scope.comp = true;
  if (has('--season')) scope.season = true;
  const rb = arg('--rating-band'); if (has('--rating-band')) scope.ratingBand = rb ? Number(rb) : 150;
  const tod = arg('--time-of-day'); if (has('--time-of-day')) scope.timeOfDayHours = tod ? Number(tod) : 2;

  const sc = buildScorecard(matches, targetId, { scope, seasons: cfg.seasons });
  if (has('--json')) { console.log(JSON.stringify(sc, null, 2)); return; }
  console.log(renderScorecardText(sc));
  if (sc.cohort.n < 5) console.log(`\n  note: thin sample (n=${sc.cohort.n}); verdicts may read n/a.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
```

- [ ] **Step 4: Run tests** → PASS (3/3). `npx tsc --noEmit` → clean.

- [ ] **Step 5: Add the npm script** in `package.json` `"scripts"`, after `ingest-db`:
```json
"scorecard": "node --experimental-sqlite --import tsx src/cli/scorecard.ts",
```

- [ ] **Step 6: Commit**
```bash
git add src/cli/scorecard.ts package.json test/scorecardCli.test.ts
git commit -m "feat: scorecard CLI (npm run scorecard) — target select, scope flags, --json"
```

---

## After all tasks (controller)

1. Full suite green: `NODE_OPTIONS=--experimental-sqlite npx vitest run --no-file-parallelism`, `npx tsc --noEmit` clean.
2. Gates: `/simplify` then `/code-review` on the branch diff; address findings.
3. Smoke (optional, needs a populated `.local.db`): `npm run ingest-db -- "<logs>"` then `npm run scorecard` (and `npm run scorecard -- --map --comp`, `--json`).
4. Finish: superpowers:finishing-a-development-branch → push + create PR.

## Self-Review

- *Spec coverage:* season config + types (Task 1), cohort/stats/season (Task 2), verdict/season-best/win-likeness builder + curated polarity metrics (Task 3), CLI table render (Task 4), store loader/pivot (Task 5), CLI with target-select + scope flags + JSON (Task 6). Per-session grain and the capstone are deferred per spec.
- *Placeholder scan:* none — every step has concrete code/commands/expected output.
- *Type consistency:* `PlayerMatch`/`Scope`/`MetricScore`/`Scorecard` defined once in types.ts and used across cohort/scorecard/render/loadMatches/cli. `buildScorecard(matches, id, {scope, seasons})`, `filterCohort(matches, target, scope, seasons)`, `loadPlayerMatches(db, character?)`, `latestMatchId(matches, character?)`, `renderScorecardText(sc)` are used identically in tasks and tests. SQLite-touching tests (load) carry `NODE_OPTIONS=--experimental-sqlite`; pure tests (cohort/build/render/cli/config) do not. Metric ids in SCORECARD_METRICS are a subset of the store's `metricRows.ts` UNIT_METRICS.
