# Match Viewer — Foundation + Browser — Implementation Plan

> **For agentic workers (FRESH SESSION):** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **PREREQUISITE:** Depends on the merged match store (PR #16, `src/store/`) and scorecard (PR #17). Work on branch `feat/match-viewer-foundation` (already cut from `origin/master`). Spec: `docs/superpowers/specs/2026-06-05-match-viewer-foundation-design.md`.

**Goal:** A local web app (Node API server + React/Vite SPA) that lists ingested arena matches from the store, filters/sorts them, groups them into queue-sessions, and shows a per-match summary drawer.

**Architecture:** A read-only Node `http` API over the existing SQLite store (`src/viewer/`), pure label/session modules (`src/metadata/`, `src/store/sessions.ts`), and a separate React+Vite SPA under `web/` whose toolchain is isolated from the buildless Node code.

**Tech Stack:** TypeScript ESM (NodeNext, local imports end `.js`) for `src/`; `node:sqlite` via `src/store/sqlite.js` (needs `--experimental-sqlite`); Vitest + tsx. The `web/` app: React 18, Vite, TypeScript (bundler resolution, jsx), Vitest + Testing Library + jsdom.

**Commands:**
- Type-check (Node): `npx tsc --noEmit`
- Pure tests: `npx vitest run test/<file> --no-file-parallelism`
- SQLite tests: `NODE_OPTIONS=--experimental-sqlite npx vitest run test/<file> --no-file-parallelism`
- NEVER bare `npx vitest run` / `npm test` (oversubscribes workers, hangs).
- `web/` tests (run inside `web/`): `cd web && npx vitest run <file>` (jsdom; no sqlite flag).

---

## File Structure

**Backend (`src/`, `scripts/`):**
- **Modify** `src/config.ts` — add `sessionGapMinutes` (default 30).
- **Create** `scripts/import-specs.mjs` → committed `src/metadata/specs.json` (spec id → class/spec, parsed from the vendored `CombatUnitSpec` enum).
- **Create** `scripts/import-maps.mjs` → committed `src/metadata/arenas.json` (zone id → arena name, parsed from vendored `zoneMetadata.ts`).
- **Create** `src/metadata/specs.ts` — pure resolvers `specLabel(id)`, `compLabel(sig)`.
- **Create** `src/metadata/arenas.ts` — pure resolver `mapName(zoneId)`.
- **Create** `src/store/sessions.ts` — `Session` type + pure `sessionize(matches, gapMs)`.
- **Create** `src/viewer/types.ts` — `MatchSummary`, `SessionSummary`, `FilterOptions`, `MatchQuery`.
- **Create** `src/viewer/queries.ts` — `loadFilterOptions`, `loadViewerMatches`, `loadMatchScalars`.
- **Create** `src/viewer/server.ts` — pure `handleApi(db, method, path, params)` + `startServer`.
- **Create** `scripts/viewer-dev.mjs` — spawns API server + Vite together.
- **Modify** `package.json` — `viewer`, `viewer:dev` scripts.

**Frontend (`web/`):** own `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/format.ts`, `src/styles.css`, `src/components/{FilterRail,MatchTable,SummaryDrawer}.tsx`, and colocated `*.test.tsx`.

**Tests (`test/`):** `configSessionGap`, `metadataSpecs`, `metadataArenas`, `sessions`, `viewerQueries` (sqlite), `viewerServer` (sqlite).

---

## Task 1: config.sessionGapMinutes

**Files:** Modify `src/config.ts`; Test `test/configSessionGap.test.ts`.

- [ ] **Step 1: Failing test** — `test/configSessionGap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

mkdirSync('test-data', { recursive: true });
const TMP = 'test-data/tmp-config-sessiongap.json';
function withConfig(obj: unknown): ReturnType<typeof loadConfig> {
  writeFileSync(TMP, JSON.stringify(obj));
  try { return loadConfig(TMP); } finally { rmSync(TMP, { force: true }); }
}
const base = { sampleLogsDir: 'x', outputDir: 'o', player: { name: 'P', realm: 'R' } };

describe('loadConfig sessionGapMinutes', () => {
  it('defaults to 30 when absent', () => {
    expect(withConfig(base).sessionGapMinutes).toBe(30);
  });
  it('reads a positive number', () => {
    expect(withConfig({ ...base, sessionGapMinutes: 45 }).sessionGapMinutes).toBe(45);
  });
  it('rejects a non-positive or non-finite value', () => {
    expect(() => withConfig({ ...base, sessionGapMinutes: 0 })).toThrow(/sessionGapMinutes/);
    expect(() => withConfig({ ...base, sessionGapMinutes: 'x' })).toThrow(/sessionGapMinutes/);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run test/configSessionGap.test.ts --no-file-parallelism` → FAIL (`sessionGapMinutes` undefined).

- [ ] **Step 3: Implement.** In `src/config.ts`, add to the `Config` interface: `sessionGapMinutes: number;`. Read `src/config.ts` first. Before the return, add:
```ts
  let sessionGapMinutes = 30;
  if (raw.sessionGapMinutes !== undefined) {
    if (typeof raw.sessionGapMinutes !== 'number' || !Number.isFinite(raw.sessionGapMinutes) || raw.sessionGapMinutes <= 0) {
      throw new Error('Config error: "sessionGapMinutes" must be a positive number');
    }
    sessionGapMinutes = raw.sessionGapMinutes;
  }
```
Add `sessionGapMinutes,` to the returned object literal.

- [ ] **Step 4: Run** → PASS (3/3). `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/config.ts test/configSessionGap.test.ts
git commit -m "$(printf 'feat: config.sessionGapMinutes (default 30)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: Spec label generator + resolver

**Files:** Create `scripts/import-specs.mjs`, `src/metadata/specs.ts`; generate `src/metadata/specs.json`; Test `test/metadataSpecs.test.ts`.

- [ ] **Step 1: Write the generator** — `scripts/import-specs.mjs`:

```js
// Regenerate src/metadata/specs.json from the vendored parser's CombatUnitSpec enum.
// Source: vendor/wowarenalogs/packages/parser/src/types.ts (enum keys are `Class_Spec = 'specId'`).
// Refresh upstream per patch: this enum tracks wago.tools DB2 ChrSpecialization.
// Run manually: node scripts/import-specs.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../vendor/wowarenalogs/packages/parser/src/types.ts', import.meta.url));
const OUT = fileURLToPath(new URL('../src/metadata/specs.json', import.meta.url));

const text = readFileSync(SRC, 'utf8');
const body = text.slice(text.indexOf('enum CombatUnitSpec'));
const block = body.slice(body.indexOf('{') + 1, body.indexOf('}'));
const out = {};
for (const m of block.matchAll(/(\w+)\s*=\s*'(\d+)'/g)) {
  const [, key, id] = m;
  if (id === '0') continue; // None
  const us = key.indexOf('_');
  const className = us === -1 ? key : key.slice(0, us);
  const specName = us === -1 ? '' : key.slice(us + 1);
  out[id] = { className, specName };
}
const sorted = Object.fromEntries(Object.keys(out).sort((a, b) => Number(a) - Number(b)).map((k) => [k, out[k]]));
writeFileSync(OUT, JSON.stringify(sorted, null, 0) + '\n');
console.log('imported specs:', Object.keys(sorted).length);
```

- [ ] **Step 2: Run the generator** — `node scripts/import-specs.mjs` → prints a count (~40) and writes `src/metadata/specs.json`. Sanity-check: `node -e "const s=require('./src/metadata/specs.json'); console.log(s['265'])"` → `{ className: 'Warlock', specName: 'Affliction' }`.

- [ ] **Step 3: Failing test** — `test/metadataSpecs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { specLabel, compLabel } from '../src/metadata/specs.js';

describe('specLabel', () => {
  it('resolves a known spec id to a readable short label', () => {
    expect(specLabel('265')).toBe('Affliction');     // specName wins as the short form
    expect(specLabel('105')).toBe('Restoration');
  });
  it('falls back to the raw id for an unknown spec', () => {
    expect(specLabel('999999')).toBe('999999');
  });
});

describe('compLabel', () => {
  it('joins the per-spec labels of a sorted _ -joined comp signature', () => {
    // 105=Druid_Restoration, 265=Warlock_Affliction, 256=Priest_Discipline
    expect(compLabel('105_256_265')).toBe('Restoration·Discipline·Affliction');
  });
  it('returns an empty string for an empty signature', () => {
    expect(compLabel('')).toBe('');
  });
});
```

- [ ] **Step 4: Run, verify fail** — `npx vitest run test/metadataSpecs.test.ts --no-file-parallelism` → FAIL (module not found).

- [ ] **Step 5: Implement** — `src/metadata/specs.ts` (use the repo's `readFileSync` JSON pattern, as in `cooldowns.ts`/`spells.ts` — NOT an import attribute):

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface SpecRow { className: string; specName: string }
const TABLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./specs.json', import.meta.url)), 'utf8'),
) as Record<string, SpecRow>;

/** Short display label for a spec id (the spec name, e.g. '265' -> 'Affliction'); raw id if unknown. */
export function specLabel(id: string): string {
  const row = TABLE[id];
  if (!row) return id;
  return row.specName || row.className || id;
}

/** Readable comp label from a sorted, '_'-joined spec-id signature. '' -> ''. */
export function compLabel(sig: string): string {
  if (sig === '') return '';
  return sig.split('_').map(specLabel).join('·');
}
```

- [ ] **Step 6: Run** → PASS (4/4). `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**
```bash
git add scripts/import-specs.mjs src/metadata/specs.json src/metadata/specs.ts test/metadataSpecs.test.ts
git commit -m "$(printf 'feat: spec-id labels from vendored CombatUnitSpec (generator + resolver)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: Arena map-name generator + resolver

**Files:** Create `scripts/import-maps.mjs`, `src/metadata/arenas.ts`; generate `src/metadata/arenas.json`; Test `test/metadataArenas.test.ts`.

- [ ] **Step 1: Write the generator** — `scripts/import-maps.mjs`:

```js
// Regenerate src/metadata/arenas.json (zoneId -> arena name) from the vendored zoneMetadata.
// Source: vendor/wowarenalogs/packages/shared/src/data/zoneMetadata.ts (mirrors DB2 Map.MapName_lang).
// Run manually: node scripts/import-maps.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../vendor/wowarenalogs/packages/shared/src/data/zoneMetadata.ts', import.meta.url));
const OUT = fileURLToPath(new URL('../src/metadata/arenas.json', import.meta.url));

const text = readFileSync(SRC, 'utf8');
const out = {};
for (const m of text.matchAll(/'(\d+)':\s*\{[\s\S]*?name:\s*'([^']+)'/g)) {
  out[m[1]] = m[2];
}
const sorted = Object.fromEntries(Object.keys(out).sort((a, b) => Number(a) - Number(b)).map((k) => [k, out[k]]));
writeFileSync(OUT, JSON.stringify(sorted, null, 0) + '\n');
console.log('imported arenas:', Object.keys(sorted).length);
```

- [ ] **Step 2: Run the generator** — `node scripts/import-maps.mjs` → prints a count and writes `src/metadata/arenas.json`. Sanity: `node -e "const a=require('./src/metadata/arenas.json'); console.log(a['2547'])"` → `Enigma Crucible`.

- [ ] **Step 3: Failing test** — `test/metadataArenas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapName } from '../src/metadata/arenas.js';

describe('mapName', () => {
  it('resolves a known zone id', () => {
    expect(mapName('2547')).toBe('Enigma Crucible');
  });
  it('falls back to the raw id when unknown', () => {
    expect(mapName('999999')).toBe('999999');
  });
});
```

- [ ] **Step 4: Run, verify fail** → FAIL (module not found).

- [ ] **Step 5: Implement** — `src/metadata/arenas.ts` (same `readFileSync` JSON pattern as `specs.ts`):

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TABLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./arenas.json', import.meta.url)), 'utf8'),
) as Record<string, string>;

/** Arena name for a zone id; the raw id if unknown. */
export function mapName(zoneId: string): string {
  return TABLE[zoneId] ?? zoneId;
}
```

- [ ] **Step 6: Run** → PASS (2/2). `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**
```bash
git add scripts/import-maps.mjs src/metadata/arenas.json src/metadata/arenas.ts test/metadataArenas.test.ts
git commit -m "$(printf 'feat: arena map names from vendored zoneMetadata (generator + resolver)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: Session detection (`sessions.ts`)

**Files:** Create `src/store/sessions.ts`; Test `test/sessions.test.ts`.

- [ ] **Step 1: Failing test** — `test/sessions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sessionize, type SessionInput } from '../src/store/sessions.js';

const MIN = 60_000;
function mk(over: Partial<SessionInput>): SessionInput {
  return { matchId: 'M', startMs: 0, durationSec: 120, rating: 2000, result: 'win', allyCompLabel: 'WLS', ...over };
}

describe('sessionize', () => {
  it('splits when the idle gap (next start - prev end) exceeds the threshold', () => {
    // prev ends at 0 + 120s = 120000; next starts 30min+1ms later -> new session
    const a = mk({ matchId: 'A', startMs: 0, durationSec: 120 });
    const b = mk({ matchId: 'B', startMs: 120_000 + 30 * MIN + 1 });
    const sessions = sessionize([a, b], 30 * MIN);
    expect(sessions.map((s) => s.count)).toEqual([1, 1]);
  });
  it('keeps matches in one session when the gap is within the threshold', () => {
    const a = mk({ matchId: 'A', startMs: 0, durationSec: 120 });
    const b = mk({ matchId: 'B', startMs: 120_000 + 10 * MIN }); // 10min idle < 30min
    const sessions = sessionize([a, b], 30 * MIN);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].count).toBe(2);
  });
  it('summarizes a session: wins/losses, rating span, comps, time span, id', () => {
    const ms = [
      mk({ matchId: 'A', startMs: 0, durationSec: 100, rating: 2000, result: 'win', allyCompLabel: 'WLS' }),
      mk({ matchId: 'B', startMs: 200_000, durationSec: 100, rating: 2016, result: 'loss', allyCompLabel: 'WLDru' }),
    ];
    const [s] = sessionize(ms, 30 * MIN);
    expect(s).toMatchObject({ id: 'A', startMs: 0, endMs: 300_000, count: 2, wins: 1, losses: 1, ratingStart: 2000, ratingEnd: 2016 });
    expect(s.comps.sort()).toEqual(['WLDru', 'WLS']);
  });
  it('sorts unordered input by start time first', () => {
    const sessions = sessionize([mk({ matchId: 'B', startMs: 5 * MIN }), mk({ matchId: 'A', startMs: 0 })], 30 * MIN);
    expect(sessions[0].id).toBe('A');
  });
  it('treats null duration as zero-length for the gap', () => {
    const a = mk({ matchId: 'A', startMs: 0, durationSec: null });
    const b = mk({ matchId: 'B', startMs: 30 * MIN + 1 }); // gap from start (end=start) just over threshold
    expect(sessionize([a, b], 30 * MIN)).toHaveLength(2);
  });
  it('returns [] for no matches', () => {
    expect(sessionize([], 30 * MIN)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail** → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/store/sessions.ts`:

```ts
export interface SessionInput {
  matchId: string;
  startMs: number;
  durationSec: number | null;
  rating: number | null;
  result: string;
  allyCompLabel: string;
}

export interface Session {
  id: string;            // first match id of the session
  startMs: number;       // first match start
  endMs: number;         // last match end (start + duration)
  count: number;
  wins: number;
  losses: number;
  ratingStart: number | null; // first non-null rating
  ratingEnd: number | null;   // last non-null rating
  comps: string[];            // distinct ally comp labels
}

const endOf = (m: SessionInput): number => m.startMs + (m.durationSec ?? 0) * 1000;

/** Group one character's matches into queue-sessions. A new session starts when the idle gap
 *  (next.startMs - prev end) exceeds gapMs. Input need not be sorted. */
export function sessionize(matches: SessionInput[], gapMs: number): Session[] {
  const sorted = [...matches].sort((a, b) => a.startMs - b.startMs);
  const sessions: Session[] = [];
  let cur: SessionInput[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    const comps = [...new Set(cur.map((m) => m.allyCompLabel).filter((c) => c !== ''))];
    const ratings = cur.map((m) => m.rating).filter((r): r is number => r !== null);
    sessions.push({
      id: cur[0].matchId,
      startMs: cur[0].startMs,
      endMs: endOf(cur[cur.length - 1]),
      count: cur.length,
      wins: cur.filter((m) => m.result === 'win').length,
      losses: cur.filter((m) => m.result === 'loss').length,
      ratingStart: ratings.length ? ratings[0] : null,
      ratingEnd: ratings.length ? ratings[ratings.length - 1] : null,
      comps,
    });
    cur = [];
  };
  for (const m of sorted) {
    if (cur.length > 0 && m.startMs - endOf(cur[cur.length - 1]) > gapMs) flush();
    cur.push(m);
  }
  flush();
  return sessions;
}
```

- [ ] **Step 4: Run** → PASS (6/6). `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/store/sessions.ts test/sessions.test.ts
git commit -m "$(printf 'feat: sessionize — group a character matches into queue-sessions (pure)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: Viewer types + store queries (`viewer/queries.ts`)

**Files:** Create `src/viewer/types.ts`, `src/viewer/queries.ts`; Test `test/viewerQueries.test.ts` (SQLite — run with the flag).

- [ ] **Step 1: Create `src/viewer/types.ts`**:

```ts
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
  character?: string;
  bracket?: string;
  myComp?: string;
  enemyComp?: string;
  map?: string;
  result?: string;        // 'win' | 'loss'
  minRating?: number;
  maxRating?: number;
  from?: number;          // startMs >= from
  to?: number;            // startMs <= to
  q?: string;             // free text over comp labels / map name
  sort?: 'startMs' | 'rating' | 'damageDone' | 'dps';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
```

- [ ] **Step 2: Failing test** — `test/viewerQueries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { loadFilterOptions, loadViewerMatches } from '../src/viewer/queries.js';

function seedMatch(db: InstanceType<typeof DatabaseSync>, o: {
  id: string; startMs: number; dur: number; bracket: string; zone: string;
  ally: string; enemy: string; rating: number; result: string; name: string;
  dmg?: number; dps?: number; kicks?: number;
}) {
  db.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,duration_sec,ally_comp_sig,enemy_comp_sig,player_rating,result,player_unit_id,player_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(o.id, o.startMs, o.bracket, o.zone, o.dur, o.ally, o.enemy, o.rating, o.result, 'P', o.name);
  db.prepare(`INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)`)
    .run(o.id, 'P', 'Me', 'R', null, '265', 'friendly', 1);
  const metric = db.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)');
  metric.run(o.id, 'P', 'damageDone', o.dmg ?? 1000);
  metric.run(o.id, 'P', 'dps', o.dps ?? 100);
  metric.run(o.id, 'P', 'interruptsLanded', o.kicks ?? 3);
}

function db() {
  const d = new DatabaseSync(':memory:');
  migrate(d);
  seedMatch(d, { id: 'A', startMs: 1000, dur: 120, bracket: '3v3', zone: '2547', ally: '105_265', enemy: '62_64', rating: 2000, result: 'win', name: 'Me-R' });
  seedMatch(d, { id: 'B', startMs: 5000, dur: 100, bracket: '3v3', zone: '1825', ally: '105_265', enemy: '256_258', rating: 2016, result: 'loss', name: 'Me-R' });
  seedMatch(d, { id: 'C', startMs: 9000, dur: 100, bracket: '2v2', zone: '2547', ally: '265', enemy: '62', rating: 1900, result: 'win', name: 'Alt-R' });
  return d;
}

describe('loadViewerMatches', () => {
  it('returns matches with resolved labels, newest-first by default', () => {
    const ms = loadViewerMatches(db(), {});
    expect(ms.map((m) => m.matchId)).toEqual(['C', 'B', 'A']);
    const a = ms.find((m) => m.matchId === 'A')!;
    expect(a).toMatchObject({ bracket: '3v3', mapName: 'Enigma Crucible', allyCompLabel: 'Restoration·Affliction', result: 'win', rating: 2000 });
    expect(a.damageDone).toBe(1000);
  });
  it('filters by character and bracket', () => {
    expect(loadViewerMatches(db(), { character: 'Me-R', bracket: '3v3' }).map((m) => m.matchId)).toEqual(['B', 'A']);
  });
  it('filters by result and rating band', () => {
    expect(loadViewerMatches(db(), { result: 'win', minRating: 1950 }).map((m) => m.matchId)).toEqual(['A']);
  });
  it('computes ratingDelta vs the previous match for the character within the result set', () => {
    const ms = loadViewerMatches(db(), { character: 'Me-R', sort: 'startMs', order: 'asc' });
    expect(ms.find((m) => m.matchId === 'B')!.ratingDelta).toBe(16); // 2016 - 2000
    expect(ms.find((m) => m.matchId === 'A')!.ratingDelta).toBeNull(); // first
  });
});

describe('loadFilterOptions', () => {
  it('returns distinct characters, brackets, comps, maps, and ranges', () => {
    const o = loadFilterOptions(db());
    expect(o.characters.sort()).toEqual(['Alt-R', 'Me-R']);
    expect(o.brackets.sort()).toEqual(['2v2', '3v3']);
    expect(o.maps.map((m) => m.label)).toContain('Enigma Crucible');
    expect(o.ratingRange).toEqual({ min: 1900, max: 2016 });
  });
});
```

- [ ] **Step 3: Run (WITH flag), verify fail** — `NODE_OPTIONS=--experimental-sqlite npx vitest run test/viewerQueries.test.ts --no-file-parallelism` → FAIL (module not found).

- [ ] **Step 4: Implement** — `src/viewer/queries.ts`:

```ts
import type { DatabaseSync } from '../store/sqlite.js';
import { compLabel } from '../metadata/specs.js';
import { mapName } from '../metadata/arenas.js';
import type { FilterOptions, MatchQuery, MatchSummary } from './types.js';

interface Row {
  match_id: string; start_ms: number | null; duration_sec: number | null; bracket: string | null;
  zone_id: string | null; ally_comp_sig: string | null; enemy_comp_sig: string | null;
  player_rating: number | null; result: string | null; player_name: string | null;
  damageDone: number | null; dps: number | null; interruptsLanded: number | null;
}

const SORT_COLS: Record<NonNullable<MatchQuery['sort']>, string> = {
  startMs: 'm.start_ms', rating: 'm.player_rating', damageDone: 'd.damageDone', dps: 'd.dps',
};

/** Filtered, label-resolved matches. ratingDelta is computed per character over the returned set. */
export function loadViewerMatches(db: DatabaseSync, q: MatchQuery): MatchSummary[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const eq = (col: string, v: string | number | undefined) => { if (v !== undefined && v !== '') { where.push(`${col} = ?`); args.push(v); } };
  eq('m.player_name', q.character);
  eq('m.bracket', q.bracket);
  eq('m.ally_comp_sig', q.myComp);
  eq('m.enemy_comp_sig', q.enemyComp);
  eq('m.zone_id', q.map);
  eq('m.result', q.result);
  if (q.minRating !== undefined) { where.push('m.player_rating >= ?'); args.push(q.minRating); }
  if (q.maxRating !== undefined) { where.push('m.player_rating <= ?'); args.push(q.maxRating); }
  if (q.from !== undefined) { where.push('m.start_ms >= ?'); args.push(q.from); }
  if (q.to !== undefined) { where.push('m.start_ms <= ?'); args.push(q.to); }

  const sortCol = SORT_COLS[q.sort ?? 'startMs'];
  const order = q.order === 'asc' ? 'ASC' : 'DESC';
  const limit = q.limit !== undefined ? ' LIMIT ?' : '';
  const offset = q.offset !== undefined ? ' OFFSET ?' : '';
  const sql =
    `SELECT m.match_id, m.start_ms, m.duration_sec, m.bracket, m.zone_id, m.ally_comp_sig,
            m.enemy_comp_sig, m.player_rating, m.result, m.player_name,
            d.damageDone, d.dps, d.interruptsLanded
     FROM match m
     LEFT JOIN dataset_export d ON d.match_id = m.match_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY ${sortCol} ${order}${limit}${offset}`;
  if (q.limit !== undefined) args.push(q.limit);
  if (q.offset !== undefined) args.push(q.offset);
  const rows = db.prepare(sql).all(...args) as unknown as Row[];

  let mapped: MatchSummary[] = rows.map((r) => ({
    matchId: r.match_id, startMs: r.start_ms, durationSec: r.duration_sec, bracket: r.bracket ?? '',
    character: r.player_name ?? '', mapId: r.zone_id ?? '', mapName: mapName(r.zone_id ?? ''),
    allyComp: r.ally_comp_sig ?? '', allyCompLabel: compLabel(r.ally_comp_sig ?? ''),
    enemyComp: r.enemy_comp_sig ?? '', enemyCompLabel: compLabel(r.enemy_comp_sig ?? ''),
    rating: r.player_rating, ratingDelta: null, result: r.result ?? 'unknown', sessionId: null,
    damageDone: r.damageDone, dps: r.dps, interruptsLanded: r.interruptsLanded,
  }));

  // free-text filter (label-aware) applied in JS after label resolution
  if (q.q) {
    const needle = q.q.toLowerCase();
    mapped = mapped.filter((m) => `${m.allyCompLabel} ${m.enemyCompLabel} ${m.mapName}`.toLowerCase().includes(needle));
  }

  // ratingDelta: per character, in chronological order, vs previous non-null rating
  const byChar = new Map<string, MatchSummary[]>();
  for (const m of [...mapped].sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0))) {
    const arr = byChar.get(m.character) ?? [];
    const prev = arr.length ? arr[arr.length - 1] : undefined;
    if (m.rating !== null && prev && prev.rating !== null) m.ratingDelta = m.rating - prev.rating;
    arr.push(m); byChar.set(m.character, arr);
  }
  return mapped;
}

/** Single match's scalar row for the summary drawer; null if absent. */
export function loadMatchScalars(db: DatabaseSync, matchId: string): MatchSummary | null {
  const rows = loadViewerMatches(db, {}).filter((m) => m.matchId === matchId);
  return rows[0] ?? null;
}

/** Distinct filter values + ranges across the store (optionally scoped to one character). */
export function loadFilterOptions(db: DatabaseSync, character?: string): FilterOptions {
  const all = loadViewerMatches(db, character ? { character } : {});
  const uniq = (xs: string[]) => [...new Set(xs.filter((x) => x !== ''))];
  const comps = (pick: (m: MatchSummary) => [string, string]) => {
    const seen = new Map<string, string>();
    for (const m of all) { const [v, l] = pick(m); if (v !== '' && !seen.has(v)) seen.set(v, l); }
    return [...seen].map(([value, label]) => ({ value, label }));
  };
  const ratings = all.map((m) => m.rating).filter((r): r is number => r !== null);
  const dates = all.map((m) => m.startMs).filter((s): s is number => s !== null);
  return {
    characters: uniq(all.map((m) => m.character)),
    brackets: uniq(all.map((m) => m.bracket)),
    myComps: comps((m) => [m.allyComp, m.allyCompLabel]),
    enemyComps: comps((m) => [m.enemyComp, m.enemyCompLabel]),
    maps: comps((m) => [m.mapId, m.mapName]),
    ratingRange: ratings.length ? { min: Math.min(...ratings), max: Math.max(...ratings) } : null,
    dateRange: dates.length ? { minMs: Math.min(...dates), maxMs: Math.max(...dates) } : null,
  };
}
```

- [ ] **Step 5: Run (WITH flag)** → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**
```bash
git add src/viewer/types.ts src/viewer/queries.ts test/viewerQueries.test.ts
git commit -m "$(printf 'feat: viewer store queries — filtered matches, labels, ratingDelta, filter options\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6: API server (`viewer/server.ts`) + scripts

**Files:** Create `src/viewer/server.ts`, `scripts/viewer-dev.mjs`; Modify `package.json`; Test `test/viewerServer.test.ts` (SQLite — run with the flag).

- [ ] **Step 1: Failing test** — `test/viewerServer.test.ts` (tests the pure `handleApi`; no port binding):

```ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { handleApi } from '../src/viewer/server.js';

function db() {
  const d = new DatabaseSync(':memory:');
  migrate(d);
  d.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,duration_sec,ally_comp_sig,enemy_comp_sig,player_rating,result,player_unit_id,player_name)
    VALUES ('A',1000,'3v3','2547',120,'105_265','62_64',2000,'win','P','Me-R')`).run();
  d.prepare(`INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES ('A','P','Me','R',NULL,'265','friendly',1)`).run();
  d.prepare(`INSERT INTO metric (match_id,scope,metric_id,value) VALUES ('A','P','damageDone',1000)`).run();
  return d;
}

describe('handleApi', () => {
  it('GET /api/matches returns matches + sessions', () => {
    const res = handleApi(db(), 'GET', '/api/matches', new URLSearchParams(''), 30 * 60_000);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.matches[0].matchId).toBe('A');
    expect(body.matches[0].sessionId).toBe('A');
    expect(body.sessions[0]).toMatchObject({ id: 'A', count: 1, wins: 1 });
  });
  it('GET /api/matches honors filters', () => {
    const res = handleApi(db(), 'GET', '/api/matches', new URLSearchParams('result=loss'), 30 * 60_000);
    expect(JSON.parse(res.body).matches).toHaveLength(0);
  });
  it('GET /api/filters returns option lists', () => {
    const res = handleApi(db(), 'GET', '/api/filters', new URLSearchParams(''), 30 * 60_000);
    expect(JSON.parse(res.body).characters).toEqual(['Me-R']);
  });
  it('GET /api/matches/:id returns one match, 404 when absent', () => {
    expect(handleApi(db(), 'GET', '/api/matches/A', new URLSearchParams(''), 30 * 60_000).status).toBe(200);
    expect(handleApi(db(), 'GET', '/api/matches/NOPE', new URLSearchParams(''), 30 * 60_000).status).toBe(404);
  });
  it('404s an unknown api path', () => {
    expect(handleApi(db(), 'GET', '/api/nope', new URLSearchParams(''), 30 * 60_000).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run (WITH flag), verify fail** — `NODE_OPTIONS=--experimental-sqlite npx vitest run test/viewerServer.test.ts --no-file-parallelism` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/viewer/server.ts`:

```ts
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from '../store/sqlite.js';
import { openDb } from '../store/store.js';
import { loadConfig } from '../config.js';
import { loadFilterOptions, loadMatchScalars, loadViewerMatches } from './queries.js';
import { sessionize, type SessionInput } from '../store/sessions.js';
import type { MatchQuery } from './types.js';

export interface ApiResult { status: number; body: string; }

function json(status: number, data: unknown): ApiResult {
  return { status, body: JSON.stringify(data) };
}

function parseQuery(p: URLSearchParams): MatchQuery {
  const num = (k: string) => (p.has(k) && p.get(k) !== '' && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : undefined);
  const str = (k: string) => (p.get(k) || undefined);
  const sort = p.get('sort');
  const order = p.get('order');
  return {
    character: str('character'), bracket: str('bracket'), myComp: str('myComp'), enemyComp: str('enemyComp'),
    map: str('map'), result: str('result'), minRating: num('minRating'), maxRating: num('maxRating'),
    from: num('from'), to: num('to'), q: str('q'),
    sort: (['startMs', 'rating', 'damageDone', 'dps'] as const).find((s) => s === sort),
    order: order === 'asc' ? 'asc' : order === 'desc' ? 'desc' : undefined,
    limit: num('limit'), offset: num('offset'),
  };
}

/** Pure API router over the store. Returns {status, body}. gapMs = session gap. */
export function handleApi(db: DatabaseSync, method: string, path: string, params: URLSearchParams, gapMs: number): ApiResult {
  if (method !== 'GET') return json(405, { error: 'method not allowed' });
  if (path === '/api/filters') return json(200, loadFilterOptions(db, params.get('character') || undefined));
  if (path === '/api/matches') {
    const query = parseQuery(params);
    const matches = loadViewerMatches(db, query);
    // sessions for the effective character (query.character, else the most recent match's character)
    const character = query.character ?? matches[0]?.character;
    let sessions: ReturnType<typeof sessionize> = [];
    if (character) {
      const hist = loadViewerMatches(db, { character }).map<SessionInput>((m) => ({
        matchId: m.matchId, startMs: m.startMs ?? 0, durationSec: m.durationSec,
        rating: m.rating, result: m.result, allyCompLabel: m.allyCompLabel,
      }));
      sessions = sessionize(hist, gapMs);
      // tag each visible match with its sessionId (a match belongs to the session whose [startMs,endMs] covers it)
      for (const m of matches) {
        const s = sessions.find((s) => (m.startMs ?? 0) >= s.startMs && (m.startMs ?? 0) <= s.endMs && m.character === character);
        m.sessionId = s ? s.id : null;
      }
    }
    return json(200, { matches, sessions, total: matches.length });
  }
  const single = path.match(/^\/api\/matches\/(.+)$/);
  if (single) {
    const m = loadMatchScalars(db, decodeURIComponent(single[1]));
    return m ? json(200, m) : json(404, { error: 'match not found' });
  }
  return json(404, { error: 'not found' });
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

/** Start the HTTP server: /api/* via handleApi, everything else from web/dist (SPA fallback). */
export function startServer(db: DatabaseSync, gapMs: number, port: number, distDir: string): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const r = handleApi(db, req.method ?? 'GET', url.pathname, url.searchParams, gapMs);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(r.body);
      return;
    }
    // static SPA
    const rel = normalize(url.pathname).replace(/^([/\\])+/, '');
    let file = join(distDir, rel);
    if (!existsSync(file) || rel === '') file = join(distDir, 'index.html');
    if (!existsSync(file)) { res.writeHead(404); res.end('build the SPA: npm run viewer'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  server.listen(port);
  return server;
}

function main(): void {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath ?? './wow-arena-eye.local.db');
  const gapMs = cfg.sessionGapMinutes * 60_000;
  const port = Number(process.env.WAE_VIEWER_PORT ?? 5174);
  const dist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  startServer(db, gapMs, port, dist);
  console.log(`Viewer API + UI on http://localhost:${port}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}
```

- [ ] **Step 4: Run (WITH flag)** → PASS (5/5). `npx tsc --noEmit` → clean.

- [ ] **Step 5: Dev spawner** — `scripts/viewer-dev.mjs`:

```js
// Run the API server (tsx, --experimental-sqlite) and the Vite dev server together.
// Vite proxies /api -> the API port (configured in web/vite.config.ts). Ctrl-C stops both.
import { spawn } from 'node:child_process';

const opts = { stdio: 'inherit', shell: true };
const api = spawn('node', ['--experimental-sqlite', '--import', 'tsx', 'src/viewer/server.ts'], { ...opts, env: { ...process.env, WAE_VIEWER_PORT: '5174' } });
const web = spawn('npm', ['run', 'dev', '--prefix', 'web'], opts);
const kill = () => { api.kill(); web.kill(); };
process.on('SIGINT', kill); process.on('SIGTERM', kill);
api.on('exit', kill); web.on('exit', kill);
```

- [ ] **Step 6: package.json scripts** — add after `scorecard`:
```json
"viewer": "npm run build --prefix web && node --experimental-sqlite --import tsx src/viewer/server.ts",
"viewer:dev": "node scripts/viewer-dev.mjs",
```

- [ ] **Step 7: Commit**
```bash
git add src/viewer/server.ts scripts/viewer-dev.mjs package.json test/viewerServer.test.ts
git commit -m "$(printf 'feat: viewer API server (handleApi router + static SPA serve) + scripts\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 7: Web app scaffold (`web/`)

**Files:** Create `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css`, `web/src/setupTests.ts`, `web/src/App.test.tsx`. Modify root `.gitignore` (ignore `web/node_modules`, `web/dist`).

- [ ] **Step 1: `web/package.json`**:

```json
{
  "name": "wow-arena-eye-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `web/tsconfig.json`**:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `web/vite.config.ts`** (import `defineConfig` from `vitest/config` so the `test` key is typed):

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:5174' } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.ts'] },
});
```

- [ ] **Step 4: scaffolding files.**
`web/index.html`:
```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Arena Match Viewer</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```
`web/src/setupTests.ts`:
```ts
import '@testing-library/jest-dom';
```
`web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```
`web/src/styles.css`:
```css
:root { color-scheme: dark; --bg:#0f0f14; --panel:#15151c; --line:#23232c; --text:#cdd; --accent:#9cf; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.4 system-ui, sans-serif; }
.win { color:#6d6; font-weight:700; } .loss { color:#e77; font-weight:700; }
```
`web/src/App.tsx` (scaffold — replaced in Task 12):
```tsx
export function App() {
  return <h1>Arena Match Viewer</h1>;
}
```

- [ ] **Step 5: Failing smoke test** — `web/src/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App.js';

it('renders the app title', () => {
  render(<App />);
  expect(screen.getByText('Arena Match Viewer')).toBeInTheDocument();
});
```

- [ ] **Step 6: Install + run.** From repo root: `npm install --prefix web`. Then `cd web && npx vitest run src/App.test.tsx` → PASS (1/1). `cd web && npx tsc --noEmit` → clean.

- [ ] **Step 7: gitignore.** Append to root `.gitignore`: `web/node_modules/` and `web/dist/`. (Do NOT commit `web/node_modules`.)

- [ ] **Step 8: Commit**
```bash
git add web/package.json web/package-lock.json web/tsconfig.json web/vite.config.ts web/index.html web/src/main.tsx web/src/App.tsx web/src/styles.css web/src/setupTests.ts web/src/App.test.tsx .gitignore
git commit -m "$(printf 'feat: web/ React+Vite SPA scaffold (vitest+jsdom, api proxy)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 8: API client + formatters (`web/src/api.ts`, `format.ts`)

**Files:** Create `web/src/api.ts`, `web/src/format.ts`; Test `web/src/format.test.ts`, `web/src/api.test.ts`.

- [ ] **Step 1: Failing test** — `web/src/format.test.ts`:
```ts
import { fmtNum, fmtRatingDelta, fmtDuration, fmtClock } from './format.js';

it('abbreviates large numbers', () => {
  expect(fmtNum(4_200_000)).toBe('4.2M');
  expect(fmtNum(26_100)).toBe('26.1k');
  expect(fmtNum(null)).toBe('—');
});
it('formats a signed rating delta', () => {
  expect(fmtRatingDelta(16)).toBe('+16');
  expect(fmtRatingDelta(-12)).toBe('−12');
  expect(fmtRatingDelta(null)).toBe('');
});
it('formats a duration mm:ss', () => {
  expect(fmtDuration(161)).toBe('2:41');
  expect(fmtDuration(null)).toBe('—');
});
it('formats a clock from epoch ms', () => {
  expect(fmtClock(null)).toBe('—');
  expect(typeof fmtClock(1_000_000)).toBe('string');
});
```

- [ ] **Step 2: Run (in web/), verify fail** — `cd web && npx vitest run src/format.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `web/src/format.ts`:
```ts
export function fmtNum(v: number | null): string {
  if (v === null) return '—';
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + 'k';
  return String(Math.round(v));
}
export function fmtRatingDelta(v: number | null): string {
  if (v === null) return '';
  return v >= 0 ? `+${v}` : `−${Math.abs(v)}`; // U+2212 minus
}
export function fmtDuration(sec: number | null): string {
  if (sec === null) return '—';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtClock(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toLocaleString();
}
```

- [ ] **Step 4: Run** → PASS. 

- [ ] **Step 5: Failing test** — `web/src/api.test.ts`:
```ts
import { vi } from 'vitest';
import { fetchMatches, fetchFilters, type MatchesResponse } from './api.js';

it('fetchMatches builds a query string from non-empty filters and returns JSON', async () => {
  const body: MatchesResponse = { matches: [], sessions: [], total: 0 };
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body)));
  await fetchMatches({ character: 'Me-R', bracket: '3v3', result: '' });
  const url = (spy.mock.calls[0][0] as string);
  expect(url).toContain('/api/matches?');
  expect(url).toContain('character=Me-R');
  expect(url).toContain('bracket=3v3');
  expect(url).not.toContain('result='); // empty omitted
  spy.mockRestore();
});

it('fetchFilters hits /api/filters', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ characters: [] })));
  await fetchFilters();
  expect((spy.mock.calls[0][0] as string)).toContain('/api/filters');
  spy.mockRestore();
});
```

- [ ] **Step 6: Run, verify fail** → FAIL (module not found).

- [ ] **Step 7: Implement** — `web/src/api.ts`:
```ts
// Mirror of src/viewer/types.ts (kept in sync by hand; small + stable).
export interface MatchSummary {
  matchId: string; startMs: number | null; durationSec: number | null; bracket: string; character: string;
  mapId: string; mapName: string; allyComp: string; allyCompLabel: string; enemyComp: string; enemyCompLabel: string;
  rating: number | null; ratingDelta: number | null; result: string; sessionId: string | null;
  damageDone: number | null; dps: number | null; interruptsLanded: number | null;
}
export interface SessionSummary {
  id: string; startMs: number; endMs: number; count: number; wins: number; losses: number;
  ratingStart: number | null; ratingEnd: number | null; comps: string[];
}
export interface FilterOptions {
  characters: string[]; brackets: string[];
  myComps: { value: string; label: string }[]; enemyComps: { value: string; label: string }[];
  maps: { value: string; label: string }[];
  ratingRange: { min: number; max: number } | null; dateRange: { minMs: number; maxMs: number } | null;
}
export interface MatchesResponse { matches: MatchSummary[]; sessions: SessionSummary[]; total: number; }
export type Filters = Record<string, string>;

function qs(filters: Filters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}
export async function fetchMatches(filters: Filters): Promise<MatchesResponse> {
  const r = await fetch(`/api/matches${qs(filters)}`);
  return r.json() as Promise<MatchesResponse>;
}
export async function fetchFilters(character?: string): Promise<FilterOptions> {
  const r = await fetch(`/api/filters${character ? `?character=${encodeURIComponent(character)}` : ''}`);
  return r.json() as Promise<FilterOptions>;
}
```

- [ ] **Step 8: Run** → PASS. `cd web && npx tsc --noEmit` → clean.

- [ ] **Step 9: Commit**
```bash
git add web/src/format.ts web/src/format.test.ts web/src/api.ts web/src/api.test.ts
git commit -m "$(printf 'feat(web): api client + value formatters\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 9: FilterRail component

**Files:** Create `web/src/components/FilterRail.tsx`; Test `web/src/components/FilterRail.test.tsx`.

- [ ] **Step 1: Failing test** — `web/src/components/FilterRail.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterRail } from './FilterRail.js';
import type { FilterOptions } from '../api.js';

const opts: FilterOptions = {
  characters: ['Me-R', 'Alt-R'], brackets: ['3v3', '2v2'],
  myComps: [{ value: '105_265', label: 'Resto·Affli' }],
  enemyComps: [{ value: '62_64', label: 'Arcane·Frost' }],
  maps: [{ value: '2547', label: 'Enigma Crucible' }],
  ratingRange: { min: 1900, max: 2100 }, dateRange: null,
};

it('renders character and bracket options and reports changes', () => {
  const onChange = vi.fn();
  render(<FilterRail options={opts} filters={{}} onChange={onChange} />);
  expect(screen.getByText('Enigma Crucible')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Character'), { target: { value: 'Me-R' } });
  expect(onChange).toHaveBeenCalledWith({ character: 'Me-R' });
});

it('toggling a result checkbox updates the filter', () => {
  const onChange = vi.fn();
  render(<FilterRail options={opts} filters={{ result: 'win' }} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText('Loss'));
  expect(onChange).toHaveBeenCalledWith({ result: '' }); // win+loss = no filter
});
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement** — `web/src/components/FilterRail.tsx`:
```tsx
import type { FilterOptions, Filters } from '../api.js';

interface Props { options: FilterOptions; filters: Filters; onChange: (patch: Filters) => void; }

export function FilterRail({ options, filters, onChange }: Props) {
  const set = (k: string, v: string) => onChange({ [k]: v });
  // result is two checkboxes; empty = both
  const winOn = filters.result !== 'loss';
  const lossOn = filters.result !== 'win';
  const toggleResult = (side: 'win' | 'loss') => {
    const next = { win: winOn, loss: lossOn, [side]: side === 'win' ? !winOn : !lossOn };
    onChange({ result: next.win && next.loss ? '' : next.win ? 'win' : next.loss ? 'loss' : '' });
  };
  const sel = (label: string, key: string, items: { value: string; label: string }[]) => (
    <div className="grp">
      <label className="label" htmlFor={key}>{label}</label>
      <select id={key} value={filters[key] ?? ''} onChange={(e) => set(key, e.target.value)}>
        <option value="">All</option>
        {items.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
      </select>
    </div>
  );
  return (
    <aside className="rail">
      {sel('Character', 'character', options.characters.map((c) => ({ value: c, label: c })))}
      {sel('Bracket', 'bracket', options.brackets.map((b) => ({ value: b, label: b })))}
      <div className="grp">
        <span className="label">Result</span>
        <label><input type="checkbox" aria-label="Win" checked={winOn} onChange={() => toggleResult('win')} /> Win</label>
        <label><input type="checkbox" aria-label="Loss" checked={lossOn} onChange={() => toggleResult('loss')} /> Loss</label>
      </div>
      {sel('My comp', 'myComp', options.myComps)}
      {sel('Enemy comp', 'enemyComp', options.enemyComps)}
      {sel('Map', 'map', options.maps)}
      <div className="grp">
        <label className="label" htmlFor="q">Search</label>
        <input id="q" value={filters.q ?? ''} onChange={(e) => set('q', e.target.value)} placeholder="comp / map…" />
      </div>
    </aside>
  );
}
```
Add to `web/src/styles.css`: `.rail{width:160px;flex:0 0 160px;background:var(--panel);padding:10px;border-radius:6px}.rail .grp{margin-bottom:10px;display:flex;flex-direction:column;gap:3px}.rail .label{color:#889;font-size:10px;text-transform:uppercase}.rail select,.rail input{background:#1c1c26;color:var(--text);border:1px solid var(--line);border-radius:4px;padding:3px}`.

- [ ] **Step 4: Run** → PASS. `cd web && npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add web/src/components/FilterRail.tsx web/src/components/FilterRail.test.tsx web/src/styles.css
git commit -m "$(printf 'feat(web): FilterRail — character/bracket/comp/map/result/search controls\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 10: MatchTable + session separators

**Files:** Create `web/src/components/MatchTable.tsx`; Test `web/src/components/MatchTable.test.tsx`.

- [ ] **Step 1: Failing test** — `web/src/components/MatchTable.test.tsx`:
```tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MatchTable } from './MatchTable.js';
import type { MatchSummary, SessionSummary } from '../api.js';

function m(over: Partial<MatchSummary>): MatchSummary {
  return { matchId: 'A', startMs: 1000, durationSec: 120, bracket: '3v3', character: 'Me-R', mapId: '2547',
    mapName: 'Enigma Crucible', allyComp: 'x', allyCompLabel: 'WLS', enemyComp: 'y', enemyCompLabel: 'RMP',
    rating: 2000, ratingDelta: 14, result: 'win', sessionId: 'A', damageDone: 4_200_000, dps: 26_000,
    interruptsLanded: 3, ...over };
}
const sessions: SessionSummary[] = [{ id: 'A', startMs: 1000, endMs: 2000, count: 2, wins: 1, losses: 1, ratingStart: 2000, ratingEnd: 2016, comps: ['WLS'] }];

it('renders a session header row and its matches, no Deaths column', () => {
  render(<MatchTable matches={[m({ matchId: 'A' }), m({ matchId: 'B', result: 'loss', ratingDelta: -12 })]} sessions={sessions} selectedId={null} onSelect={() => {}} />);
  expect(screen.getByText(/1W–1L/)).toBeInTheDocument();
  expect(screen.getByText('Enigma Crucible')).toBeInTheDocument();
  expect(screen.queryByText('Deaths')).toBeNull();
  expect(screen.getByText('4.2M')).toBeInTheDocument();
});

it('clicking a row calls onSelect with the match id', () => {
  const onSelect = vi.fn();
  render(<MatchTable matches={[m({ matchId: 'A' })]} sessions={sessions} selectedId={null} onSelect={onSelect} />);
  fireEvent.click(screen.getByText('Enigma Crucible'));
  expect(onSelect).toHaveBeenCalledWith('A');
});

it('shows an empty state when there are no matches', () => {
  render(<MatchTable matches={[]} sessions={[]} selectedId={null} onSelect={() => {}} />);
  expect(screen.getByText(/No matches/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement** — `web/src/components/MatchTable.tsx`:
```tsx
import type { MatchSummary, SessionSummary } from '../api.js';
import { fmtNum, fmtRatingDelta, fmtClock } from '../format.js';

interface Props {
  matches: MatchSummary[]; sessions: SessionSummary[];
  selectedId: string | null; onSelect: (id: string) => void;
}

function SessionHeader({ s }: { s: SessionSummary }) {
  const delta = s.ratingStart !== null && s.ratingEnd !== null ? s.ratingEnd - s.ratingStart : null;
  return (
    <tr className="sep"><td colSpan={8}>
      ▸ session · {fmtClock(s.startMs)} · {s.count} games · <span className="win">{s.wins}W</span>–<span className="loss">{s.losses}L</span>
      {delta !== null ? ` · ${fmtRatingDelta(delta)}` : ''} · {s.comps.join(', ')}
    </td></tr>
  );
}

export function MatchTable({ matches, sessions, selectedId, onSelect }: Props) {
  if (matches.length === 0) return <div className="empty">No matches yet — run <code>npm run ingest-db</code>.</div>;
  const order = sessions.map((s) => s.id);
  const bySession = new Map<string, MatchSummary[]>();
  for (const m of matches) {
    const key = m.sessionId ?? '∅';
    (bySession.get(key) ?? bySession.set(key, []).get(key)!).push(m);
  }
  const groups = [...bySession.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return (
    <table className="matches">
      <thead><tr>
        <th>When</th><th>R</th><th>My comp</th><th>Enemy</th><th>Map</th><th>Rating</th><th>Dmg</th><th>Kicks</th>
      </tr></thead>
      <tbody>
        {groups.flatMap((key) => {
          const s = sessions.find((s) => s.id === key);
          const rows = bySession.get(key)!;
          return [
            s ? <SessionHeader key={`s-${key}`} s={s} /> : null,
            ...rows.map((m) => (
              <tr key={m.matchId} className={m.matchId === selectedId ? 'sel' : ''} onClick={() => onSelect(m.matchId)}>
                <td>{fmtClock(m.startMs)}</td>
                <td className={m.result === 'win' ? 'win' : 'loss'}>{m.result === 'win' ? 'W' : 'L'}</td>
                <td>{m.allyCompLabel}</td><td>{m.enemyCompLabel}</td><td>{m.mapName}</td>
                <td>{m.rating ?? '—'} {fmtRatingDelta(m.ratingDelta)}</td>
                <td>{fmtNum(m.damageDone)}</td><td>{m.interruptsLanded ?? '—'}</td>
              </tr>
            )),
          ];
        })}
      </tbody>
    </table>
  );
}
```
Add to `web/src/styles.css`: `.matches{width:100%;border-collapse:collapse}.matches td,.matches th{padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;font-size:12px}.matches tbody tr:hover{background:#1a1a24;cursor:pointer}.matches .sel{background:#1a2740}.sep td{background:#181826;color:#aac;font-size:11px}.empty{padding:30px;color:#889}`.

- [ ] **Step 4: Run** → PASS. `cd web && npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add web/src/components/MatchTable.tsx web/src/components/MatchTable.test.tsx web/src/styles.css
git commit -m "$(printf 'feat(web): MatchTable with session separators (no Deaths column)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 11: SummaryDrawer

**Files:** Create `web/src/components/SummaryDrawer.tsx`; Test `web/src/components/SummaryDrawer.test.tsx`.

- [ ] **Step 1: Failing test** — `web/src/components/SummaryDrawer.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { SummaryDrawer } from './SummaryDrawer.js';
import type { MatchSummary } from '../api.js';

const m: MatchSummary = { matchId: 'A', startMs: 1000, durationSec: 161, bracket: '3v3', character: 'Me-R',
  mapId: '2547', mapName: 'Enigma Crucible', allyComp: 'x', allyCompLabel: 'WLS', enemyComp: 'y', enemyCompLabel: 'RMP',
  rating: 2008, ratingDelta: -12, result: 'loss', sessionId: 'A', damageDone: 4_200_000, dps: 26_100, interruptsLanded: 3 };

it('renders nothing when no match is selected', () => {
  const { container } = render(<SummaryDrawer match={null} />);
  expect(container).toBeEmptyDOMElement();
});
it('shows matchup, map, rating, duration and stats for the selected match', () => {
  render(<SummaryDrawer match={m} />);
  expect(screen.getByText(/WLS vs RMP/)).toBeInTheDocument();
  expect(screen.getByText('Enigma Crucible')).toBeInTheDocument();
  expect(screen.getByText('2:41')).toBeInTheDocument();
  expect(screen.getByText('4.2M')).toBeInTheDocument();
  expect(screen.getByText(/full detail/i)).toBeInTheDocument(); // inert affordance for sub-project B
});
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement** — `web/src/components/SummaryDrawer.tsx`:
```tsx
import type { MatchSummary } from '../api.js';
import { fmtNum, fmtDuration, fmtRatingDelta } from '../format.js';

function Row({ k, v }: { k: string; v: string }) {
  return <div className="drow"><span className="dk">{k}</span><span>{v}</span></div>;
}

export function SummaryDrawer({ match: m }: { match: MatchSummary | null }) {
  if (!m) return null;
  return (
    <aside className="drawer">
      <div className="dhead"><span className={m.result === 'win' ? 'win' : 'loss'}>{m.result.toUpperCase()}</span></div>
      <Row k="Matchup" v={`${m.allyCompLabel} vs ${m.enemyCompLabel}`} />
      <Row k="Map" v={m.mapName} />
      <Row k="Rating" v={`${m.rating ?? '—'} ${fmtRatingDelta(m.ratingDelta)}`} />
      <Row k="Duration" v={fmtDuration(m.durationSec)} />
      <Row k="Damage" v={fmtNum(m.damageDone)} />
      <Row k="DPS" v={fmtNum(m.dps)} />
      <Row k="Kicks" v={m.interruptsLanded === null ? '—' : String(m.interruptsLanded)} />
      <div className="soon">Open full detail → (coming in B)<br />Compare to history → (coming in C)</div>
    </aside>
  );
}
```
Add to `web/src/styles.css`: `.drawer{width:210px;flex:0 0 210px;background:#13131a;border-left:1px solid var(--line);padding:12px;border-radius:6px}.drow{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #20202a;font-size:12px}.dk{color:#889}.dhead{font-weight:700;margin-bottom:6px}.soon{margin-top:10px;padding:7px;border:1px dashed #556;border-radius:6px;color:#99a;font-size:11px;text-align:center}`.

- [ ] **Step 4: Run** → PASS. `cd web && npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add web/src/components/SummaryDrawer.tsx web/src/components/SummaryDrawer.test.tsx web/src/styles.css
git commit -m "$(printf 'feat(web): SummaryDrawer — scalar preview + inert B/C affordances\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 12: App wiring + URL state

**Files:** Modify `web/src/App.tsx`; Test `web/src/App.test.tsx` (replace the smoke test).

- [ ] **Step 1: Replace the test** — `web/src/App.test.tsx`:
```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from './App.js';
import type { FilterOptions, MatchesResponse } from './api.js';

const filters: FilterOptions = { characters: ['Me-R'], brackets: ['3v3'], myComps: [], enemyComps: [],
  maps: [{ value: '2547', label: 'Enigma Crucible' }], ratingRange: { min: 1900, max: 2100 }, dateRange: null };
const matches: MatchesResponse = {
  matches: [{ matchId: 'A', startMs: 1000, durationSec: 161, bracket: '3v3', character: 'Me-R', mapId: '2547',
    mapName: 'Enigma Crucible', allyComp: 'x', allyCompLabel: 'WLS', enemyComp: 'y', enemyCompLabel: 'RMP',
    rating: 2008, ratingDelta: -12, result: 'loss', sessionId: 'A', damageDone: 4_200_000, dps: 26_100, interruptsLanded: 3 }],
  sessions: [{ id: 'A', startMs: 1000, endMs: 2000, count: 1, wins: 0, losses: 1, ratingStart: 2008, ratingEnd: 2008, comps: ['WLS'] }],
  total: 1,
};

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = String(url);
    const body = u.includes('/api/filters') ? filters : matches;
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
});

it('loads matches and opens the drawer on row click', async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByText('Enigma Crucible')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Enigma Crucible'));
  await waitFor(() => expect(screen.getByText(/WLS vs RMP/)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run, verify fail** → FAIL (App is still the scaffold).

- [ ] **Step 3: Implement** — `web/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { FilterRail } from './components/FilterRail.js';
import { MatchTable } from './components/MatchTable.js';
import { SummaryDrawer } from './components/SummaryDrawer.js';
import { fetchFilters, fetchMatches, type FilterOptions, type Filters, type MatchesResponse, type MatchSummary } from './api.js';

function readUrlFilters(): Filters {
  const out: Filters = {};
  new URLSearchParams(location.search).forEach((v, k) => { out[k] = v; });
  return out;
}
function writeUrlFilters(f: Filters) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
}

export function App() {
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [filters, setFilters] = useState<Filters>(readUrlFilters);
  const [data, setData] = useState<MatchesResponse>({ matches: [], sessions: [], total: 0 });
  const [selected, setSelected] = useState<MatchSummary | null>(null);

  useEffect(() => { void fetchFilters().then(setOptions); }, []);
  useEffect(() => { writeUrlFilters(filters); void fetchMatches(filters).then(setData); }, [filters]);

  const onChange = (patch: Filters) => { setSelected(null); setFilters((f) => ({ ...f, ...patch })); };

  return (
    <div className="app">
      <h1>Arena Match Viewer</h1>
      <div className="layout">
        {options && <FilterRail options={options} filters={filters} onChange={onChange} />}
        <div className="main">
          <MatchTable matches={data.matches} sessions={data.sessions} selectedId={selected?.matchId ?? null}
            onSelect={(id) => setSelected(data.matches.find((m) => m.matchId === id) ?? null)} />
        </div>
        <SummaryDrawer match={selected} />
      </div>
    </div>
  );
}
```
Add to `web/src/styles.css`: `.app{padding:14px}.app h1{font-size:18px;margin:0 0 12px}.layout{display:flex;gap:12px;align-items:flex-start}.main{flex:1;min-width:0}`.

- [ ] **Step 4: Run** → PASS. `cd web && npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add web/src/App.tsx web/src/App.test.tsx web/src/styles.css
git commit -m "$(printf 'feat(web): App wiring — filters in URL, table + drawer\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## After all tasks (controller)

1. Node suite green: `NODE_OPTIONS=--experimental-sqlite npx vitest run --no-file-parallelism`; `npx tsc --noEmit` clean.
2. Web suite green: `cd web && npx vitest run`; `cd web && npx tsc --noEmit` clean; `cd web && npx vite build` succeeds (produces `web/dist`).
3. Gates: `/simplify` then `/code-review` on the branch diff; address findings.
4. Smoke (needs a populated `.local.db`): `npm run viewer` → open the printed `http://localhost:5174`, confirm the match list, filters, session headers, and the click drawer. Dev loop: `npm run viewer:dev`.
5. Finish: superpowers:finishing-a-development-branch → push + open a PR.

## Self-Review

- *Spec coverage:* app shape + `web/`/`src/viewer` split (Tasks 6–7); buildless-isolated toolchain (Task 7 `web/` configs); `node:http` server + 4 endpoints (Task 6); `sessionGapMinutes` (Task 1); 30-min end-to-start session rule + global per-character identity (Task 4 `sessionize`; Task 6 tags visible matches over the character's full history); columns incl. **no Deaths** (Task 10); dense table + left rail + drawer (Tasks 9–11); DB2-generator labels for specs/maps (Tasks 2–3); filters/sort/pagination + filter options + ratingDelta (Task 5); URL filter state (Task 12); empty/404/missing-flag error states (Tasks 6, 10). Detail (B), comparison/baselines (C), and replay are deferred.
- *Placeholder scan:* none — every step has concrete code/commands/expected output.
- *Type consistency:* `MatchSummary`/`SessionSummary`/`FilterOptions`/`MatchQuery` defined in `src/viewer/types.ts` (Task 5) and mirrored in `web/src/api.ts` (Task 8) with identical field names; `Session`/`SessionInput`/`sessionize` (Task 4) are consumed unchanged by `server.ts` (Task 6); `compLabel`/`specLabel`/`mapName` (Tasks 2–3) are used by `queries.ts` (Task 5); `fetchMatches`/`fetchFilters` (Task 8) feed `FilterRail`/`MatchTable`/`SummaryDrawer` (Tasks 9–12) with matching props. SQLite-touching tests (`viewerQueries`, `viewerServer`) carry `NODE_OPTIONS=--experimental-sqlite`; pure/web tests do not.
