# Match Browser v2 + Data-Quality Fixes — Implementation Plan

> **For agentic workers (FRESH SESSION):** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **PREREQUISITE:** Depends on the merged store, scorecard, and viewer foundation (PR #18). Branch `feat/match-browser-v2` (already cut from `origin/master`). Spec: `docs/superpowers/specs/2026-06-05-match-browser-v2-design.md`.

**Goal:** Capture true rating (CR) + build_version + pet-attributed kicks in the store (one re-ingest), and add chronological rating deltas, a class→spec comp filter, sort-within-folds, a sum/avg totals footer, and a game-version fold to the browser.

**Architecture:** Phase 1 fixes the data substrate (`src/store/`, `src/cli/ingest-db.ts`); Phase 2 extends the viewer query layer (`src/viewer/`); Phase 3 extends the React SPA (`web/`). Read-only over the store apart from the additive `player_cr` column and the ingest write-path.

**Tech Stack:** TypeScript ESM (NodeNext, local imports end `.js`), `node:sqlite` via `src/store/sqlite.js` (`--experimental-sqlite`), Vitest, tsx; `web/` = React 18 + Vite + Vitest/jsdom.

**Commands:**
- Type-check (root): `npx tsc --noEmit`; (web): `cd web && npx tsc --noEmit`
- Pure root tests: `npx vitest run test/<file> --no-file-parallelism`
- SQLite root tests: `NODE_OPTIONS=--experimental-sqlite npx vitest run test/<file> --no-file-parallelism`
- Web tests: `cd web && npx vitest run src/<file>`
- NEVER a bare `npx vitest run` at the root (hangs).

---

## File Structure

**Phase 1 — data substrate:**
- **Modify** `src/store/schema.ts` — add `player_cr` column + a `migrate()` ALTER-guard for existing DBs.
- **Modify** `src/store/metricRows.ts` — per-metric `combine` flag (player+Σpets for pet-agent actions).
- **Modify** `src/store/store.ts` — capture `player_cr` from the player combatant's `info.personalRating`.
- **Create** `src/util/buildVersion.ts` — `readBuildVersion(logPath)` (reads the log header).
- **Modify** `src/cli/ingest-db.ts` — pass `buildVersion` to `upsertMatch`.

**Phase 2 — viewer queries:**
- **Modify** `src/metadata/specs.ts` — `className(specId)`, `specsOfClass(className)`.
- **Modify** `src/viewer/types.ts` — `MatchSummary` (+cr/crDelta/buildVersion; `rating` stays = MMR), `MatchQuery` (+comp-filter params), `FilterOptions` (+classSpecTree).
- **Modify** `src/viewer/queries.ts` — expose cr/mmr/buildVersion; class→spec EXISTS comp filter; chronological CR/MMR delta enrichment; classSpecTree in filter options.
- **Modify** `src/viewer/server.ts` — parse the new comp-filter params.

**Phase 3 — SPA:**
- **Modify** `web/src/api.ts` — mirror the new types/params; `toParams` keeps array-ish comma params.
- **Create** `web/src/components/CompFilterTree.tsx` — popover class→spec tree.
- **Modify** `web/src/components/FilterRail.tsx` — host the two trees; drop the comp dropdowns.
- **Modify** `web/src/components/MatchTable.tsx` — CR/MMR columns+deltas, version fold, sortable headers, totals footer.
- **Modify** `web/src/App.tsx` — comp-filter state wiring.
- **Modify** `web/src/styles.css` — tree/popover/footer/version-fold styles.

---

# PHASE 1 — Data substrate

## Task 1: `player_cr` column + migration guard

**Files:** Modify `src/store/schema.ts`; Test `test/storeMigratePlayerCr.test.ts`.

- [ ] **Step 1: Failing test** — `test/storeMigratePlayerCr.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';

function cols(db: InstanceType<typeof DatabaseSync>): string[] {
  return (db.prepare('PRAGMA table_info(match)').all() as { name: string }[]).map((c) => c.name);
}

describe('migrate player_cr', () => {
  it('creates player_cr on a fresh DB', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    expect(cols(db)).toContain('player_cr');
  });
  it('adds player_cr to an existing DB that lacks it (idempotent)', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE match (match_id TEXT PRIMARY KEY, player_rating INTEGER)'); // old shape
    migrate(db);
    expect(cols(db)).toContain('player_cr');
    migrate(db); // run again — must not throw
    expect(cols(db).filter((c) => c === 'player_cr')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run (WITH flag), verify fail** — `NODE_OPTIONS=--experimental-sqlite npx vitest run test/storeMigratePlayerCr.test.ts --no-file-parallelism` → FAIL.

- [ ] **Step 3: Implement.** In `src/store/schema.ts`: add `player_cr INTEGER,` to the `match` CREATE TABLE (next to `player_rating`). Then change `migrate` to add the column on pre-existing DBs:

```ts
/** Create all tables/indices/views if absent. Safe to call repeatedly. Also adds columns
 *  that were introduced after a DB was first created (additive migrations). */
export function migrate(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
  const matchCols = (db.prepare('PRAGMA table_info(match)').all() as { name: string }[]).map((c) => c.name);
  if (!matchCols.includes('player_cr')) db.exec('ALTER TABLE match ADD COLUMN player_cr INTEGER');
}
```

- [ ] **Step 4: Run (WITH flag)** → PASS (2/2). `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/store/schema.ts test/storeMigratePlayerCr.test.ts
git commit -m "$(printf 'feat: add match.player_cr column + additive migrate guard\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: Combined player+pet action metrics

**Files:** Modify `src/store/metricRows.ts`; Test `test/metricRowsCombine.test.ts`.

Pet-performed *actions* (interrupts, dispels, purges, cleanses, spellsteals) are credited to the owner; everything else stays player-only. (Throughput like damage/healing stays player-only in this increment — see the spec's deferred list.)

- [ ] **Step 1: Failing test** — `test/metricRowsCombine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractMetricRows } from '../src/store/metricRows.js';
import type { MatchMetrics, UnitMetrics } from '../src/metrics/types.js';

// minimal UnitMetrics factory — only the fields the extractor reads matter; others default 0.
function u(over: Partial<UnitMetrics>): UnitMetrics {
  const base: Record<string, unknown> = {
    unitId: 'U', name: 'U', spec: '265', kind: 'player', ownerId: undefined,
    casts: 0, interruptsLanded: 0, interruptsSuffered: 0, dispels: 0, purges: 0, cleanses: 0, spellsteals: 0,
    deaths: 0, deathsWhileCcd: 0, distanceMoved: 0, positionSamples: 0, timeStationarySec: 0,
    defensivesUsed: 0, defensivesIntoBurst: 0, damageDone: 0, healingDone: 0, absorbDone: 0, dps: 0, hps: 0,
    spacing: { meleeRangeSec: 0, isolatedSec: 0 },
    ccDone: { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0 },
    ccReceived: { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0 },
    immuneDone: { ccImmuned: 0 }, immuneReceived: { ccImmuned: 0 },
    interruptsLandedBySpell: [],
  };
  return { ...(base as unknown as UnitMetrics), ...over };
}

function metrics(player: UnitMetrics, pets: UnitMetrics[]): MatchMetrics {
  return {
    teams: [{ team: 'friendly', players: [{ player, pets, combined: {} as never }], unownedPets: [] }],
    coordination: [],
  } as unknown as MatchMetrics;
}

describe('extractMetricRows combine', () => {
  it('credits pet interrupts/dispels to the player; keeps deaths player-only', () => {
    const player = u({ unitId: 'P', interruptsLanded: 0, dispels: 1, deaths: 1, damageDone: 1000 });
    const pet = u({ unitId: 'Pet', kind: 'pet', ownerId: 'P', interruptsLanded: 4, dispels: 2, deaths: 1, damageDone: 500 });
    const { metrics: rows } = extractMetricRows(metrics(player, [pet]), 'P');
    const val = (id: string) => rows.find((r) => r.scope === 'P' && r.metricId === id)?.value;
    expect(val('interruptsLanded')).toBe(4);   // 0 + 4 (pet)
    expect(val('dispels')).toBe(3);            // 1 + 2 (pet)
    expect(val('deaths')).toBe(1);             // player-only (NOT 2)
    expect(val('damageDone')).toBe(1000);      // throughput player-only in this increment
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run test/metricRowsCombine.test.ts --no-file-parallelism` → FAIL.

- [ ] **Step 3: Implement.** In `src/store/metricRows.ts`, give each `UNIT_METRICS` entry an optional `combine?: true` and set it on the pet-agent actions; then sum pets for combined metrics. Read the file first. Change the `UNIT_METRICS` type and the five action entries:

```ts
const UNIT_METRICS: { id: string; get: (u: UnitMetrics) => number; combine?: true }[] = [
  { id: 'casts', get: (u) => u.casts },
  { id: 'interruptsLanded', get: (u) => u.interruptsLanded, combine: true },
  { id: 'interruptsSuffered', get: (u) => u.interruptsSuffered },
  { id: 'dispels', get: (u) => u.dispels, combine: true },
  { id: 'purges', get: (u) => u.purges, combine: true },
  { id: 'cleanses', get: (u) => u.cleanses, combine: true },
  { id: 'spellsteals', get: (u) => u.spellsteals, combine: true },
  // ... leave the remaining entries (deaths, damageDone, dps, spacing.*, ccDone.*, etc.) unchanged ...
```
(Keep every other existing entry exactly as-is; only add `combine: true` to the five action entries above.)

Then in `extractMetricRows`, change the per-player loop to use the combined value when flagged. The current loop is `for (const pg of tg.players) { const u = pg.player; combatants.push(...); for (const ex of UNIT_METRICS) { const v = ex.get(u); ... } }`. Replace the inner metric loop with:

```ts
      const u = pg.player;
      combatants.push({ unitId: u.unitId, name: u.name, spec: u.spec ?? '', team: tg.team, isPlayer: u.unitId === playerUnitId });
      for (const ex of UNIT_METRICS) {
        const v = ex.combine
          ? ex.get(u) + pg.pets.reduce((acc, p) => acc + ex.get(p), 0)
          : ex.get(u);
        if (typeof v === 'number' && Number.isFinite(v)) rows.push({ scope: u.unitId, metricId: ex.id, value: v });
      }
```

- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/store/metricRows.ts test/metricRowsCombine.test.ts
git commit -m "$(printf 'feat: credit pet-performed actions (kicks/dispels) to the owner in persisted metrics\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: Capture CR + build_version at ingest

**Files:** Create `src/util/buildVersion.ts`; Modify `src/store/store.ts`, `src/cli/ingest-db.ts`; Test `test/buildVersion.test.ts`, `test/storeUpsertCr.test.ts`.

- [ ] **Step 1: Failing test (build version reader)** — `test/buildVersion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { readBuildVersion } from '../src/util/buildVersion.js';

mkdirSync('test-data', { recursive: true });

describe('readBuildVersion', () => {
  it('reads BUILD_VERSION from the log header', () => {
    const p = 'test-data/tmp-bv.txt';
    writeFileSync(p, '5/17/2026 20:15:32.251-4  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.0.5,PROJECT_ID,1\nfoo\n');
    try { expect(readBuildVersion(p)).toBe('12.0.5'); } finally { rmSync(p, { force: true }); }
  });
  it('returns null when the header is absent', () => {
    const p = 'test-data/tmp-bv2.txt';
    writeFileSync(p, 'no header here\n');
    try { expect(readBuildVersion(p)).toBeNull(); } finally { rmSync(p, { force: true }); }
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run test/buildVersion.test.ts --no-file-parallelism` → FAIL.

- [ ] **Step 3: Implement `src/util/buildVersion.ts`:**

```ts
import { openSync, readSync, closeSync } from 'node:fs';

const RE = /BUILD_VERSION,([^,]+),/;

/** Read the WoW client build (e.g. "12.0.5") from a combat log's header line. null if absent.
 *  Reads only the first ~4 KB (the header is the first line) — cheap on multi-GB logs. */
export function readBuildVersion(logPath: string): string | null {
  const fd = openSync(logPath, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.toString('utf8', 0, n);
    const m = head.match(RE);
    return m ? m[1].trim() : null;
  } finally { closeSync(fd); }
}
```

- [ ] **Step 4: Run** → PASS (2/2).

- [ ] **Step 5: Failing test (CR capture)** — `test/storeUpsertCr.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { openDb, upsertMatch } from '../src/store/store.js';
import type { MatchMetrics } from '../src/metrics/types.js';

const emptyMetrics = { teams: [], coordination: [] } as unknown as MatchMetrics;

describe('upsertMatch player_cr + build_version', () => {
  it('stores the recording player personalRating as player_cr and the build version', () => {
    const db: InstanceType<typeof DatabaseSync> = openDb(':memory:');
    const raw = {
      id: 'M1', startInfo: { timestamp: 100, bracket: '3v3', zoneId: '1825' }, endInfo: { team0MMR: 2110, team1MMR: 2100 },
      playerId: 'P-1', playerTeamId: '0', winningTeamId: '0',
      units: { 'P-1': { info: { teamId: '0', personalRating: 1834 } } },
    };
    upsertMatch(db, raw, emptyMetrics, { playerUnitId: 'P-1', buildVersion: '12.0.5' });
    const row = db.prepare('SELECT player_cr, player_rating, build_version FROM match WHERE match_id=?').get('M1') as { player_cr: number | null; player_rating: number | null; build_version: string | null };
    expect(row.player_cr).toBe(1834);
    expect(row.player_rating).toBe(2110); // MMR unchanged
    expect(row.build_version).toBe('12.0.5');
  });
});
```

- [ ] **Step 6: Run (WITH flag), verify fail** — `NODE_OPTIONS=--experimental-sqlite npx vitest run test/storeUpsertCr.test.ts --no-file-parallelism` → FAIL (player_cr not inserted).

- [ ] **Step 7: Implement CR capture in `src/store/store.ts`.** Read the file first. In `upsertMatch`, after `const pid = opts.playerUnitId;`, derive CR from the player combatant's info:

```ts
  const playerCr = pid && typeof (m.units?.[pid]?.info as { personalRating?: unknown } | undefined)?.personalRating === 'number'
    ? Math.round((m.units![pid]!.info as { personalRating: number }).personalRating)
    : null;
```
(You may need to widen the local `m.units` type annotation to include `info?: { teamId?: unknown; personalRating?: unknown }`.) Then add `player_cr` to the INSERT: add `player_cr` to the column list (right after `player_rating`) and a matching `?`, and pass `playerCr` in the corresponding position of the `.run(...)` args (right after the `i(playerRating)` argument). `build_version` already exists as a column and `opts.buildVersion` is already wired via `s(opts.buildVersion)` — confirm it's in the INSERT (it is).

- [ ] **Step 8: Run (WITH flag)** → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 9: Wire build version in `src/cli/ingest-db.ts`.** Read it first. Import `readBuildVersion` and pass it per file. In `ingestLogsIntoDb`, compute the build once per file and include it in the `upsertMatch` opts:

```ts
import { readBuildVersion } from '../util/buildVersion.js';
// ...inside the `for (const f of files)` loop, after parseLogFile succeeds:
    const buildVersion = readBuildVersion(f) ?? undefined;
// ...in the upsertMatch opts object, add:
        upsertMatch(db, m, metrics, {
          playerUnitId, sourceFile: basename(f), buildVersion,
          videoPath: sc?.videoPath, sidecarPath: sc?.jsonPath,
        });
```

- [ ] **Step 10: Run the existing ingest test** — `NODE_OPTIONS=--experimental-sqlite npx vitest run test/ingestDb.test.ts --no-file-parallelism` → still PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 11: Commit**
```bash
git add src/util/buildVersion.ts src/store/store.ts src/cli/ingest-db.ts test/buildVersion.test.ts test/storeUpsertCr.test.ts
git commit -m "$(printf 'feat: capture player CR (personalRating) + build_version at ingest\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

- [ ] **Step 12: Re-ingest (manual, by the human).** After Phase 1, the human re-runs `npm run ingest-db -- "<logs>"` to backfill CR, build_version, and corrected kicks. (Optionally delete `wow-arena-eye.local.db` first; the additive migration handles existing DBs either way.) Not a code step — note it in the task report.

---

# PHASE 2 — Viewer queries

## Task 4: spec class helpers

**Files:** Modify `src/metadata/specs.ts`; Test `test/metadataSpecsClass.test.ts`.

- [ ] **Step 1: Failing test** — `test/metadataSpecsClass.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { className, specsOfClass } from '../src/metadata/specs.js';

describe('class helpers', () => {
  it('className resolves a spec id to its class', () => {
    expect(className('265')).toBe('Warlock');
    expect(className('999999')).toBe('');
  });
  it('specsOfClass returns all spec ids of a class', () => {
    const wl = specsOfClass('Warlock');
    expect(wl).toContain('265'); // Affliction
    expect(wl).toContain('266'); // Demonology
    expect(wl).toContain('267'); // Destruction
    expect(specsOfClass('Nonexistent')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run test/metadataSpecsClass.test.ts --no-file-parallelism` → FAIL.

- [ ] **Step 3: Implement.** Append to `src/metadata/specs.ts` (it already loads `TABLE: Record<string,{className,specName}>`):

```ts
/** Class name for a spec id; '' if unknown. */
export function className(id: string): string {
  return TABLE[id]?.className ?? '';
}
/** All spec ids belonging to a class (by className). */
export function specsOfClass(cls: string): string[] {
  return Object.keys(TABLE).filter((id) => TABLE[id].className === cls);
}
```

- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/metadata/specs.ts test/metadataSpecsClass.test.ts
git commit -m "$(printf 'feat: className/specsOfClass helpers for the class-spec comp filter\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: Viewer types + queries — CR/MMR/buildVersion + comp filter + classSpecTree

**Files:** Modify `src/viewer/types.ts`, `src/viewer/queries.ts`; Test `test/viewerQueriesV2.test.ts`.

**ADDITIVE type changes** — do NOT rename or remove existing fields (a rename of `rating`
would break `SummaryDrawer`/`MatchTable`/fixtures all at once, leaving the suite red between
tasks). Keep `rating` (= MMR) and `myComps`/`enemyComp` etc., and only ADD new fields.

- [ ] **Step 1: Update `src/viewer/types.ts`.** In `MatchSummary`, KEEP `rating`/`ratingDelta`
  (they remain the **MMR** value + its delta) and ADD:
```ts
  cr: number | null;        // true rating (personalRating); rating stays as MMR
  crDelta: number | null;
  buildVersion: string;
```
In `MatchQuery`, KEEP `myComp?`/`enemyComp?` (harmless/unused) and ADD:
```ts
  allySpecs?: string;    // comma-separated spec ids
  allyClasses?: string;  // comma-separated class names
  enemySpecs?: string;
  enemyClasses?: string;
```
In `FilterOptions`, KEEP `myComps`/`enemyComps` and ADD:
```ts
  classSpecTree: { className: string; specs: { id: string; specName: string }[] }[];
```

- [ ] **Step 2: Failing test** — `test/viewerQueriesV2.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { loadViewerMatches, loadFilterOptions, enrichRatingDeltas } from '../src/viewer/queries.js';

function seed(db: InstanceType<typeof DatabaseSync>, o: { id: string; t: number; bracket: string; cr: number; mmr: number; build: string;
  combatants: { unit: string; spec: string; team: string; isPlayer?: boolean }[]; name: string; result: string }) {
  db.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,duration_sec,ally_comp_sig,enemy_comp_sig,player_rating,player_cr,build_version,result,player_unit_id,player_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(o.id, o.t, o.bracket, '1825', 100, 'a', 'e', o.mmr, o.cr, o.build, o.result, o.combatants.find((c)=>c.isPlayer)!.unit, o.name);
  const ci = db.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)');
  for (const c of o.combatants) ci.run(o.id, c.unit, c.unit, 'R', null, c.spec, c.team, c.isPlayer ? 1 : 0);
}

function db() {
  const d = new DatabaseSync(':memory:'); migrate(d);
  // M1 & M2: Me-R 3v3, enemy has a DK (250=Blood) in M1, a Mage (62) in M2
  seed(d, { id: 'M1', t: 1000, bracket: '3v3', cr: 1800, mmr: 2000, build: '12.0.5', name: 'Me-R', result: 'win',
    combatants: [{ unit: 'P', spec: '265', team: 'friendly', isPlayer: true }, { unit: 'E1', spec: '250', team: 'enemy' }] });
  seed(d, { id: 'M2', t: 5000, bracket: '3v3', cr: 1816, mmr: 2014, build: '12.0.5', name: 'Me-R', result: 'loss',
    combatants: [{ unit: 'P', spec: '265', team: 'friendly', isPlayer: true }, { unit: 'E2', spec: '62', team: 'enemy' }] });
  return d;
}

describe('loadViewerMatches v2', () => {
  it('exposes cr, mmr (= rating) and buildVersion', () => {
    const m = loadViewerMatches(db(), {}).find((x) => x.matchId === 'M1')!;
    expect(m).toMatchObject({ cr: 1800, rating: 2000, buildVersion: '12.0.5' });
  });
  it('comp filter: enemyClasses=Death Knight matches only M1 (class expands to its specs)', () => {
    expect(loadViewerMatches(db(), { enemyClasses: 'Death Knight' }).map((m) => m.matchId)).toEqual(['M1']);
  });
  it('comp filter: enemySpecs=62 (Arcane Mage) matches only M2; union widens', () => {
    expect(loadViewerMatches(db(), { enemySpecs: '62' }).map((m) => m.matchId)).toEqual(['M2']);
    expect(loadViewerMatches(db(), { enemySpecs: '62', enemyClasses: 'Death Knight' }).map((m) => m.matchId).sort()).toEqual(['M1', 'M2']);
  });
});

describe('enrichRatingDeltas', () => {
  it('computes CR/MMR delta vs the previous game by (character,bracket), independent of filters', () => {
    const d = db();
    const ms = loadViewerMatches(d, { enemySpecs: '62' }); // filtered to M2 only
    enrichRatingDeltas(d, ms);
    const m2 = ms.find((m) => m.matchId === 'M2')!;
    expect(m2.crDelta).toBe(16);      // 1816 - 1800 (vs M1, even though M1 is filtered out)
    expect(m2.ratingDelta).toBe(14);  // MMR: 2014 - 2000
  });
  it('omits the delta when there is no prior game for that character+bracket', () => {
    const d = db();
    const ms = loadViewerMatches(d, {});
    enrichRatingDeltas(d, ms);
    expect(ms.find((m) => m.matchId === 'M1')!.crDelta).toBeNull();
  });
});

describe('loadFilterOptions v2', () => {
  it('returns a class→spec tree of specs present in the data', () => {
    const tree = loadFilterOptions(db()).classSpecTree;
    const wl = tree.find((t) => t.className === 'Warlock');
    expect(wl?.specs.map((s) => s.id)).toContain('265');
    const dk = tree.find((t) => t.className === 'Death Knight');
    expect(dk?.specs.map((s) => s.id)).toContain('250');
  });
});
```

- [ ] **Step 3: Run (WITH flag), verify fail** — `NODE_OPTIONS=--experimental-sqlite npx vitest run test/viewerQueriesV2.test.ts --no-file-parallelism` → FAIL.

- [ ] **Step 4: Implement in `src/viewer/queries.ts`.** Read the file first. Apply these changes:

(a) Imports — add the class helpers:
```ts
import { compLabel, className, specsOfClass } from '../metadata/specs.js';
```

(b) `Row` interface — add `player_cr: number | null;` and `build_version: string | null;`.

(c) In `loadViewerMatches`: build the comp-filter EXISTS clauses, select the new columns, and map them (additively). Add a helper inside the function to expand selected specs+classes and emit an EXISTS clause:
```ts
  const compExists = (team: 'friendly' | 'enemy', specsCsv?: string, classesCsv?: string) => {
    const specs = new Set<string>();
    for (const s of (specsCsv ?? '').split(',').map((x) => x.trim()).filter(Boolean)) specs.add(s);
    for (const c of (classesCsv ?? '').split(',').map((x) => x.trim()).filter(Boolean)) for (const s of specsOfClass(c)) specs.add(s);
    if (specs.size === 0) return;
    const ids = [...specs];
    where.push(`EXISTS (SELECT 1 FROM combatant c2 WHERE c2.match_id = m.match_id AND c2.team = ? AND c2.spec IN (${ids.map(() => '?').join(',')}))`);
    args.push(team, ...ids);
  };
  compExists('friendly', q.allySpecs, q.allyClasses);
  compExists('enemy', q.enemySpecs, q.enemyClasses);
```
Place these calls alongside the other filter builders (after the `eq(...)` calls, before sort). Update the SELECT column list to add `m.player_cr, m.build_version`. In the row→MatchSummary map, KEEP `rating: r.player_rating` but set its delta to null, and ADD the new fields:
```ts
    rating: r.player_rating, ratingDelta: null,   // MMR + delta (filled by enrichRatingDeltas)
    cr: r.player_cr, crDelta: null, buildVersion: r.build_version ?? '',
```
Delete the old per-character `ratingDelta` computation block at the end of `loadViewerMatches` (the `byChar` loop) — deltas now come from `enrichRatingDeltas`. (Keep returning `mapped`.)

(d) Add `enrichRatingDeltas` (new export):
```ts
/** Attach CR/MMR deltas to each match vs the chronologically-previous game by the same
 *  (character, bracket), over FULL history (filter-independent). null when no prior game. */
export function enrichRatingDeltas(db: DatabaseSync, matches: MatchSummary[]): void {
  const need = [...new Set(matches.map((m) => `${m.character} ${m.bracket}`))];
  // full-history ratings per (character,bracket), ascending by time
  type Hist = { startMs: number | null; cr: number | null; mmr: number | null; matchId: string };
  const hist = new Map<string, Hist[]>();
  for (const key of need) {
    const [character, bracket] = key.split(' ');
    const rows = db.prepare(
      'SELECT match_id, start_ms, player_cr, player_rating FROM match WHERE player_name = ? AND bracket = ? ORDER BY start_ms',
    ).all(character, bracket) as { match_id: string; start_ms: number | null; player_cr: number | null; player_rating: number | null }[];
    hist.set(key, rows.map((r) => ({ startMs: r.start_ms, cr: r.player_cr, mmr: r.player_rating, matchId: r.match_id })));
  }
  for (const m of matches) {
    const arr = hist.get(`${m.character} ${m.bracket}`);
    if (!arr) continue;
    const i = arr.findIndex((h) => h.matchId === m.matchId);
    const prev = i > 0 ? arr[i - 1] : undefined;
    if (prev) {
      if (m.cr !== null && prev.cr !== null) m.crDelta = m.cr - prev.cr;
      if (m.rating !== null && prev.mmr !== null) m.ratingDelta = m.rating - prev.mmr; // MMR delta
    }
  }
}
```

(e) `loadFilterOptions`: KEEP `myComps`/`enemyComps` as-is; ADD the `classSpecTree`. Build it from the distinct specs present in the combatant table:
```ts
  const specRows = db.prepare('SELECT DISTINCT spec FROM combatant WHERE spec IS NOT NULL AND spec != ""').all() as { spec: string }[];
  const byClass = new Map<string, { id: string; specName: string }[]>();
  for (const { spec } of specRows) {
    const cls = className(spec) || 'Unknown';
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls)!.push({ id: spec, specName: specLabel(spec) });
  }
  const classSpecTree = [...byClass.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cls, specs]) => ({ className: cls, specs: specs.sort((a, b) => a.specName.localeCompare(b.specName)) }));
```
(Add `specLabel` to the specs import.) Add `classSpecTree` to the returned object (keep the existing `myComps`/`enemyComps`/`maps`/ranges fields).

- [ ] **Step 5: Run (WITH flag)** → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**
```bash
git add src/viewer/types.ts src/viewer/queries.ts test/viewerQueriesV2.test.ts
git commit -m "$(printf 'feat: viewer cr/mmr/buildVersion, class-spec comp filter, chronological deltas\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6: Server — parse new params + wire delta enrichment

**Files:** Modify `src/viewer/server.ts`; Test `test/viewerServerV2.test.ts`.

- [ ] **Step 1: Failing test** — `test/viewerServerV2.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { handleApi } from '../src/viewer/server.js';

function db() {
  const d = new DatabaseSync(':memory:'); migrate(d);
  const ins = (id: string, t: number, cr: number, mmr: number, espec: string) => {
    d.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,duration_sec,ally_comp_sig,enemy_comp_sig,player_rating,player_cr,build_version,result,player_unit_id,player_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, t, '3v3', '1825', 100, 'a', 'e', mmr, cr, '12.0.5', 'win', 'P', 'Me-R');
    d.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)').run(id, 'P', 'Me', 'R', null, '265', 'friendly', 1);
    d.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)').run(id, 'E', 'Foe', 'R', null, espec, 'enemy', 0);
    d.prepare(`INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)`).run(id, 'P', 'damageDone', 1000);
  };
  ins('M1', 1000, 1800, 2000, '250'); // enemy DK
  ins('M2', 5000, 1816, 2014, '62');  // enemy Mage
  return d;
}

describe('handleApi v2', () => {
  it('GET /api/matches enriches CR/MMR deltas chronologically', () => {
    const res = handleApi(db(), 'GET', '/api/matches', new URLSearchParams('character=Me-R'), 30 * 60_000);
    const m2 = JSON.parse(res.body).matches.find((m: { matchId: string }) => m.matchId === 'M2');
    expect(m2.crDelta).toBe(16);
    expect(m2.ratingDelta).toBe(14); // MMR delta
  });
  it('GET /api/matches applies enemyClasses', () => {
    const res = handleApi(db(), 'GET', '/api/matches', new URLSearchParams('enemyClasses=Death Knight'), 30 * 60_000);
    expect(JSON.parse(res.body).matches.map((m: { matchId: string }) => m.matchId)).toEqual(['M1']);
  });
  it('GET /api/filters returns a classSpecTree', () => {
    const res = handleApi(db(), 'GET', '/api/filters', new URLSearchParams(''), 30 * 60_000);
    expect(JSON.parse(res.body).classSpecTree.some((t: { className: string }) => t.className === 'Warlock')).toBe(true);
  });
});
```

- [ ] **Step 2: Run (WITH flag), verify fail** → FAIL.

- [ ] **Step 3: Implement in `src/viewer/server.ts`.** Read it first. (a) In `parseQuery`, remove `myComp`/`enemyComp`, add the four comp params via the existing `str` helper:
```ts
    allySpecs: str('allySpecs'), allyClasses: str('allyClasses'),
    enemySpecs: str('enemySpecs'), enemyClasses: str('enemyClasses'),
```
(b) Import `enrichRatingDeltas` from `./queries.js` and call it in the `/api/matches` handler right after `const matches = loadViewerMatches(db, query);`:
```ts
    enrichRatingDeltas(db, matches);
```
(c) The `total` re-count branch and `attachSessions` call stay unchanged.

- [ ] **Step 4: Run (WITH flag)** → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/viewer/server.ts test/viewerServerV2.test.ts
git commit -m "$(printf 'feat: server parses comp-filter params + enriches chronological deltas\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

# PHASE 3 — SPA

## Task 7: web api types + params

**Files:** Modify `web/src/api.ts`; Test `web/src/api.test.ts` (extend).

- [ ] **Step 1: Update `web/src/api.ts` (additive — mirror the server's additive change).** In `MatchSummary`, KEEP `rating`/`ratingDelta` and ADD `cr: number | null; crDelta: number | null; buildVersion: string;`. In `FilterOptions`, KEEP `myComps`/`enemyComps` and ADD `classSpecTree: { className: string; specs: { id: string; specName: string }[] }[];`. `Filters` stays `Record<string,string>` (the comp params are comma-joined strings). No consumer (SummaryDrawer/MatchTable/FilterRail) breaks, because nothing was removed.

- [ ] **Step 2: Failing test** — append to `web/src/api.test.ts`:

```ts
it('fetchMatches forwards comp-filter csv params', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ matches: [], sessions: [], total: 0 })));
  await fetchMatches({ enemyClasses: 'Death Knight', enemySpecs: '62,63' });
  const url = String(spy.mock.calls[0][0]);
  expect(url).toContain('enemyClasses=Death+Knight');
  expect(url).toContain('enemySpecs=62%2C63');
  spy.mockRestore();
});
```

- [ ] **Step 3: Run (web), verify fail** — `cd web && npx vitest run src/api.test.ts` → FAIL only if a type broke; the new test should pass once types compile (no code change needed in `qs`/`toParams` — they already pass through arbitrary string values). If the existing tests reference `rating`, none do. Confirm green.

- [ ] **Step 4: Run** → PASS. `cd web && npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
cd C:/Users/Ryon/Documents/dev/wow-arena-eye && git add web/src/api.ts web/src/api.test.ts && git commit -m "$(printf 'feat(web): api types for cr/mmr/buildVersion + classSpecTree + comp params\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 8: CompFilterTree popover

**Files:** Create `web/src/components/CompFilterTree.tsx`; Test `web/src/components/CompFilterTree.test.tsx`; CSS in `web/src/styles.css`.

- [ ] **Step 1: Failing test** — `web/src/components/CompFilterTree.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { CompFilterTree } from './CompFilterTree.js';
import type { FilterOptions } from '../api.js';

const tree: FilterOptions['classSpecTree'] = [
  { className: 'Death Knight', specs: [{ id: '250', specName: 'Blood' }, { id: '252', specName: 'Unholy' }] },
  { className: 'Warlock', specs: [{ id: '265', specName: 'Affliction' }] },
];

it('checking a class emits its class name; expanding + checking a spec emits the spec id', () => {
  const onChange = vi.fn();
  render(<CompFilterTree label="Enemy" tree={tree} specs="" classes="" onChange={onChange} />);
  fireEvent.click(screen.getByText('Enemy'));                       // open popover
  fireEvent.click(screen.getByLabelText('Death Knight'));           // class checkbox
  expect(onChange).toHaveBeenCalledWith({ classes: 'Death Knight', specs: '' });
});

it('reflects current selection as a summary on the button', () => {
  render(<CompFilterTree label="Enemy" tree={tree} specs="265" classes="Death Knight" onChange={() => {}} />);
  expect(screen.getByText(/Enemy:/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run (web), verify fail** → FAIL.

- [ ] **Step 3: Implement `web/src/components/CompFilterTree.tsx`:**

```tsx
import { useState } from 'react';
import type { FilterOptions } from '../api.js';

interface Props {
  label: string;                                  // "My team" | "Enemy"
  tree: FilterOptions['classSpecTree'];
  specs: string;                                  // csv of selected spec ids
  classes: string;                                // csv of selected class names
  onChange: (patch: { specs: string; classes: string }) => void;
}

const csv = (s: string) => new Set(s.split(',').map((x) => x.trim()).filter(Boolean));
const join = (s: Set<string>) => [...s].join(',');

export function CompFilterTree({ label, tree, specs, classes, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const selSpecs = csv(specs);
  const selClasses = csv(classes);
  const count = selSpecs.size + selClasses.size;

  const toggle = (set: Set<string>, key: string, which: 'specs' | 'classes') => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    onChange(which === 'specs'
      ? { specs: join(next), classes }
      : { specs, classes: join(next) });
  };

  return (
    <div className="compfilter">
      <button className="compbtn" onClick={() => setOpen((o) => !o)}>
        {label}: {count === 0 ? 'any' : `${count} ▾`}
      </button>
      {open && (
        <div className="comppop">
          {tree.map((c) => (
            <div key={c.className}>
              <div className="compcls">
                <span className="comparrow" onClick={() => setExpanded((e) => { const n = new Set(e); n.has(c.className) ? n.delete(c.className) : n.add(c.className); return n; })}>
                  {expanded.has(c.className) ? '▾' : '▸'}
                </span>
                <label>
                  <input type="checkbox" aria-label={c.className} checked={selClasses.has(c.className)}
                    onChange={() => toggle(selClasses, c.className, 'classes')} /> {c.className}
                </label>
              </div>
              {expanded.has(c.className) && (
                <div className="compspecs">
                  {c.specs.map((s) => (
                    <label key={s.id} className="compspec">
                      <input type="checkbox" aria-label={s.specName} checked={selSpecs.has(s.id)}
                        onChange={() => toggle(selSpecs, s.id, 'specs')} /> {s.specName}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run** → PASS (2/2). `cd web && npx tsc --noEmit` → clean.

- [ ] **Step 5: CSS** — append to `web/src/styles.css`:
```css
.compfilter{position:relative}
.compbtn{width:100%;text-align:left;background:#1c1c26;color:var(--text);border:1px solid var(--line);border-radius:4px;padding:4px}
.comppop{position:absolute;z-index:10;top:100%;left:0;width:200px;max-height:320px;overflow:auto;background:#0d1422;border:1px solid #2c4660;border-radius:6px;padding:6px;font-size:12px}
.compcls{display:flex;align-items:center;gap:4px}
.comparrow{cursor:pointer;color:#889;width:12px}
.compspecs{margin-left:20px;border-left:1px solid #2a2a36;padding-left:6px}
.compspec{display:block}
```

- [ ] **Step 6: Commit**
```bash
cd C:/Users/Ryon/Documents/dev/wow-arena-eye && git add web/src/components/CompFilterTree.tsx web/src/components/CompFilterTree.test.tsx web/src/styles.css && git commit -m "$(printf 'feat(web): CompFilterTree popover (class-any / spec, union)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 9: FilterRail — host the two trees

**Files:** Modify `web/src/components/FilterRail.tsx`; Test `web/src/components/FilterRail.test.tsx` (update).

- [ ] **Step 1: Update the test.** In `web/src/components/FilterRail.test.tsx`, add `classSpecTree: [{ className: 'Warlock', specs: [{ id: '265', specName: 'Affliction' }] }]` to the `opts` fixture (leave `myComps`/`enemyComps` in the fixture — they're now unused but still typed). Remove the two comp-dropdown assertions (`getByLabelText('Map')` etc. that target the old `My comp`/`Enemy comp` selects); add:

```tsx
it('renders the My team and Enemy comp trees and forwards their params', () => {
  const onChange = vi.fn();
  render(<FilterRail options={opts} filters={{}} onChange={onChange} />);
  expect(screen.getByText(/My team:/)).toBeInTheDocument();
  expect(screen.getByText(/Enemy:/)).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Enemy:/));
  fireEvent.click(screen.getByLabelText('Warlock'));
  expect(onChange).toHaveBeenCalledWith({ enemyClasses: 'Warlock', enemySpecs: '' });
});
```
(Keep the existing character/bracket/result/search/map tests; just remove the `My comp`/`Enemy comp` `sel(...)` ones.)

- [ ] **Step 2: Run (web), verify fail** → FAIL.

- [ ] **Step 3: Implement.** In `FilterRail.tsx`: import `CompFilterTree`; remove the `sel('My comp', 'myComp', …)` and `sel('Enemy comp', 'enemyComp', …)` lines; insert the two trees (after the bracket/result controls, before Map):

```tsx
      <CompFilterTree label="My team" tree={options.classSpecTree}
        specs={filters.allySpecs ?? ''} classes={filters.allyClasses ?? ''}
        onChange={(p) => onChange({ allySpecs: p.specs, allyClasses: p.classes })} />
      <CompFilterTree label="Enemy" tree={options.classSpecTree}
        specs={filters.enemySpecs ?? ''} classes={filters.enemyClasses ?? ''}
        onChange={(p) => onChange({ enemySpecs: p.specs, enemyClasses: p.classes })} />
```

- [ ] **Step 4: Run** → PASS. `cd web && npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
cd C:/Users/Ryon/Documents/dev/wow-arena-eye && git add web/src/components/FilterRail.tsx web/src/components/FilterRail.test.tsx && git commit -m "$(printf 'feat(web): FilterRail hosts My team + Enemy class-spec trees\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 10: MatchTable — CR/MMR columns, version fold, totals footer

**Files:** Modify `web/src/components/MatchTable.tsx`, `web/src/format.ts`; Test `web/src/components/MatchTable.test.tsx` (update).

- [ ] **Step 1: Update the test.** In `MatchTable.test.tsx`: ADD to the `m(...)` factory's defaults `cr: 1800, crDelta: 14, buildVersion: '12.0.5'` (KEEP the existing `rating: 2000, ratingDelta: 10` — that's MMR). Add `sort={null} onSort={() => {}}` to every existing `<MatchTable ... />` render in the file. Add:

```tsx
it('shows a version fold header and a sum/avg totals footer', () => {
  render(<MatchTable matches={[m({ matchId: 'A', damageDone: 4_000_000 }), m({ matchId: 'B', damageDone: 2_000_000 })]}
    sessions={sessions} selectedId={null} onSelect={() => {}} sort={null} onSort={() => {}} />);
  expect(screen.getByText(/12\.0\.5/)).toBeInTheDocument();   // version fold
  expect(screen.getByText('Σ')).toBeInTheDocument();          // sum row
  expect(screen.getByText('6.0M')).toBeInTheDocument();       // 4M + 2M sum
  expect(screen.getByText('avg')).toBeInTheDocument();
  expect(screen.getByText('3.0M')).toBeInTheDocument();       // avg
});
```
(The `MatchTable` now takes `sort` and `onSort` props — add them to the existing tests' renders as `sort={null} onSort={() => {}}`.)

- [ ] **Step 2: Run (web), verify fail** → FAIL.

- [ ] **Step 3: Implement.** First add to `web/src/format.ts` (the version label is the raw build; no new formatter needed — reuse `fmtNum`/`fmtRating`). In `MatchTable.tsx`:
  - Add `sort: { col: string; dir: 'asc' | 'desc' } | null;` and `onSort: (col: string) => void;` to `Props`.
  - Group the (already session-grouped) data by `buildVersion` at the top level: build an ordered list of version groups, each containing its session groups. Since matches within a version are contiguous in time, group sessions by the build of their first match.
  - Header columns: `When, R, My comp, Enemy, Map, CR, MMR, Dmg, DPS, Kicks` (10 cols → `colSpan={10}` on separators). CR cell = `fmtRating(m.cr, m.crDelta)`, MMR cell = `fmtRating(m.rating, m.ratingDelta)` (the `rating` field holds MMR), DPS = `fmtNum(m.dps)`.
  - A version separator row (`▾ 12.0.5 · N games`) above each version's sessions.
  - A `<tfoot>` with two rows: `Σ` (sum of damageDone, dps, interruptsLanded over ALL `matches`) and `avg` (those sums / matches.length; CR/MMR show avg only; result column shows the W–L record).

Full component:
```tsx
import type { MatchSummary, SessionSummary } from '../api.js';
import { fmtNum, fmtRating, fmtClock } from '../format.js';

interface Props {
  matches: MatchSummary[]; sessions: SessionSummary[];
  selectedId: string | null; onSelect: (id: string) => void;
  sort: { col: string; dir: 'asc' | 'desc' } | null;
  onSort: (col: string) => void;
}

const COLS: { key: string; label: string; sortable?: boolean; num?: (m: MatchSummary) => number | null }[] = [
  { key: 'startMs', label: 'When', sortable: true },
  { key: 'result', label: 'R' },
  { key: 'ally', label: 'My comp' },
  { key: 'enemy', label: 'Enemy' },
  { key: 'map', label: 'Map' },
  { key: 'cr', label: 'CR', sortable: true, num: (m) => m.cr },
  { key: 'mmr', label: 'MMR', sortable: true, num: (m) => m.rating }, // `rating` field holds MMR
  { key: 'damageDone', label: 'Dmg', sortable: true, num: (m) => m.damageDone },
  { key: 'dps', label: 'DPS', sortable: true, num: (m) => m.dps },
  { key: 'interruptsLanded', label: 'Kicks', sortable: true, num: (m) => m.interruptsLanded },
];

function sortRows(rows: MatchSummary[], sort: Props['sort']): MatchSummary[] {
  if (!sort) return rows;
  const col = COLS.find((c) => c.key === sort.col);
  const f = col?.num ?? ((m: MatchSummary) => m.startMs);
  const out = [...rows].sort((a, b) => ((f(a) ?? -Infinity) - (f(b) ?? -Infinity)));
  return sort.dir === 'desc' ? out.reverse() : out;
}

function Row({ m, selectedId, onSelect }: { m: MatchSummary; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <tr className={m.matchId === selectedId ? 'sel' : ''} onClick={() => onSelect(m.matchId)}>
      <td>{fmtClock(m.startMs)}</td>
      <td className={m.result === 'win' ? 'win' : 'loss'}>{m.result === 'win' ? 'W' : 'L'}</td>
      <td>{m.allyCompLabel}</td><td>{m.enemyCompLabel}</td><td>{m.mapName}</td>
      <td>{fmtRating(m.cr, m.crDelta)}</td><td>{fmtRating(m.rating, m.ratingDelta)}</td>
      <td>{fmtNum(m.damageDone)}</td><td>{fmtNum(m.dps)}</td><td>{fmtNum(m.interruptsLanded)}</td>
    </tr>
  );
}

export function MatchTable({ matches, sessions, selectedId, onSelect, sort, onSort }: Props) {
  if (matches.length === 0) return <div className="empty">No matches yet — run <code>npm run ingest-db</code>.</div>;

  const sessionOrder = new Map(sessions.map((s, i) => [s.id, i]));
  const sessRank = (k: string) => sessionOrder.get(k) ?? sessions.length;
  // group matches by version, then by session (sessions are contiguous within a version)
  const byVersion = new Map<string, MatchSummary[]>();
  for (const m of matches) { const v = m.buildVersion || '—'; if (!byVersion.has(v)) byVersion.set(v, []); byVersion.get(v)!.push(m); }

  const sum = (f: (m: MatchSummary) => number | null) => matches.reduce((a, m) => a + (f(m) ?? 0), 0);
  const n = matches.length;
  const wins = matches.filter((m) => m.result === 'win').length;

  return (
    <table className="matches">
      <thead><tr>
        {COLS.map((c) => (
          <th key={c.key} className={c.sortable ? 'sortable' : ''} onClick={c.sortable ? () => onSort(c.key) : undefined}>
            {c.label}{sort?.col === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
          </th>
        ))}
      </tr></thead>
      <tbody>
        {[...byVersion.entries()].flatMap(([version, vMatches]) => {
          const bySession = new Map<string, MatchSummary[]>();
          for (const m of vMatches) { const k = m.sessionId ?? '∅'; if (!bySession.has(k)) bySession.set(k, []); bySession.get(k)!.push(m); }
          const groups = [...bySession.keys()].sort((a, b) => sessRank(a) - sessRank(b));
          return [
            <tr key={`v-${version}`} className="vsep"><td colSpan={10}>▾ {version} · {vMatches.length} games</td></tr>,
            ...groups.flatMap((key) => {
              const s = sessions.find((s) => s.id === key);
              return [
                s ? <tr key={`s-${key}`} className="sep"><td colSpan={10}>▸ session · {fmtClock(s.startMs)} · {s.count} games · {s.wins}W–{s.losses}L</td></tr> : null,
                ...sortRows(bySession.get(key)!, sort).map((m) => <Row key={m.matchId} m={m} selectedId={selectedId} onSelect={onSelect} />),
              ];
            }),
          ];
        })}
      </tbody>
      <tfoot>
        <tr className="totals"><td>Σ</td><td>{wins}W–{n - wins}L</td><td colSpan={3} /><td>{/* CR */}</td><td>{/* MMR */}</td><td>{fmtNum(sum((m) => m.damageDone))}</td><td>{fmtNum(sum((m) => m.dps))}</td><td>{fmtNum(sum((m) => m.interruptsLanded))}</td></tr>
        <tr className="totals"><td>avg</td><td colSpan={4} /><td>{fmtNum(Math.round(sum((m) => m.cr) / n))}</td><td>{fmtNum(Math.round(sum((m) => m.rating) / n))}</td><td>{fmtNum(sum((m) => m.damageDone) / n)}</td><td>{fmtNum(sum((m) => m.dps) / n)}</td><td>{fmtNum(sum((m) => m.interruptsLanded) / n)}</td></tr>
      </tfoot>
    </table>
  );
}
```

- [ ] **Step 4: Run** → PASS. `cd web && npx tsc --noEmit` → clean.

- [ ] **Step 5: CSS** — append to `web/src/styles.css`:
```css
.vsep td{background:#10203a;color:#9cf;font-weight:700;font-size:11px}
.matches th.sortable{cursor:pointer}.matches th.sortable:hover{color:var(--accent)}
.matches tfoot .totals td{border-top:2px solid var(--line);color:#aab;font-weight:600}
```

- [ ] **Step 6: Commit**
```bash
cd C:/Users/Ryon/Documents/dev/wow-arena-eye && git add web/src/components/MatchTable.tsx web/src/components/MatchTable.test.tsx web/src/styles.css && git commit -m "$(printf 'feat(web): CR/MMR columns, version fold, sortable headers, sum/avg footer\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 11: App wiring — comp filter + sort state

**Files:** Modify `web/src/App.tsx`; Test `web/src/App.test.tsx` (update).

- [ ] **Step 1: Update the test.** In `App.test.tsx`: ADD `classSpecTree: [{ className: 'Warlock', specs: [{ id: '265', specName: 'Affliction' }] }]` to the `filters` fixture (keep `myComps`/`enemyComps`); ADD `cr: 1800, crDelta: 14, buildVersion: '12.0.5'` to the match fixture (keep its `rating`/`ratingDelta`). Add:

```tsx
it('sorts within folds when a column header is clicked', async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByText('Enigma Crucible')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Dmg'));
  // no throw; the sort indicator appears
  await waitFor(() => expect(screen.getByText(/Dmg ▲|Dmg ▼/)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run (web), verify fail** → FAIL.

- [ ] **Step 3: Implement in `web/src/App.tsx`.** Add a `sort` state and an `onSort` toggle (asc → desc → cleared); pass `sort`/`onSort` to `MatchTable`:
```tsx
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  const onSort = (col: string) => setSort((s) =>
    s?.col !== col ? { col, dir: 'desc' } : s.dir === 'desc' ? { col, dir: 'asc' } : null);
  // ...in the JSX:
  <MatchTable matches={data.matches} sessions={data.sessions} selectedId={selected?.matchId ?? null}
    onSelect={(id) => setSelected(data.matches.find((m) => m.matchId === id) ?? null)}
    sort={sort} onSort={onSort} />
```
(The comp filter already flows through `onChange` → `filters` → `fetchMatches`, since `FilterRail` emits `allySpecs`/`allyClasses`/`enemySpecs`/`enemyClasses` patches and those are plain `Filters` keys.)

- [ ] **Step 4: Run** → PASS. `cd web && npx tsc --noEmit` → clean. Full web suite: `cd web && npx vitest run` → all green.

- [ ] **Step 5: Commit**
```bash
cd C:/Users/Ryon/Documents/dev/wow-arena-eye && git add web/src/App.tsx web/src/App.test.tsx && git commit -m "$(printf 'feat(web): App sort state; comp-filter params flow through URL\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## After all tasks (controller)

1. Node suite green: `NODE_OPTIONS=--experimental-sqlite npx vitest run --no-file-parallelism`; `npx tsc --noEmit` clean.
2. Web suite green: `cd web && npx vitest run`; `cd web && npx tsc --noEmit`; `cd web && npx vite build`.
3. **Re-ingest** (human): `npm run ingest-db -- "<logs>"` to backfill CR/build_version/kicks; sanity-check the viewer shows CR≠MMR and nonzero kicks for warlock matches.
4. Gates: `/simplify` then `/code-review` on the branch diff; address findings.
5. Finish: superpowers:finishing-a-development-branch → push + PR.

## Self-Review

- *Spec coverage:* `player_cr` + migration (T1); combined pet actions (T2); CR/build_version capture (T3); class helpers (T4); cr/mmr/buildVersion + EXISTS comp filter + chronological deltas + classSpecTree (T5); server params + delta enrichment (T6); web types (T7); CompFilterTree (T8); FilterRail trees (T9); CR/MMR columns + version fold + totals footer (T10); sort-within-folds + comp-filter flow (T11). Deferred items (detail view, baseline comparison, throughput-combine, enemy CR, scorecard CR-scope) are out of scope per the spec.
- *Placeholder scan:* none — every step has concrete code/commands/expected output.
- *Type consistency (ADDITIVE — nothing renamed/removed, so the suite stays green between tasks):* `MatchSummary` keeps `rating`/`ratingDelta` (= MMR) and gains `cr/crDelta/buildVersion` in both `src/viewer/types.ts` (T5) and `web/src/api.ts` (T7); `FilterOptions` keeps `myComps`/`enemyComps` and gains `classSpecTree` (T5, consumed T8/T9); `MatchQuery` keeps `myComp/enemyComp`, adds `allySpecs/allyClasses/enemySpecs/enemyClasses` (T5) parsed in server `parseQuery` (T6) and emitted by `CompFilterTree`/`FilterRail` (T8/T9). The MMR column reads `m.rating` (the field name stays `rating`; the UI label is "MMR"). `enrichRatingDeltas` (T5) fills `ratingDelta` (MMR) + `crDelta`, called in the server (T6). `MatchTable` gains `sort`/`onSort` props (T10) supplied by `App` (T11). `SummaryDrawer` is untouched (still reads `rating`). SQLite-touching tests carry `NODE_OPTIONS=--experimental-sqlite`.
