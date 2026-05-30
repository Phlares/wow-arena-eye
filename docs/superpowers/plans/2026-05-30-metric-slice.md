# First Metric Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a starter set of player-attributed behavioral metrics (interrupts, dispels/purges, casts/tempo, deaths) from parsed matches and surface them in `output/report.html` for ground-truthing.

**Architecture:** A single `eventAccess` module isolates all parser-event field access (its test, run on the real fixture, drives field-name discovery via TDD). `playerUnits` resolves the recording player + pets. Pure metric functions compute over `match.events` using those accessors; `computeMatchMetrics` assembles a typed `MatchMetrics`. The `view` CLI populates `ParsedMatchView.metrics` and the pure `renderReport` gains a metrics block.

**Tech Stack:** TypeScript/ESM (Node ≥22), Vitest. Consumes the vendored `@wowarenalogs/parser` output (already wired via `parseLogFile`).

---

## File Structure

```
src/metrics/eventAccess.ts   # field accessors over parser events (isolates shape uncertainty)
src/metrics/playerUnits.ts   # resolvePlayerUnits(match) -> Set<string> (player + pets)
src/metrics/metrics.ts       # pure compute fns + computeMatchMetrics + MatchMetrics/PlayerMetrics/... types
src/metrics/registry.ts      # metric id/label/category registry (Plan 4 seam)
src/view/renderReport.ts     # MODIFIED: render metrics block (pure); ParsedMatchView gains metrics?
src/cli/view.ts              # MODIFIED: populate view.metrics via computeMatchMetrics
test/eventAccess.test.ts
test/playerUnits.test.ts
test/metrics.test.ts
```

A local fixture exists at `test-data/fixtures/arena-sample.log` (git-ignored, a real 12.0.5 3v3 match). `parseLogFile(path)` returns `{ arenaMatches, shuffleRounds, ... }`; each match has `playerId` (string GUID), `events` (array), `durationInSeconds`, `units` (object keyed by GUID).

---

## Task 1: Event accessors (TDD drives field-name discovery on real data)

**Files:** Create `src/metrics/eventAccess.ts`, `test/eventAccess.test.ts`

- [ ] **Step 1: Write the accessor test against the real fixture** — `test/eventAccess.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { eventType, srcId, destId, spellName, extraSpellName, auraType } from '../src/metrics/eventAccess.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

describe('eventAccess (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('reads core fields off real parsed events', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const events: unknown[] = (arenaMatches[0] as { events: unknown[] }).events;

    const cast = events.find((e) => eventType(e) === 'SPELL_CAST_SUCCESS');
    expect(cast, 'a SPELL_CAST_SUCCESS event exists').toBeTruthy();
    expect(srcId(cast)).toBeTruthy();
    expect(spellName(cast).length).toBeGreaterThan(0);

    const interrupt = events.find((e) => eventType(e) === 'SPELL_INTERRUPT');
    if (interrupt) {
      expect(srcId(interrupt)).toBeTruthy();
      expect(destId(interrupt)).toBeTruthy();
      expect((extraSpellName(interrupt) ?? '').length).toBeGreaterThan(0); // the kicked spell
    }

    const dispel = events.find((e) => eventType(e) === 'SPELL_DISPEL');
    if (dispel) {
      expect(['BUFF', 'DEBUFF']).toContain(auraType(dispel));
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/eventAccess.test.ts`
Expected: FAIL — cannot resolve `../src/metrics/eventAccess.js`.

- [ ] **Step 3: Implement `src/metrics/eventAccess.ts` with best-guess fields**

```ts
type Ev = Record<string, unknown>;

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}
function strOpt(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function eventType(ev: unknown): string {
  const e = ev as Ev;
  const fromLine = (e?.logLine as Ev | undefined)?.event;
  return str(e?.logEvent ?? e?.event ?? fromLine ?? 'UNKNOWN') || 'UNKNOWN';
}

export function srcId(ev: unknown): string | undefined {
  const e = ev as Ev;
  return strOpt(e?.srcUnitId ?? e?.sourceUnitId ?? e?.srcGUID ?? e?.sourceGUID);
}

export function destId(ev: unknown): string | undefined {
  const e = ev as Ev;
  return strOpt(e?.destUnitId ?? e?.targetUnitId ?? e?.destGUID ?? e?.targetGUID);
}

export function spellName(ev: unknown): string {
  const e = ev as Ev;
  return str(e?.spellName ?? (e?.spell as Ev | undefined)?.name);
}

export function extraSpellName(ev: unknown): string | undefined {
  const e = ev as Ev;
  return strOpt(e?.extraSpellName ?? (e?.extraSpell as Ev | undefined)?.name);
}

export function auraType(ev: unknown): 'BUFF' | 'DEBUFF' | undefined {
  const e = ev as Ev;
  const v = str(e?.auraType ?? e?.extraAuraType ?? e?.auraType2);
  return v === 'BUFF' || v === 'DEBUFF' ? v : undefined;
}

export function eventTimeMs(ev: unknown): number | undefined {
  const e = ev as Ev;
  const t = e?.timestamp ?? (e?.logLine as Ev | undefined)?.timestamp;
  return typeof t === 'number' ? t : undefined;
}
```

- [ ] **Step 4: Run; if it fails, discover real field names and fix the accessors**

Run: `npx vitest run test/eventAccess.test.ts`
If it PASSES, the guesses were right — continue. If it FAILS, the parser uses different field names. Diagnose by dumping one event of each type:
```
npx tsx -e "import('./src/parser/parserClient.js').then(async m=>{const {arenaMatches}=await m.parseLogFile('test-data/fixtures/arena-sample.log');const evs=arenaMatches[0].events;const find=t=>evs.find(e=>e.logEvent===t||e.event===t);console.log('CAST',JSON.stringify(find('SPELL_CAST_SUCCESS'),null,1)?.slice(0,800));console.log('INT',JSON.stringify(find('SPELL_INTERRUPT'),null,1)?.slice(0,800));console.log('DISP',JSON.stringify(find('SPELL_DISPEL'),null,1)?.slice(0,800));})"
```
Read the printed keys, update the accessor field names in `eventAccess.ts` to the REAL ones (also check the built type defs at `vendor/wowarenalogs/packages/parser/dist/index.d.ts` for the action classes `CombatAction`/`CombatExtraSpellAction`). Re-run until the test passes. **Report any field-name corrections you made.**

- [ ] **Step 5: Commit**

```bash
git add src/metrics/eventAccess.ts test/eventAccess.test.ts
git commit -m "feat: parser event accessors (field access isolated, discovered via TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Resolve player units (player + pets)

**Files:** Create `src/metrics/playerUnits.ts`, `test/playerUnits.test.ts`

- [ ] **Step 1: Write the failing test** — `test/playerUnits.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { resolvePlayerUnits } from '../src/metrics/playerUnits.js';

describe('resolvePlayerUnits', () => {
  it('includes the recording player', () => {
    const match = { playerId: 'Player-1-AAA', events: [], units: {} };
    const set = resolvePlayerUnits(match);
    expect(set.has('Player-1-AAA')).toBe(true);
  });

  it('includes a pet summoned by the player', () => {
    const match = {
      playerId: 'Player-1-AAA',
      units: {},
      events: [
        { logEvent: 'SPELL_SUMMON', srcUnitId: 'Player-1-AAA', destUnitId: 'Creature-1-PET' },
      ],
    };
    const set = resolvePlayerUnits(match);
    expect(set.has('Player-1-AAA')).toBe(true);
    expect(set.has('Creature-1-PET')).toBe(true);
  });

  it('returns an empty set when playerId is missing', () => {
    const set = resolvePlayerUnits({ events: [], units: {} });
    expect(set.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/playerUnits.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/metrics/playerUnits.ts`**

```ts
import { eventType, srcId, destId } from './eventAccess.js';

/**
 * GUIDs that count as "the player": the recording player (match.playerId) plus
 * any pet/guardian they summoned (SPELL_SUMMON with the player as source).
 * Pet ownership also appears via owner GUID on advanced events; the summon scan
 * is the reliable, shape-stable signal for this slice.
 */
export function resolvePlayerUnits(match: unknown): Set<string> {
  const m = match as { playerId?: unknown; events?: unknown[] };
  const set = new Set<string>();
  const player = typeof m.playerId === 'string' ? m.playerId : undefined;
  if (!player) return set;
  set.add(player);

  const events = Array.isArray(m.events) ? m.events : [];
  for (const ev of events) {
    if (eventType(ev) === 'SPELL_SUMMON' && srcId(ev) === player) {
      const pet = destId(ev);
      if (pet) set.add(pet);
    }
  }
  return set;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/playerUnits.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/playerUnits.ts test/playerUnits.test.ts
git commit -m "feat: resolve player units (recording player + summoned pets)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Metric compute functions + computeMatchMetrics

**Files:** Create `src/metrics/metrics.ts`, `src/metrics/registry.ts`, `test/metrics.test.ts`

- [ ] **Step 1: Write the failing test** — `test/metrics.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { computeMatchMetrics } from '../src/metrics/metrics.js';
import { parseLogFile } from '../src/parser/parserClient.js';

// Minimal synthetic match exercising the metric logic via the same accessors.
function synth() {
  return {
    playerId: 'P',
    durationInSeconds: 60,
    units: {
      P: { name: 'You', type: 'Player' },
      E: { name: 'Enemy', type: 'Player' },
    },
    events: [
      { logEvent: 'SPELL_CAST_SUCCESS', srcUnitId: 'P', spellName: 'Agony' },
      { logEvent: 'SPELL_CAST_SUCCESS', srcUnitId: 'P', spellName: 'Agony' },
      { logEvent: 'SPELL_CAST_SUCCESS', srcUnitId: 'P', spellName: 'Corruption' },
      { logEvent: 'SPELL_INTERRUPT', srcUnitId: 'P', destUnitId: 'E', spellName: 'Spell Lock', extraSpellName: 'Chaos Bolt' },
      { logEvent: 'SPELL_INTERRUPT', srcUnitId: 'E', destUnitId: 'P', spellName: 'Kick', extraSpellName: 'Fear' },
      { logEvent: 'SPELL_DISPEL', srcUnitId: 'P', destUnitId: 'E', spellName: 'Devour Magic', extraSpellName: 'Power Word: Shield', auraType: 'BUFF' },
      { logEvent: 'SPELL_DISPEL', srcUnitId: 'P', destUnitId: 'P', spellName: 'Devour Magic', extraSpellName: 'Polymorph', auraType: 'DEBUFF' },
      { logEvent: 'UNIT_DIED', destUnitId: 'E' },
    ],
  };
}

describe('computeMatchMetrics (synthetic)', () => {
  const mm = computeMatchMetrics(synth());

  it('counts player casts, casts/min, and top casts', () => {
    expect(mm.player.casts).toBe(3);
    expect(mm.player.castsPerMin).toBeCloseTo(3, 5); // 3 casts / 60s * 60
    expect(mm.player.topCasts[0]).toEqual({ spellName: 'Agony', count: 2 });
  });

  it('counts interrupts landed (+ what was kicked) and suffered', () => {
    expect(mm.player.interruptsLanded).toBe(1);
    expect(mm.player.interruptsLandedBySpell).toEqual([{ spellName: 'Chaos Bolt', count: 1 }]);
    expect(mm.player.interruptsSuffered).toBe(1);
    expect(mm.player.interruptsSufferedBySpell).toEqual([{ spellName: 'Fear', count: 1 }]);
  });

  it('splits dispels into purge (buff) and cleanse (debuff)', () => {
    expect(mm.player.dispels).toBe(2);
    expect(mm.player.purges).toBe(1);
    expect(mm.player.cleanses).toBe(1);
  });
});

const FIXTURE = 'test-data/fixtures/arena-sample.log';
describe('computeMatchMetrics (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('produces well-formed metrics for a real match', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const mm = computeMatchMetrics(arenaMatches[0]);
    expect(mm.player.casts).toBeGreaterThan(0);
    expect(Array.isArray(mm.perCombatant)).toBe(true);
    expect(mm.perCombatant.length).toBeGreaterThan(0);
    expect(typeof mm.allyDeaths).toBe('number');
    expect(typeof mm.enemyDeaths).toBe('number');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/metrics.test.ts`
Expected: FAIL — cannot resolve `../src/metrics/metrics.js`.

- [ ] **Step 3: Implement `src/metrics/registry.ts`**

```ts
export type MetricCategory = 'disruption-out' | 'disruption-in' | 'tempo' | 'outcome';

export interface MetricDef {
  id: string;
  label: string;
  category: MetricCategory;
}

/** Seed registry — Plan 4 grows this. computeMatchMetrics produces these fields. */
export const METRICS: MetricDef[] = [
  { id: 'interruptsLanded', label: 'Interrupts landed', category: 'disruption-out' },
  { id: 'dispels', label: 'Dispels', category: 'disruption-out' },
  { id: 'spellsteals', label: 'Spellsteals', category: 'disruption-out' },
  { id: 'interruptsSuffered', label: 'Times interrupted', category: 'disruption-in' },
  { id: 'buffsLostToPurgeOrSteal', label: 'Buffs purged/stolen off you', category: 'disruption-in' },
  { id: 'casts', label: 'Casts', category: 'tempo' },
  { id: 'castsPerMin', label: 'Casts/min', category: 'tempo' },
  { id: 'deaths', label: 'Deaths', category: 'outcome' },
];
```

- [ ] **Step 4: Implement `src/metrics/metrics.ts`**

```ts
import { eventType, srcId, destId, spellName, extraSpellName, auraType, eventTimeMs } from './eventAccess.js';
import { resolvePlayerUnits } from './playerUnits.js';

export interface SpellTally { spellName: string; count: number; }

export interface PlayerMetrics {
  interruptsLanded: number;
  interruptsLandedBySpell: SpellTally[];
  interruptsSuffered: number;
  interruptsSufferedBySpell: SpellTally[];
  dispels: number;
  dispelsByRemoved: SpellTally[];
  purges: number;
  cleanses: number;
  buffsLostToPurgeOrSteal: number;
  spellsteals: number;
  casts: number;
  castsPerMin: number | null;
  topCasts: SpellTally[];
  deaths: number;
  deathTimesSec: number[];
}

export interface CombatantTally { name: string; interrupts: number; dispels: number; casts: number; deaths: number; }

export interface MatchMetrics {
  player: PlayerMetrics;
  allyDeaths: number;
  enemyDeaths: number;
  perCombatant: CombatantTally[];
}

function tally(names: string[]): SpellTally[] {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].map(([spellName, count]) => ({ spellName, count })).sort((a, b) => b.count - a.count);
}

export function computeMatchMetrics(match: unknown): MatchMetrics {
  const m = match as { events?: unknown[]; durationInSeconds?: unknown; units?: Record<string, { name?: unknown; reaction?: unknown }> };
  const events = Array.isArray(m.events) ? m.events : [];
  const players = resolvePlayerUnits(match);
  const units = m.units ?? {};
  const startMs = events.length > 0 ? eventTimeMs(events[0]) : undefined;

  const isPlayer = (id: string | undefined) => id !== undefined && players.has(id);

  const interruptsLanded: string[] = [];
  const interruptsSuffered: string[] = [];
  const dispelsRemoved: string[] = [];
  let purges = 0;
  let cleanses = 0;
  let buffsLostToPurgeOrSteal = 0;
  let spellsteals = 0;
  const casts: string[] = [];
  const deathTimesSec: number[] = [];
  let allyDeaths = 0;
  let enemyDeaths = 0;

  // per-combatant tallies keyed by GUID
  const pc = new Map<string, CombatantTally>();
  const bump = (id: string | undefined, k: 'interrupts' | 'dispels' | 'casts' | 'deaths') => {
    if (!id) return;
    const u = units[id] as { name?: unknown } | undefined;
    const name = u && typeof u.name === 'string' && u.name.length > 0 ? u.name : id;
    const row = pc.get(id) ?? { name, interrupts: 0, dispels: 0, casts: 0, deaths: 0 };
    row[k] += 1;
    pc.set(id, row);
  };

  for (const ev of events) {
    const t = eventType(ev);
    const s = srcId(ev);
    const d = destId(ev);

    if (t === 'SPELL_CAST_SUCCESS') {
      bump(s, 'casts');
      if (isPlayer(s)) casts.push(spellName(ev));
    } else if (t === 'SPELL_INTERRUPT') {
      bump(s, 'interrupts');
      const kicked = extraSpellName(ev) ?? spellName(ev);
      if (isPlayer(s)) interruptsLanded.push(kicked);
      if (isPlayer(d)) interruptsSuffered.push(kicked);
    } else if (t === 'SPELL_DISPEL') {
      bump(s, 'dispels');
      const removed = extraSpellName(ev) ?? spellName(ev);
      if (isPlayer(s)) {
        dispelsRemoved.push(removed);
        if (auraType(ev) === 'BUFF') purges += 1;
        else cleanses += 1;
      }
      if (isPlayer(d) && auraType(ev) === 'BUFF') buffsLostToPurgeOrSteal += 1;
    } else if (t === 'SPELL_STOLEN') {
      if (isPlayer(s)) spellsteals += 1;
      if (isPlayer(d)) buffsLostToPurgeOrSteal += 1;
    } else if (t === 'UNIT_DIED') {
      bump(d, 'deaths');
      if (isPlayer(d)) {
        const tm = eventTimeMs(ev);
        if (tm !== undefined && startMs !== undefined) deathTimesSec.push(Math.round((tm - startMs) / 1000));
      }
      // ally/enemy split by reaction relative to the player's units
      const u = units[d ?? ''] as { reaction?: unknown } | undefined;
      const reaction = u && typeof u.reaction !== 'undefined' ? String(u.reaction) : '';
      if (d && players.has(d)) { /* player's own death counted via deaths below */ }
      else if (reaction === 'Friendly' || reaction === '1') allyDeaths += 1;
      else if (reaction === 'Hostile' || reaction === '2') enemyDeaths += 1;
    }
  }

  const durationSec = typeof m.durationInSeconds === 'number' ? m.durationInSeconds : null;
  const playerDeaths = deathTimesSec.length;

  const player: PlayerMetrics = {
    interruptsLanded: interruptsLanded.length,
    interruptsLandedBySpell: tally(interruptsLanded),
    interruptsSuffered: interruptsSuffered.length,
    interruptsSufferedBySpell: tally(interruptsSuffered),
    dispels: dispelsRemoved.length,
    dispelsByRemoved: tally(dispelsRemoved),
    purges,
    cleanses,
    buffsLostToPurgeOrSteal,
    spellsteals,
    casts: casts.length,
    castsPerMin: durationSec && durationSec > 0 ? (casts.length / durationSec) * 60 : null,
    topCasts: tally(casts).slice(0, 8),
    deaths: playerDeaths,
    deathTimesSec,
  };

  return {
    player,
    allyDeaths,
    enemyDeaths,
    perCombatant: [...pc.values()].sort((a, b) => b.casts - a.casts),
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/metrics.test.ts`
Expected: PASS — synthetic (3 tests) + fixture golden. If the fixture golden shows `player.casts === 0`, the accessors from Task 1 are mis-mapped for the real data — revisit `eventAccess.ts` (Task 1 Step 4). If `allyDeaths`/`enemyDeaths` both 0 on the fixture but the match had deaths, the `units[].reaction` value differs — dump `Object.values(arenaMatches[0].units)[0]` and adjust the reaction comparison. Report any adjustment.

- [ ] **Step 6: Commit**

```bash
git add src/metrics/metrics.ts src/metrics/registry.ts test/metrics.test.ts
git commit -m "feat: first metric battery slice (interrupts, dispels, tempo, deaths)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Surface metrics in the report + generate a real report

**Files:** Modify `src/view/renderReport.ts`, `src/cli/view.ts`. Test: add to `test/renderReport.test.ts`.

- [ ] **Step 1: Add the failing render test** — append to `test/renderReport.test.ts`

```ts
import type { MatchMetrics } from '../src/metrics/metrics.js';

describe('renderReport metrics block', () => {
  it('renders the player metrics when present', () => {
    const metrics: MatchMetrics = {
      player: {
        interruptsLanded: 1,
        interruptsLandedBySpell: [{ spellName: 'Chaos Bolt', count: 1 }],
        interruptsSuffered: 0,
        interruptsSufferedBySpell: [],
        dispels: 2,
        dispelsByRemoved: [{ spellName: 'Polymorph', count: 1 }],
        purges: 1,
        cleanses: 1,
        buffsLostToPurgeOrSteal: 0,
        spellsteals: 0,
        casts: 187,
        castsPerMin: 3.2,
        topCasts: [{ spellName: 'Agony', count: 40 }],
        deaths: 1,
        deathTimesSec: [248],
      },
      allyDeaths: 1,
      enemyDeaths: 2,
      perCombatant: [{ name: 'You', interrupts: 1, dispels: 2, casts: 187, deaths: 1 }],
    };
    // match() helper already defined at top of this file; add metrics to it.
    const html = renderReport([match({ metrics })], index());
    expect(html).toContain('Metrics');
    expect(html).toContain('187');
    expect(html).toContain('Chaos Bolt');
  });
});
```
Also update the `match(...)` helper at the top of `test/renderReport.test.ts` to allow a `metrics` field: add `metrics: undefined,` to its default object (so existing tests still pass) — the `over` spread already lets a test pass `{ metrics }`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/renderReport.test.ts`
Expected: FAIL — `ParsedMatchView` has no `metrics`, or the metrics block isn't rendered.

- [ ] **Step 3: Extend `ParsedMatchView` and render the block in `src/view/renderReport.ts`**

Add the import and field. At the top imports add:
```ts
import type { MatchMetrics } from '../metrics/metrics.js';
```
In the `ParsedMatchView` interface add:
```ts
  metrics?: MatchMetrics;
```
Add this helper above `matchSection`:
```ts
function metricsBlock(mm: MatchMetrics | undefined): string {
  if (!mm) return '';
  const p = mm.player;
  const tallyStr = (t: { spellName: string; count: number }[]) =>
    t.length ? t.map((x) => `${escapeHtml(x.spellName)}×${x.count}`).join(', ') : '—';
  const cpm = p.castsPerMin === null ? '?' : p.castsPerMin.toFixed(1);
  return `<h4>Metrics (you)</h4>
  <table>
    <tr><td>interrupts landed</td><td>${p.interruptsLanded}</td><td>${tallyStr(p.interruptsLandedBySpell)}</td></tr>
    <tr><td>times interrupted</td><td>${p.interruptsSuffered}</td><td>${tallyStr(p.interruptsSufferedBySpell)}</td></tr>
    <tr><td>dispels (purge/cleanse)</td><td>${p.dispels} (${p.purges}/${p.cleanses})</td><td>${tallyStr(p.dispelsByRemoved)}</td></tr>
    <tr><td>spellsteals</td><td>${p.spellsteals}</td><td></td></tr>
    <tr><td>buffs purged/stolen off you</td><td>${p.buffsLostToPurgeOrSteal}</td><td></td></tr>
    <tr><td>casts (per min)</td><td>${p.casts} (${cpm})</td><td>${tallyStr(p.topCasts)}</td></tr>
    <tr><td>deaths</td><td>${p.deaths}</td><td>at ${p.deathTimesSec.map((s) => `${s}s`).join(', ') || '—'}</td></tr>
    <tr><td>ally / enemy deaths</td><td>${mm.allyDeaths} / ${mm.enemyDeaths}</td><td></td></tr>
  </table>
  <details><summary>per-combatant tally</summary>
  <table><tr><th>name</th><th>int</th><th>disp</th><th>casts</th><th>deaths</th></tr>${mm.perCombatant
    .map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>${c.interrupts}</td><td>${c.dispels}</td><td>${c.casts}</td><td>${c.deaths}</td></tr>`)
    .join('')}</table></details>`;
}
```
Then inside `matchSection`, insert `${metricsBlock(m.metrics)}` into the returned template — place it right after the `${videoBlock}` line and before the `<h4>Combatants` line.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/renderReport.test.ts`
Expected: PASS (existing renderReport tests + the new metrics block test).

- [ ] **Step 5: Populate metrics in `src/cli/view.ts`**

Add the import:
```ts
import { computeMatchMetrics } from '../metrics/metrics.js';
```
Change the `views` construction so each view gets its metrics. Replace:
```ts
  const views = [
    ...res.arenaMatches.map((m) => projectMatch(m, 'arena')),
    ...res.shuffleRounds.map((r) => projectMatch(r, 'shuffleRound')),
  ];
```
with:
```ts
  const views = [
    ...res.arenaMatches.map((m) => ({ ...projectMatch(m, 'arena'), metrics: computeMatchMetrics(m) })),
    ...res.shuffleRounds.map((r) => ({ ...projectMatch(r, 'shuffleRound'), metrics: computeMatchMetrics(r) })),
  ];
```

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test` — all green. Run: `npx tsc --noEmit` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/view/renderReport.ts src/cli/view.ts test/renderReport.test.ts
git commit -m "feat: render the player metrics block in the debug report

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Generate a real report (the deliverable)**

Run against the latest staged log so the user can ground-truth metrics:
```bash
npm run view -- "D:/WoW_Arena_Coach/sample_data/logs/WoWCombatLog-052926_235715.txt"
```
(Or whichever log is newest under the configured `sampleLogsDir`.) Confirm it prints `Wrote report: <abs path>` and that the report now contains a "Metrics (you)" block per match. Report the absolute path + the player metric numbers for the first 2–3 matches (so the user can spot-check). `output/` is git-ignored — do NOT commit the report.

---

## Self-Review

**1. Spec coverage:**
- §2 disruption-out (interrupts+what-kicked, dispels purge/cleanse, spellsteal) → Task 3 metrics + Task 4 render. ✓
- §2 disruption-in (interrupted+what, buffs lost) → Task 3 (`interruptsSuffered*`, `buffsLostToPurgeOrSteal`). ✓
- §2 tempo (casts, casts/min, topCasts) → Task 3. ✓
- §2 outcome (deaths, deathTimesSec, ally/enemy deaths) → Task 3. ✓
- §2 per-combatant tally → Task 3 (`perCombatant`) + Task 4 render. ✓
- §3 playerUnits (player + pets) → Task 2. ✓
- §3 registry → Task 3 (`registry.ts`). ✓
- §3 eventAccess isolation → Task 1. ✓
- §4 shapes → Task 3 types (identical). ✓
- §5 report integration (ParsedMatchView.metrics, view.ts populate, pure render) → Task 4. ✓
- §7 error handling (missing playerId → empty set → zeros; castsPerMin null; defensive access; GUID-as-name fallback) → Task 2 (empty set), Task 3 (`bump` name fallback, castsPerMin guard). ✓
- §8 testing (synthetic metrics, playerUnits, golden) → Tasks 1–3 tests. ✓
- Deliverable: real report → Task 4 Step 8. ✓

**2. Placeholder scan:** No TBD/TODO. The field-name uncertainty is handled by Task 1's accessor module + a TDD test on real data that forces discovery (Step 4), and explicit "report adjustments" instructions in Tasks 1/3 — concrete, not placeholders.

**3. Type consistency:** `MatchMetrics`/`PlayerMetrics`/`SpellTally`/`CombatantTally` defined in `metrics.ts` (Task 3), imported by `renderReport.ts` and the render test (Task 4) — identical. `computeMatchMetrics(match): MatchMetrics` signature matches all call sites (Task 3 tests, Task 4 view.ts). `resolvePlayerUnits(match): Set<string>` consistent (Task 2 + used in Task 3). Accessor signatures (`eventType`/`srcId`/`destId`/`spellName`/`extraSpellName`/`auraType`/`eventTimeMs`) consistent between Task 1 and their use in Tasks 2–3.
