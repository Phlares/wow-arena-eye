# Baselines + Comparative Scorecard in the Viewer (C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the comparative scorecard into the viewer's match-detail overlay with a configurable "Compare against" baseline (Overall / Past N games incl. All / Past N sessions + composable filters), rate-normalized verdicting, win/loss lean for descriptive metrics, and a new avg-distance-from-healer metric.

**Architecture:** Extend the scorecard layer (Scope recency, rate-normalization, win-likeness-for-all), add the healer-distance metric (metrics + store, re-ingest), expose `GET /api/matches/:id/scorecard`, and render a `ComparePanel` in `DetailView`.

**Tech Stack:** TypeScript ESM (NodeNext), node:sqlite (`--experimental-sqlite`), Vitest (root + `web/` jsdom), React 18 + Vite.

**Spec:** `docs/superpowers/specs/2026-06-07-baselines-comparative-scorecard-design.md`

**Conventions:** SQLite root tests `NODE_OPTIONS=--experimental-sqlite npx vitest run <file> --no-file-parallelism`; web tests inside `web/`; never bare `npx vitest run` at root. Local imports end `.js`. Additive type changes. Commit per task; bodies end `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Confirmed facts:**
- `PlayerMatch` (`src/scorecard/types.ts`): matchId/startMs/bracket/zoneId/allyComp/enemyComp/rating/result/character/metrics — **no durationSec**.
- `Scope`: map/comp/ratingBand/timeOfDayHours/season.
- `filterCohort(matches, target, scope, seasons=[])` (`cohort.ts`) enforces bracket + excludes target.
- `buildScorecard(matches, targetMatchId, {scope, seasons, minCohort?})` (`scorecard.ts`); `verdictFor` returns `descriptive` for `neutral` polarity; `SCORECARD_METRICS` includes `damageDone`(higher-better), `dps`(higher-better), `precognitionUptimeSec`/`enemyPrecognitionUptimeSec`(neutral), etc.; `MIN_COHORT=5`.
- `sessionize(matches: SessionInput[], gapMs)` → `Session[]` (id = first match id). `SessionInput = {matchId, startMs, durationSec, rating, result, allyCompLabel}`.
- `attachSpacing(units, tracks: Map<string,PositionTrack>)`; `spacingFor` loops `t = startT..endT step STEP_SEC`, `distanceAt(self, other, t)`, `round1`, `resolvePosition`. `HEALER_SPEC_IDS` in `src/metrics/registry.ts` = `['65','105','256','257','264','270','1468']`.
- Viewer reads list metrics via the `dataset_export` view; `cfg.sessionGapMinutes` available in `server.ts`.

---

## Phase 1 — Scorecard baseline model, rate-normalization, win-likeness

### Task 1: `PlayerMatch.durationSec` + loader

**Files:** Modify `src/scorecard/types.ts`, `src/scorecard/loadMatches.ts`. Test: `test/loadMatchesDuration.test.ts`

- [ ] **Step 1: failing test**

```ts
// test/loadMatchesDuration.test.ts (sqlite)
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { loadPlayerMatches } from '../src/scorecard/loadMatches.js';

describe('loadPlayerMatches duration', () => {
  it('exposes durationSec from the match row', () => {
    const db = new DatabaseSync(':memory:'); migrate(db);
    db.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,duration_sec,result,player_unit_id,player_name) VALUES (?,?,?,?,?,?,?,?)`)
      .run('M1', 1000, '3v3', '1', 161, 'win', 'P', 'Me');
    db.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)').run('M1','P','P','R',null,'265','friendly',1);
    const [pm] = loadPlayerMatches(db, 'Me');
    expect(pm.durationSec).toBe(161);
  });
});
```

- [ ] **Step 2:** Run → FAIL (`durationSec` undefined). `NODE_OPTIONS=--experimental-sqlite npx vitest run test/loadMatchesDuration.test.ts --no-file-parallelism`
- [ ] **Step 3:** In `types.ts` add to `PlayerMatch`: `durationSec: number | null;`. In `loadMatches.ts`: add `m.duration_sec` to the SELECT, add `duration_sec: number | null` to the `Row` interface, and set `durationSec: r.duration_sec` in the `pm` object literal.
- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit` (fix any PlayerMatch literal in tests by adding `durationSec: null`).
- [ ] **Step 5:** `git add -A && git commit -m "feat(scorecard): PlayerMatch.durationSec from the match row"`

### Task 2: `Scope` recency (Past N games / Past N sessions)

**Files:** Modify `src/scorecard/types.ts` (Scope), `src/scorecard/cohort.ts` (filterCohort). Test: `test/cohortRecency.test.ts`

- [ ] **Step 1: failing test**

```ts
// test/cohortRecency.test.ts
import { describe, it, expect } from 'vitest';
import { filterCohort } from '../src/scorecard/cohort.js';
import type { PlayerMatch } from '../src/scorecard/types.js';

const pm = (id: string, t: number): PlayerMatch => ({ matchId: id, startMs: t, bracket: '3v3', zoneId: '1',
  allyComp: '', enemyComp: '', rating: 1800, result: 'win', character: 'Me', durationSec: 120, metrics: {} });

// target T at t=1000; earlier games at 100,200,300,400; a later game at 2000 (must never be in a baseline)
const all = [pm('a', 100), pm('b', 200), pm('c', 300), pm('d', 400), pm('T', 1000), pm('late', 2000)];
const target = all.find((m) => m.matchId === 'T')!;

describe('filterCohort recency', () => {
  it('lastNGames takes the N most-recent games strictly before the target', () => {
    const ids = filterCohort(all, target, { lastNGames: 2 }, []).map((m) => m.matchId);
    expect(ids.sort()).toEqual(['c', 'd']); // 300,400 — the 2 newest before t=1000; 'late' excluded
  });
  it('lastNGames=All-equivalent (omitted) returns all before-or-after per existing rules', () => {
    // Overall (no recency) keeps existing behavior: all same-bracket except target (incl. 'late')
    expect(filterCohort(all, target, {}, []).length).toBe(5);
  });
  it('lastNSessions keeps the N sessions before the target session (gap split)', () => {
    // big gap so each cluster is a session: {100,200} | {300,400} | {1000=T} | {2000}
    const gapMs = 50; // any gap > 100ms spacing? spacing is 100 → use gap smaller than cluster gaps
    const ids = filterCohort(all, target, { lastNSessions: 1 }, [], 50_000).map((m) => m.matchId);
    // with a 50s gap, 100..400 are one session, T its own, 2000 its own → 1 session before T = {a,b,c,d}
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
```

NOTE: tune the gap/timestamps so the session clustering in the test is unambiguous; the assertion is "the matches in the N sessions immediately before the target's session, target+later excluded".

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `types.ts` `Scope` add: `lastNGames?: number;` and `lastNSessions?: number;`. In `cohort.ts`, change the signature to `filterCohort(matches, target, scope, seasons = [], gapMs = 30 * 60_000)` and, after the existing attribute-filter `.filter(...)` (call its result `base`), apply recency:

```ts
  // recency narrows the attribute-filtered cohort to games before the target
  if (scope.lastNGames !== undefined) {
    return base
      .filter((m) => m.startMs !== null && target.startMs !== null && m.startMs < target.startMs)
      .sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0))
      .slice(0, scope.lastNGames);
  }
  if (scope.lastNSessions !== undefined) {
    if (target.startMs === null) return [];
    // sessionize the character's same-bracket matches (incl. target) to locate sessions
    const sized = [...base, target].filter((m) => m.startMs !== null)
      .map((m) => ({ matchId: m.matchId, startMs: m.startMs as number, durationSec: m.durationSec, rating: m.rating, result: m.result, allyCompLabel: '' }));
    const sessions = sessionize(sized, gapMs); // Session[].id = first match id; chronological
    const sessionIndexByMatch = new Map<string, number>();
    sessions.forEach((s, i) => { /* map each member matchId → i */ });
    // NOTE: Session doesn't list member ids; re-derive membership by re-running the same gap split,
    // or extend sessionize. Simplest: compute session index by walking `sized` sorted by startMs and
    // incrementing on a gap > gapMs (mirror sessionize's split rule), then keep matches whose index
    // is in [targetIdx - lastNSessions, targetIdx - 1].
    return /* matches in the N sessions before the target's session */ [];
  }
  return base;
```

IMPORTANT: `Session` carries no member-id list, so don't try to read membership off it. Instead compute a `matchId → sessionIndex` map directly by sorting `sized` by `startMs` and splitting on `endOf(prev) + gapMs < next.startMs` (the same rule `sessionize` uses — `endOf = startMs + (durationSec ?? 0)*1000`). Find the target's index; keep base matches whose index ∈ `[targetIdx - lastNSessions, targetIdx - 1]`. Import `sessionize`'s gap rule or just replicate the split inline (it's ~5 lines); add a unit-tested helper `sessionIndexByStart(sized, gapMs): Map<string, number>` in `cohort.ts` if cleaner.

- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(scorecard): Past N games / Past N sessions recency in filterCohort`

### Task 3: rate-normalized verdicting + win-likeness for all metrics

**Files:** Modify `src/scorecard/scorecard.ts`, `src/scorecard/types.ts` (BuildOpts gapMs). Test: `test/scorecardRate.test.ts`

- [ ] **Step 1: failing test**

```ts
// test/scorecardRate.test.ts
import { describe, it, expect } from 'vitest';
import { buildScorecard, SCORECARD_METRICS } from '../src/scorecard/scorecard.js';
import type { PlayerMatch } from '../src/scorecard/types.js';

const mk = (id: string, dmg: number, dur: number, result = 'win'): PlayerMatch => ({ matchId: id, startMs: 1000,
  bracket: '3v3', zoneId: '1', allyComp: '', enemyComp: '', rating: 1800, result, character: 'Me', durationSec: dur,
  metrics: { damageDone: dmg } });

describe('rate-normalized verdicting', () => {
  it('judges damage on per-minute rate, so a long match does not beat a short one on raw total', () => {
    // target: 2M over 60s = 2M/min. cohort: all 2M/min (some long, some short). Verdict should be average.
    const matches = [mk('T', 2_000_000, 60), mk('a', 6_000_000, 180), mk('b', 1_000_000, 30), mk('c', 4_000_000, 120), mk('d', 3_000_000, 90), mk('e', 2_000_000, 60)];
    const score = buildScorecard(matches, 'T', { scope: {}, seasons: [] }).metrics.find((m) => m.id === 'damageDone')!;
    expect(score.verdict).toBe('average'); // raw totals vary wildly; per-minute they're all ~2M/min
  });
  it('dropped the standalone dps metric (folded into rate-normalized damage)', () => {
    expect(SCORECARD_METRICS.some((d) => d.id === 'dps')).toBe(false);
  });
  it('descriptive (neutral) metrics still get a win/loss lean', () => {
    const matches = [
      { ...mk('T', 0, 60), metrics: { precognitionUptimeSec: 8 } },
      { ...mk('w1', 0, 60, 'win'), metrics: { precognitionUptimeSec: 8 } },
      { ...mk('w2', 0, 60, 'win'), metrics: { precognitionUptimeSec: 9 } },
      { ...mk('l1', 0, 60, 'loss'), metrics: { precognitionUptimeSec: 2 } },
      { ...mk('l2', 0, 60, 'loss'), metrics: { precognitionUptimeSec: 1 } },
      { ...mk('w3', 0, 60, 'win'), metrics: { precognitionUptimeSec: 7 } },
    ];
    const s = buildScorecard(matches, 'T', { scope: {}, seasons: [] }).metrics.find((m) => m.id === 'precognitionUptimeSec')!;
    expect(s.verdict).toBe('descriptive');
    expect(s.winLikeness).toBe('win-like'); // 8 is nearer the win-mean than the loss-mean
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `scorecard.ts`:
  - Add `rate?: true` to the `SCORECARD_METRICS` element type and tag the accumulating metrics: `damageDone`, `healingDone` (if present), `interruptsLanded`, `interruptsSuffered`, `ccDone.hardCcSec`, `ccReceived.hardCcSec`, `ccReceived.timeSec`, `spacing.isolatedSec`, `spacing.meleeRangeSec`, `precognitionUptimeSec`, `enemyPrecognitionUptimeSec`. **Remove the `dps` entry.**
  - Add a per-match accessor honoring `rate`:
    ```ts
    function valueOf(m: PlayerMatch, id: string, rate: boolean | undefined): number | undefined {
      const v = num(m, id);
      if (v === undefined) return undefined;
      if (!rate) return v;
      return m.durationSec && m.durationSec > 0 ? (v * 60) / m.durationSec : undefined; // per-minute
    }
    ```
  - In the `SCORECARD_METRICS.map`, replace `num(target, def.id)` with `valueOf(target, def.id, def.rate)`, and replace every `collect(set, def.id)` with `set.map((m) => valueOf(m, def.id, def.rate)).filter((v): v is number => v !== undefined)` (cohort, seasonCohort, wins, losses). Keep the existing `verdictFor`/`stats`/`seasonBest` logic on these normalized arrays.
  - Remove the `neutral ? 'neutral' : winLikenessFor(...)` short-circuit: `const winLikeness = winLikenessFor(value, winVals, lossVals);` for all polarities. (Verdict for neutral stays `descriptive` via `verdictFor`.)
  - Add `gapMs?: number` to `BuildOpts`; pass `opts.gapMs` through to `filterCohort(matches, target, scope, seasons, opts.gapMs)`.
- [ ] **Step 4:** Run → PASS. Run the existing scorecard suite (`test/scorecard*.test.ts`) — fix `scorecardNeutral.test.ts` if it asserted `winLikeness === 'neutral'` for precog (it should now be data-driven; update the fixture/assertion). `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(scorecard): per-minute rate verdicting + win-likeness for descriptive metrics; drop dps`

---

## Phase 2 — Avg distance from friendly healer

### Task 4: compute `avgHealerDistanceYd`

**Files:** Modify `src/metrics/types.ts` (UnitMetrics), `src/metrics/spacing.ts`. Test: `test/healerDistance.test.ts`

- [ ] **Step 1: failing test**

```ts
// test/healerDistance.test.ts
import { describe, it, expect } from 'vitest';
import { attachSpacing } from '../src/metrics/spacing.js';
import type { UnitMetrics, PositionTrack } from '../src/metrics/types.js';

function unit(over: Partial<UnitMetrics>): UnitMetrics { return { unitId: 'x', name: 'x', kind: 'player', team: 'friendly',
  spec: '265', casts: 0, topCasts: [], interruptsLanded: 0, interruptsLandedBySpell: [], dispels: 0, purges: 0,
  purgesBySpell: [], cleanses: 0, cleansesBySpell: [], spellsteals: 0, spellstealsBySpell: [], deaths: 0, deathTimesSec: [],
  distanceMoved: 0, positionSamples: 0, timeStationarySec: 0, track: [], spacing: { meleeRangeSec: 0, isolatedSec: 0 },
  interruptsSuffered: 0, interruptsSufferedBySpell: [], precognitionUptimeSec: 0, enemyPrecognitionUptimeSec: 0,
  deathsWhileCcd: 0, deathsWhileCcdBySpell: [], defensivesUsed: 0, defensivesUsedBySpell: [], defensivesIntoBurst: 0,
  cdUsage: [], ccReceived: {} as never, ccDone: {} as never, immuneReceived: {} as never, immuneDone: {} as never,
  damageDone: 0, healingDone: 0, absorbDone: 0, dps: 0, hps: 0, avgHealerDistanceYd: null, ...over }; }

const tr = (id: string, x: number): PositionTrack => ({ unitId: id, breaks: [], samples: [{ tSec: 0, x, y: 0 }, { tSec: 1, x, y: 0 }] });

it('averages the player-to-friendly-healer distance', () => {
  const me = unit({ unitId: 'P', spec: '265' });            // warlock
  const healer = unit({ unitId: 'H', spec: '256' });        // disc priest (HEALER_SPEC_IDS)
  const tracks = new Map([['P', tr('P', 0)], ['H', tr('H', 10)]]);
  const [out] = attachSpacing([me, healer], tracks).filter((u) => u.unitId === 'P');
  expect(out.avgHealerDistanceYd).toBeCloseTo(10, 1);
});
it('is null when the team has no healer', () => {
  const me = unit({ unitId: 'P', spec: '265' });
  const dps = unit({ unitId: 'D', spec: '577' }); // havoc DH, not a healer
  const tracks = new Map([['P', tr('P', 0)], ['D', tr('D', 10)]]);
  expect(attachSpacing([me, dps], tracks).find((u) => u.unitId === 'P')!.avgHealerDistanceYd).toBeNull();
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `types.ts` `UnitMetrics` add `avgHealerDistanceYd: number | null;` (near `spacing`). In `spacing.ts` add `import { HEALER_SPEC_IDS } from './registry.js';` and a helper, then set it in `attachSpacing`:

```ts
function avgHealerDistance(u: UnitMetrics, players: UnitMetrics[], tracks: Map<string, PositionTrack>): number | null {
  const self = tracks.get(u.unitId);
  if (!self || self.samples.length === 0) return null;
  const healer = players.find((p) => p.team === u.team && p.unitId !== u.unitId && p.spec !== undefined && HEALER_SPEC_IDS.includes(String(p.spec)));
  const ht = healer ? tracks.get(healer.unitId) : undefined;
  if (!ht) return null;
  const startT = self.samples[0].tSec, endT = self.samples[self.samples.length - 1].tSec;
  let sum = 0, n = 0;
  for (let t = startT; t <= endT; t += STEP_SEC) { const d = distanceAt(self, ht, t); if (d !== undefined) { sum += d; n += 1; } }
  return n ? round1(sum / n) : null;
}
```
In `attachSpacing`'s `units.map`, add `avgHealerDistanceYd: u.kind === 'player' ? avgHealerDistance(u, players, tracks) : null`.

- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit` — add `avgHealerDistanceYd: null` (or a number) to the bare `UnitMetrics` literals in `test/metricRows.test.ts` and `test/renderReport.test.ts` (same as the precog additions did).
- [ ] **Step 5:** Commit `feat(metrics): avgHealerDistanceYd (mean player→healer distance over the match)`

### Task 5: persist + scorecard metric

**Files:** Modify `src/store/metricRows.ts`, `src/store/schema.ts` (view), `src/scorecard/scorecard.ts`. Test: extend `test/storePrecognition.test.ts` or add `test/storeHealerDist.test.ts`

- [ ] **Step 1: failing test** — assert `extractMetricRows` emits `avgHealerDistanceYd` for the player scope, and the `dataset_export` view has the column (mirror `test/storePrecognition.test.ts`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `metricRows.ts` `UNIT_METRICS` add `{ id: 'avgHealerDistanceYd', get: (u) => u.avgHealerDistanceYd ?? NaN }` (NaN → `Number.isFinite` guard drops the row when null, so absent rather than 0). In `schema.ts` `dataset_export`, add `MAX(CASE WHEN x.metric_id = 'avgHealerDistanceYd' THEN x.value END) AS avgHealerDistanceYd` (the migrate guard already drops+recreates a stale view). In `scorecard.ts` `SCORECARD_METRICS` add `{ id: 'avgHealerDistanceYd', label: 'Avg dist from healer (yd)', polarity: 'neutral' }` (descriptive + win-likeness via Task 3; NOT rate).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: persist avgHealerDistanceYd + add it to the scorecard (descriptive)`

---

## Phase 3 — Scorecard endpoint

### Task 6: `buildScorecardFor` + `GET /api/matches/:id/scorecard`

**Files:** Modify `src/viewer/queries.ts` (helper), `src/viewer/server.ts` (route). Test: `test/viewerScorecard.test.ts`

- [ ] **Step 1: failing test** — seed a match + its player metrics + a couple of prior matches via `upsertMatch` (or direct inserts), call `handleApi(db, 'GET', '/api/matches/M1/scorecard?mode=games&n=20&comp=1', params, gapMs)`, assert status 200 and the body has `metrics` (an array with `damageDone`) and `cohort`; assert 404 for an unknown id. (Pass query via the `URLSearchParams` arg.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `queries.ts`:

```ts
import { buildScorecard } from '../scorecard/scorecard.js';
import { loadPlayerMatches } from '../scorecard/loadMatches.js';
import type { Scope, Season } from '../scorecard/types.js';

/** Build a comparative scorecard for one match, or null if it isn't in the store. */
export function buildScorecardFor(db: DatabaseSync, matchId: string, scope: Scope, seasons: Season[], gapMs: number) {
  const row = db.prepare('SELECT player_name FROM match WHERE match_id = ?').get(matchId) as { player_name?: string } | undefined;
  if (!row?.player_name) return null;
  const matches = loadPlayerMatches(db, row.player_name);
  if (!matches.some((m) => m.matchId === matchId)) return null;
  return buildScorecard(matches, matchId, { scope, seasons, gapMs });
}
```

In `server.ts`, add — **before** the `/:id/detail` and `/:id` routes — a `/scorecard` route, and a `parseScope` helper:

```ts
function parseScope(p: URLSearchParams): Scope {
  const mode = p.get('mode'); const n = Number(p.get('n'));
  const num = (k: string) => (p.get(k) && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : undefined);
  return {
    lastNGames: mode === 'games' && Number.isFinite(n) && n > 0 ? n : undefined,
    lastNSessions: mode === 'sessions' && Number.isFinite(n) && n > 0 ? n : undefined,
    comp: p.get('comp') === '1' || undefined, map: p.get('map') === '1' || undefined,
    ratingBand: num('ratingBand'), timeOfDayHours: num('timeOfDay'), season: p.get('season') === '1' || undefined,
  };
}
```
```ts
  const scorecard = path.match(/^\/api\/matches\/(.+)\/scorecard$/);
  if (scorecard) {
    const sc = buildScorecardFor(db, decodeURIComponent(scorecard[1]), parseScope(params), loadConfig().seasons, gapMs);
    return sc ? json(200, sc) : json(404, { error: 'match not in store' });
  }
```
(`loadConfig` is already imported in server.ts; `gapMs` is already a `handleApi` param. Import `buildScorecardFor` + `type Scope`.)

- [ ] **Step 4:** Run → PASS (+ run `test/viewerServer*.test.ts` for route-ordering regressions). `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat: GET /api/matches/:id/scorecard (baseline scope from query, 404 when absent)`

---

## Phase 4 — Web: ComparePanel in the detail overlay

### Task 7: api client types + `fetchScorecard`

**Files:** Modify `web/src/api.ts`.
- [ ] **Step 1:** Add types + fetcher (permissive, mirrors the `Scorecard` shape):

```ts
export interface MetricScore { id: string; label: string; polarity: string; value: number | null; mean: number; n: number;
  z: number | null; verdict: string; seasonBest: number | null; isNewBest: boolean; winLikeness: string; }
export interface Scorecard { matchId: string; cohort: { description: string; n: number; wins: number; losses: number };
  metrics: MetricScore[]; }
export interface BaselineQuery { mode: 'overall' | 'games' | 'sessions'; n?: number;
  comp?: boolean; map?: boolean; ratingBand?: number; timeOfDay?: number; season?: boolean; }
const RATE_IDS = new Set(['damageDone','healingDone','interruptsLanded','interruptsSuffered','ccDone.hardCcSec','ccReceived.hardCcSec','ccReceived.timeSec','spacing.isolatedSec','spacing.meleeRangeSec','precognitionUptimeSec','enemyPrecognitionUptimeSec']);
export const isRateMetric = (id: string) => RATE_IDS.has(id);
export async function fetchScorecard(id: string, b: BaselineQuery): Promise<Scorecard> {
  const p = new URLSearchParams({ mode: b.mode });
  if (b.n !== undefined) p.set('n', String(b.n));
  for (const k of ['comp','map','season'] as const) if (b[k]) p.set(k, '1');
  if (b.ratingBand !== undefined) p.set('ratingBand', String(b.ratingBand));
  if (b.timeOfDay !== undefined) p.set('timeOfDay', String(b.timeOfDay));
  const r = await fetch(`/api/matches/${encodeURIComponent(id)}/scorecard?${p}`);
  if (r.status === 404) throw new Error('not-in-store');
  if (!r.ok) throw new Error(`/scorecard ${r.status}`);
  return r.json() as Promise<Scorecard>;
}
```
(`isRateMetric` lets the table append `/min`; keep the id list in sync with the server's `rate` flags — note this duplication in a comment.)

- [ ] **Step 2:** `cd web && npx tsc --noEmit`. Commit `feat(web): Scorecard types + fetchScorecard client`.

### Task 8: `CompareControl`

**Files:** Create `web/src/components/CompareControl.tsx`. Test: `web/src/components/CompareControl.test.tsx`
- [ ] **Step 1: failing test** — render with a baseline + `onChange` spy; click "Past games", assert `onChange` called with `{mode:'games', ...}`; toggle the "Same comp" chip → `comp:true`; change the N select → `n` updates.
- [ ] **Step 2:** Run from web/ → FAIL.
- [ ] **Step 3:** Implement a controlled component: props `{ baseline: BaselineQuery; onChange: (b: BaselineQuery) => void }`. Segmented mode buttons (Overall / Past games / Past sessions), an `n` `<select>` (games: 10/20/50/All→omit n; sessions: 1/2/3/All), and filter chips (`comp`, `map`, `ratingBand` 100, `timeOfDay` 2, `season`) that toggle the corresponding field. Emits a new `BaselineQuery` on every change. (Mirror the approved mockup markup/classes.)
- [ ] **Step 4:** Run → PASS. Web tsc.
- [ ] **Step 5:** Commit `feat(web): CompareControl (mode + N + filter chips)`

### Task 9: `ScorecardTable`

**Files:** Create `web/src/components/ScorecardTable.tsx`. Test: `web/src/components/ScorecardTable.test.tsx`
- [ ] **Step 1: failing test** — render a `Scorecard` fixture with a rate metric (`damageDone`) and a descriptive metric (`precognitionUptimeSec`, `winLikeness:'win-like'`). Assert: a rate row shows a `/min` unit; verdict text has the right class (`better`/`worse`/`descriptive`→`info`); the win/loss lean renders; a `★` shows when `isNewBest`; an "insufficient"/small-baseline note shows when `cohort.n < 5`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: a table mapping `scorecard.metrics`; `fmtNum`/`fmtSeconds` for values, append `/min` when `isRateMetric(m.id)`; verdict→class map (`better`→`v-better`, `worse`→`v-worse`, `average`→`v-avg`, `descriptive`→`v-info`, `insufficient`→`v-avg`); win/loss lean→class; `★` when `isNewBest`; a baseline summary line from `cohort.description`/`n`/`wins`/`losses` and a small-baseline note when `n < 5`. Add the verdict/lean CSS to `styles.css` (mirror the mockup colors).
- [ ] **Step 4:** Run → PASS. Web tsc.
- [ ] **Step 5:** Commit `feat(web): ScorecardTable (rate /min, verdict + win/loss colors, season-best, small-baseline note)`

### Task 10: `ComparePanel` in `DetailView`

**Files:** Create `web/src/components/ComparePanel.tsx`; modify `web/src/components/DetailView.tsx`, `web/src/styles.css`. Test: `web/src/components/ComparePanel.test.tsx`
- [ ] **Step 1: failing test** — mock `fetchScorecard` (vi.mock the api module) to resolve a fixture; render `ComparePanel` with a `matchId`; assert it fetches with the default baseline (`mode:'overall'`) and renders the table; simulate a `not-in-store` reject → asserts the "not in store" message.
- [ ] **Step 2:** Run from web/ → FAIL.
- [ ] **Step 3:** Implement `ComparePanel({ matchId })`: holds `baseline` state (default `{mode:'overall'}`), an effect that `fetchScorecard(matchId, baseline)` on change with an `ignore` cleanup guard (mirror App's detail fetch), renders `<CompareControl baseline onChange={setBaseline} />` + loading/error(`not-in-store`)/`<ScorecardTable>`. In `DetailView`, render `<ComparePanel matchId={detail-match-id} />` below the timeline. (The detail payload doesn't carry its own match id today — thread the selected match id into `DetailView` as a prop from `App` alongside `detail`.)
- [ ] **Step 4:** Run → PASS. Web tsc + full web suite + `npx vite build`.
- [ ] **Step 5:** Commit `feat(web): ComparePanel — comparative scorecard in the detail overlay`

---

## Phase 5 — Re-ingest, verify, gates, finish

### Task 11: build, re-ingest, end-to-end verify
- [ ] Root suite (`NODE_OPTIONS=--experimental-sqlite npx vitest run --no-file-parallelism`), web suite, both `tsc`, `vite build` → all green.
- [ ] Re-ingest (new healer metric): `npm run ingest-db` (bare). If the sidecar scan stalls, ingest with a videoDirs-disabled config / sample dir (as used during dev).
- [ ] `npm run viewer` → open a match's detail overlay → the **ComparePanel**: switch modes (Overall / Past N games / Past N sessions), toggle filters, confirm the scorecard re-fetches and the rate metrics show `/min`, descriptive metrics show a win/loss lean, and `Avg dist from healer` populates.
- [ ] Spot-check: a long vs short match no longer skews the damage verdict (rate-normalized).

### Task 12: quality gates + finish
- [ ] `/simplify` then `/code-review` over `git diff origin/master...HEAD`; address findings (watch the recency session-index logic, the rate-normalization cohort drops, and the api↔server scope contract).
- [ ] `finishing-a-development-branch` → push `feat/baselines-comparative-scorecard` + open PR (note the one-time re-ingest for the healer metric).

---

## Self-Review (plan vs spec)

- **Coverage:** baseline model (Scope recency) = Task 2; rate verdicting + win-likeness = Task 3; durationSec = Task 1; healer metric = Tasks 4–5; endpoint = Task 6; panel = Tasks 7–10; re-ingest/verify = 11; gates/finish = 12. All spec sections A–F mapped.
- **Type consistency:** `Scope.lastNGames/lastNSessions` (T2) used by `buildScorecard`/endpoint (T3/T6); `PlayerMatch.durationSec` (T1) used by rate normalization (T3) and session sizing (T2); `avgHealerDistanceYd` (T4) persisted (T5) and shown (T9); `BaselineQuery`/`Scorecard` (T7) consumed by `CompareControl`/`ScorecardTable`/`ComparePanel` (T8–T10); `/scorecard` query params match `parseScope` (T6) ↔ `fetchScorecard` (T7).
- **Flagged soft spots:** the `lastNSessions` session-index derivation (Session has no member list — derive via the gap-split rule, T2 NOTE); the `isRateMetric` id list duplicated client-side (kept in sync by comment, T7); the bare `UnitMetrics`/`PlayerMatch` test fixtures need the new fields (T1/T4 steps). Each task calls this out.
- **No placeholders:** every code step has real code except the explicitly-flagged `lastNSessions` membership derivation, which has a precise NOTE on how to compute it.
