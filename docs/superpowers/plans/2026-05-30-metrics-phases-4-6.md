# Metrics Phases 4–6 + Time-Series + Spell-Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a retained position/HP time-series, a curated spell-metadata table, an aura-state tracker, and Phases 4 (suffered + defensives), 5 (damage/healing attribution + exclusions), and 6 (coordination/targeting) to the per-unit metric model, surfaced leanly in the report + a replay-data JSON export.

**Architecture:** Extend the existing `src/metrics/` per-unit pipeline (`types`/`perUnit`/`grouping`/`timeline`/`metrics`) with new focused modules (`sampleAt`, `auraState`, `coordination`, `src/metadata/spells`). New event field access (`amount`, position already added) is isolated in `eventAccess` and discovered via TDD on the real fixture. Report rendering is extracted into `renderMetrics.ts` and kept lean (validation, not UI); the full position track is exported to `output/replay/<id>.json`, not inlined.

**Tech Stack:** TypeScript/ESM (Node ≥22), Vitest. Consumes the vendored `@wowarenalogs/parser` match objects.

---

## Existing confirmed shape

Events: `logLine.event` (type), `srcUnitId`/`destUnitId`, `spellName`, `extraSpellName`, `timestamp` (ms), `auraType`=`logLine.parameters[14]`, `position`=`advancedActorPositionX/Y` + `advancedActorFacing`, HP=`advancedActorCurrentHp`/`advancedActorMaxHp`. Accessors live in `src/metrics/eventAccess.ts` (`eventType`,`srcId`,`destId`,`spellName`,`extraSpellName`,`auraType`,`eventTimeMs`,`position`,`matchStartMs`). Spell **id** accessor does NOT exist yet — add `spellId(ev)` in Task 1. Units: `name`,`type`(1/3/4),`reaction`,`spec`,`ownerId`. `src/metrics/types.ts` holds shapes + `tally`/`mergeTallies`/`unitKind`/`unitTeam`. `metrics.ts` `export * from './types.js'`.

---

## Task 1: Accessors — `spellId`, `extraSpellId`, `amount`, HP (TDD discovery)

**Files:** Modify `src/metrics/eventAccess.ts`; Create `test/eventAccessAmount.test.ts`

- [ ] **Step 1: Write the failing test** — `test/eventAccessAmount.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { eventType, spellId, amount, hpPct } from '../src/metrics/eventAccess.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

describe('amount / spellId / hpPct (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('reads damage amount + spellId + hp off real events', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const events: unknown[] = (arenaMatches[0] as { events: unknown[] }).events;
    const dmg = events.find((e) => eventType(e) === 'SPELL_DAMAGE');
    expect(dmg, 'a SPELL_DAMAGE event exists').toBeTruthy();
    expect(typeof amount(dmg)).toBe('number');
    expect(amount(dmg)).toBeGreaterThan(0);
    expect(typeof spellId(dmg)).toBe('number');
    expect(spellId(dmg)).toBeGreaterThan(0);
    const adv = events.find((e) => hpPct(e) !== undefined);
    expect(adv, 'some event carries HP').toBeTruthy();
    const p = hpPct(adv)!;
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run test/eventAccessAmount.test.ts` (no `spellId`/`amount`/`hpPct` exports).

- [ ] **Step 3: Add accessors to `src/metrics/eventAccess.ts`** (best-guess + fallbacks)

```ts
export function spellId(ev: unknown): number | undefined {
  const e = ev as Record<string, unknown>;
  const v = e?.spellId ?? e?.spellID;
  return typeof v === 'number' && v > 0 ? v : undefined;
}
export function extraSpellId(ev: unknown): number | undefined {
  const e = ev as Record<string, unknown>;
  const v = e?.extraSpellId ?? e?.extraSpellID;
  return typeof v === 'number' && v > 0 ? v : undefined;
}
export function amount(ev: unknown): number {
  const e = ev as Record<string, unknown>;
  const v = e?.amount ?? e?.effectiveAmount ?? e?.damageAmount ?? e?.healAmount;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
export function hpPct(ev: unknown): number | undefined {
  const e = ev as Record<string, unknown>;
  const cur = e?.advancedActorCurrentHp;
  const max = e?.advancedActorMaxHp;
  if (typeof cur !== 'number' || typeof max !== 'number' || max <= 0) return undefined;
  return Math.max(0, Math.min(1, cur / max));
}
```

- [ ] **Step 4: Run; if FAIL, discover real field names & fix.** Run the test. If a field is wrong, dump a SPELL_DAMAGE event's keys:
```
npx tsx -e "import('./src/parser/parserClient.js').then(async m=>{const {arenaMatches}=await m.parseLogFile('test-data/fixtures/arena-sample.log');const e=arenaMatches[0].events.find(x=>(x.logLine?.event)==='SPELL_DAMAGE');console.log(Object.keys(e));console.log(JSON.stringify(e).slice(0,900));})"
```
Adjust `amount`/`spellId`/`hpPct` to the REAL fields (check `vendor/wowarenalogs/packages/parser/dist/index.d.ts` for `CombatHpUpdateAction`/`CombatAdvancedAction`). Re-run until PASS. **Report the real field names.** `npx tsc --noEmit` clean; full `npm test`.

- [ ] **Step 5: Commit**
```bash
git add src/metrics/eventAccess.ts test/eventAccessAmount.test.ts
git commit -m "feat: spellId/extraSpellId/amount/hpPct accessors (TDD-discovered)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Types additions + `sampleAt`

**Files:** Modify `src/metrics/types.ts`; Create `src/metrics/sampleAt.ts`, `test/sampleAt.test.ts`

- [ ] **Step 1: Add shapes to `src/metrics/types.ts`** (append to the file)

```ts
export interface Sample { tSec: number; x: number; y: number; facing?: number; hpPct?: number; }

export type DrCategory = 'stun' | 'incapacitate' | 'disorient' | 'silence' | 'root' | 'knockback' | 'fear' | 'disarm';

export interface CcTakenEntry { category: DrCategory; count: number; durationSec: number; }

export interface CoordinationSummary {
  focusFireWindows: number;
  topFocusTarget?: string;
  targetPriority: { name: string; damageTaken: number }[];
  healerPressureDamage: number;
  swaps: number;
}
```
Then EXTEND the existing `UnitMetrics` interface with these fields (add inside it):
```ts
  track: Sample[];
  // Phase 4 suffered/defensives
  interruptsSuffered: number;
  interruptsSufferedBySpell: SpellTally[];
  ccTaken: number;
  ccTakenByCategory: CcTakenEntry[];
  deathsWhileCcd: number;
  deathsWhileCcdBySpell: SpellTally[];
  defensivesUsed: number;
  defensivesUsedBySpell: SpellTally[];
  defensivesIntoBurst: number;
  // Phase 5 damage/healing
  damageDone: number;
  healingDone: number;
  absorbDone: number;
  dps: number;
  hps: number;
```
And EXTEND `CombinedTotals` with: `damageDone: number; healingDone: number;`.
And EXTEND `MatchMetrics` with: `coordination: { team: Team; summary: CoordinationSummary }[];`.

- [ ] **Step 2: Write the failing test** — `test/sampleAt.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { sampleAt } from '../src/metrics/sampleAt.js';
import type { Sample } from '../src/metrics/types.js';

const track: Sample[] = [
  { tSec: 0, x: 0, y: 0, hpPct: 1 },
  { tSec: 10, x: 10, y: 0, hpPct: 0.5 },
  { tSec: 20, x: 10, y: 10, hpPct: 0 },
];

describe('sampleAt', () => {
  it('lerps position and step-holds hp between samples', () => {
    const s = sampleAt(track, 5)!;
    expect(s.x).toBeCloseTo(5, 5);   // halfway between (0,0) and (10,0)
    expect(s.y).toBeCloseTo(0, 5);
    expect(s.hpPct).toBe(1);         // step-hold: still the t=0 sample's hp
  });
  it('returns exact sample at a boundary', () => {
    expect(sampleAt(track, 10)).toMatchObject({ x: 10, y: 0, hpPct: 0.5 });
  });
  it('clamps before first / after last; undefined for empty', () => {
    expect(sampleAt(track, -5)).toMatchObject({ x: 0, y: 0 });
    expect(sampleAt(track, 999)).toMatchObject({ x: 10, y: 10 });
    expect(sampleAt([], 5)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run, confirm FAIL** — `npx vitest run test/sampleAt.test.ts`.

- [ ] **Step 4: Implement `src/metrics/sampleAt.ts`**

```ts
import type { Sample } from './types.js';

/** Position-at-T: lerp X/Y between bracketing samples; step-hold hpPct (do not smooth HP). */
export function sampleAt(track: Sample[], tSec: number): Sample | undefined {
  if (track.length === 0) return undefined;
  if (tSec <= track[0].tSec) return track[0];
  if (tSec >= track[track.length - 1].tSec) return track[track.length - 1];
  // binary search for the last sample with tSec <= t
  let lo = 0;
  let hi = track.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track[mid].tSec <= tSec) lo = mid;
    else hi = mid - 1;
  }
  const a = track[lo];
  const b = track[lo + 1] ?? a;
  if (a.tSec === b.tSec) return a;
  const f = (tSec - a.tSec) / (b.tSec - a.tSec);
  return { tSec, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, facing: a.facing, hpPct: a.hpPct };
}
```

- [ ] **Step 5: Run, confirm PASS** — `npx vitest run test/sampleAt.test.ts`. `npx tsc --noEmit` — NOTE: extending `UnitMetrics`/`CombinedTotals`/`MatchMetrics` will break `perUnit.ts`/`grouping.ts`/`metrics.ts`/`renderReport.ts` + tests that build those objects (missing new fields). That is EXPECTED until later tasks fill them. Confirm the ONLY tsc errors are "missing property" on those metric objects; `sampleAt.ts` + `types.ts` compile clean. Do NOT run full `npm test` as a gate yet.

- [ ] **Step 6: Commit**
```bash
git add src/metrics/types.ts src/metrics/sampleAt.ts test/sampleAt.test.ts
git commit -m "feat: time-series Sample type, sampleAt lerp lookup, Phase 4-6 type fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Spell-metadata table

**Files:** Create `src/metadata/spells.curated.json`, `src/metadata/spells.ts`, `test/spells.test.ts`

- [ ] **Step 1: Create `src/metadata/spells.curated.json`** (curated seed — stable IDs; extensible)

```json
{
  "1766":  { "name": "Kick",            "tags": ["interrupt"] },
  "2139":  { "name": "Counterspell",    "tags": ["interrupt"] },
  "6552":  { "name": "Pummel",          "tags": ["interrupt"] },
  "47528": { "name": "Mind Freeze",     "tags": ["interrupt"] },
  "57994": { "name": "Wind Shear",      "tags": ["interrupt"] },
  "19647": { "name": "Spell Lock",      "tags": ["interrupt"] },
  "106839":{ "name": "Skull Bash",      "tags": ["interrupt"] },
  "96231": { "name": "Rebuke",          "tags": ["interrupt"] },
  "183752":{ "name": "Disrupt",         "tags": ["interrupt"] },
  "147362":{ "name": "Counter Shot",    "tags": ["interrupt"] },
  "187707":{ "name": "Muzzle",          "tags": ["interrupt"] },
  "118":   { "name": "Polymorph",       "tags": ["cc"], "ccCategory": "incapacitate", "drCategory": "incapacitate" },
  "51514": { "name": "Hex",             "tags": ["cc"], "ccCategory": "incapacitate", "drCategory": "incapacitate" },
  "605":   { "name": "Mind Control",    "tags": ["cc"], "ccCategory": "disorient",    "drCategory": "disorient" },
  "5782":  { "name": "Fear",            "tags": ["cc"], "ccCategory": "fear",         "drCategory": "fear" },
  "33786": { "name": "Cyclone",         "tags": ["cc"], "ccCategory": "disorient",    "drCategory": "disorient" },
  "853":   { "name": "Hammer of Justice","tags": ["cc"], "ccCategory": "stun",        "drCategory": "stun" },
  "408":   { "name": "Kidney Shot",     "tags": ["cc"], "ccCategory": "stun",         "drCategory": "stun" },
  "1833":  { "name": "Cheap Shot",      "tags": ["cc"], "ccCategory": "stun",         "drCategory": "stun" },
  "2094":  { "name": "Blind",           "tags": ["cc"], "ccCategory": "disorient",    "drCategory": "disorient" },
  "6770":  { "name": "Sap",             "tags": ["cc"], "ccCategory": "incapacitate", "drCategory": "incapacitate" },
  "115078":{ "name": "Paralysis",       "tags": ["cc"], "ccCategory": "incapacitate", "drCategory": "incapacitate" },
  "339":   { "name": "Entangling Roots","tags": ["cc"], "ccCategory": "root",         "drCategory": "root" },
  "45438": { "name": "Ice Block",       "tags": ["defensive", "immunity"] },
  "642":   { "name": "Divine Shield",   "tags": ["defensive", "immunity"] },
  "31224": { "name": "Cloak of Shadows","tags": ["defensive", "immunity"] },
  "47585": { "name": "Dispersion",      "tags": ["defensive"] },
  "104773":{ "name": "Unending Resolve","tags": ["defensive"] },
  "108416":{ "name": "Dark Pact",       "tags": ["defensive"] },
  "22812": { "name": "Barkskin",        "tags": ["defensive"] },
  "186265":{ "name": "Aspect of the Turtle", "tags": ["defensive", "immunity"] }
}
```
(This seed is intentionally partial; the documented generator — DRList-1.0 + BigDebuffs + OmniBar validated against wago.tools — will expand/refresh it later.)

- [ ] **Step 2: Write the failing test** — `test/spells.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { spellMeta, isInterrupt, ccInfo, isDefensive } from '../src/metadata/spells.js';

describe('spell metadata', () => {
  it('classifies interrupts', () => {
    expect(isInterrupt(1766)).toBe(true);   // Kick
    expect(isInterrupt(118)).toBe(false);   // Polymorph
  });
  it('returns CC info with DR category', () => {
    expect(ccInfo(408)).toMatchObject({ category: 'stun', dr: 'stun' }); // Kidney Shot
    expect(ccInfo(1766)).toBeUndefined();
  });
  it('classifies defensives', () => {
    expect(isDefensive(45438)).toBe(true);  // Ice Block
    expect(isDefensive(1766)).toBe(false);
  });
  it('returns undefined for unknown ids', () => {
    expect(spellMeta(99999999)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run, confirm FAIL** — `npx vitest run test/spells.test.ts`.

- [ ] **Step 4: Implement `src/metadata/spells.ts`**

```ts
import data from './spells.curated.json' with { type: 'json' };
import type { DrCategory } from '../metrics/types.js';

export type SpellTag = 'interrupt' | 'cc' | 'defensive' | 'immunity' | 'offensive';
export interface SpellMeta { name: string; tags: SpellTag[]; ccCategory?: DrCategory; drCategory?: DrCategory; priority?: number; }

const TABLE = data as Record<string, SpellMeta>;

export function spellMeta(id: number | undefined): SpellMeta | undefined {
  return id === undefined ? undefined : TABLE[String(id)];
}
export function isInterrupt(id: number | undefined): boolean {
  return spellMeta(id)?.tags.includes('interrupt') ?? false;
}
export function ccInfo(id: number | undefined): { category: DrCategory; dr?: DrCategory } | undefined {
  const m = spellMeta(id);
  if (!m || !m.tags.includes('cc') || !m.ccCategory) return undefined;
  return { category: m.ccCategory, dr: m.drCategory };
}
export function isDefensive(id: number | undefined): boolean {
  return spellMeta(id)?.tags.includes('defensive') ?? false;
}
```
(If the `import ... with { type: 'json' }` assertion errors under the TS/Node config, fall back to `readFileSync(new URL('./spells.curated.json', import.meta.url), 'utf8')` + `JSON.parse`. Report which form was used.)

- [ ] **Step 5: Run, confirm PASS** — `npx vitest run test/spells.test.ts` (4 tests). `npx tsc --noEmit` (the metric-object errors from Task 2 persist; spells.ts itself clean).

- [ ] **Step 6: Commit**
```bash
git add src/metadata/spells.curated.json src/metadata/spells.ts test/spells.test.ts
git commit -m "feat: curated spell-metadata table (interrupts/CC+DR/defensives) + helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Aura-state tracker

**Files:** Create `src/metrics/auraState.ts`, `test/auraState.test.ts`

- [ ] **Step 1: Write the failing test** — `test/auraState.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildAuraState } from '../src/metrics/auraState.js';

const match = {
  units: { P: { name: 'You' } },
  events: [
    { logLine: { event: 'SPELL_AURA_APPLIED' }, destUnitId: 'P', spellId: 408, spellName: 'Kidney Shot', timestamp: 1000 },
    { logLine: { event: 'SPELL_AURA_REMOVED' }, destUnitId: 'P', spellId: 408, spellName: 'Kidney Shot', timestamp: 5000 },
    { logLine: { event: 'SPELL_AURA_APPLIED' }, destUnitId: 'P', spellId: 118, spellName: 'Polymorph', timestamp: 8000 },
  ],
};

describe('buildAuraState', () => {
  const st = buildAuraState(match);
  it('reports an aura active during its interval', () => {
    expect(st.activeOn('P', 3000).map((a) => a.spellId)).toContain(408);   // mid Kidney
    expect(st.activeOn('P', 6000).map((a) => a.spellId)).not.toContain(408); // after removed
  });
  it('treats an unremoved aura as active through match end', () => {
    expect(st.activeOn('P', 9999).map((a) => a.spellId)).toContain(118);   // Polymorph never removed
  });
});
```
NOTE: `timestamp` here is ms (absolute); `activeOn` takes the same ms unit. (Phase-4 callers pass the death event's ms.)

- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run test/auraState.test.ts`.

- [ ] **Step 3: Implement `src/metrics/auraState.ts`**

```ts
import { eventType, destId, spellId, spellName, eventTimeMs } from './eventAccess.js';

interface Interval { spellId: number; name: string; start: number; end: number; }
export interface AuraState { activeOn(unitId: string, ms: number): { spellId: number; name: string }[]; }

export function buildAuraState(match: unknown): AuraState {
  const m = match as { events?: unknown[] };
  const events = Array.isArray(m.events) ? m.events : [];
  const lastMs = events.length > 0 ? (eventTimeMs(events[events.length - 1]) ?? Number.MAX_SAFE_INTEGER) : 0;

  const intervals = new Map<string, Interval[]>(); // unitId -> closed intervals
  const open = new Map<string, Map<number, Interval>>(); // unitId -> spellId -> open interval

  const push = (id: string, iv: Interval) => {
    const arr = intervals.get(id) ?? [];
    arr.push(iv);
    intervals.set(id, arr);
  };

  for (const ev of events) {
    const t = eventType(ev);
    const id = destId(ev);
    const sid = spellId(ev);
    const ms = eventTimeMs(ev);
    if (!id || sid === undefined || ms === undefined) continue;
    if (t === 'SPELL_AURA_APPLIED' || t === 'SPELL_AURA_REFRESH') {
      let u = open.get(id);
      if (!u) { u = new Map(); open.set(id, u); }
      if (!u.has(sid)) u.set(sid, { spellId: sid, name: spellName(ev), start: ms, end: lastMs });
    } else if (t === 'SPELL_AURA_REMOVED') {
      const iv = open.get(id)?.get(sid);
      if (iv) { iv.end = ms; open.get(id)!.delete(sid); push(id, iv); }
    }
  }
  // any still-open auras remain active through lastMs
  for (const [id, u] of open) for (const iv of u.values()) push(id, iv);

  return {
    activeOn(unitId, ms) {
      return (intervals.get(unitId) ?? [])
        .filter((iv) => ms >= iv.start && ms < iv.end)
        .map((iv) => ({ spellId: iv.spellId, name: iv.name }));
    },
  };
}
```

- [ ] **Step 4: Run, confirm PASS** — `npx vitest run test/auraState.test.ts` (2 tests). `npx tsc --noEmit` (metric-object errors persist; auraState clean).

- [ ] **Step 5: Commit**
```bash
git add src/metrics/auraState.ts test/auraState.test.ts
git commit -m "feat: aura-state tracker (active auras on a unit at time T)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: perUnit — retain track + Phase 4 (suffered/cc/deaths-while-ccd/defensives) + Phase 5 (damage/healing+exclusions)

**Files:** Modify `src/metrics/perUnit.ts`; Rewrite `test/perUnit.test.ts` additions

This is the core extension. `computeUnitMetrics` gains a dependency on the aura-state + metadata + sampleAt and must populate all the new `UnitMetrics` fields. Because it now needs the aura-state (a pre-pass) and team lookup (source vs dest team for exclusions), change its signature to accept the prebuilt aura-state.

- [ ] **Step 1: Write the failing tests** — add to `test/perUnit.test.ts` (keep existing tests; update the `computeUnitMetrics(match)` calls to `computeUnitMetrics(match, buildAuraState(match))` — import `buildAuraState`)

```ts
import { buildAuraState } from '../src/metrics/auraState.js';

function run(match: any) { return computeUnitMetrics(match, buildAuraState(match)); }

describe('perUnit Phase 4/5', () => {
  const match = {
    playerId: 'P',
    durationInSeconds: 100,
    units: {
      P: { name: 'You', type: 1, reaction: 1 },
      E: { name: 'Enemy', type: 1, reaction: 2 },
      ALLY: { name: 'Ally', type: 1, reaction: 1 },
    },
    events: [
      // P kicks E (already covered elsewhere); here: E kicks P (suffered)
      { logLine: { event: 'SPELL_INTERRUPT' }, srcUnitId: 'E', destUnitId: 'P', spellName: 'Counterspell', extraSpellName: 'Polymorph', timestamp: 1000 },
      // P is CC'd: Kidney (stun) applied then P dies while stunned
      { logLine: { event: 'SPELL_AURA_APPLIED' }, srcUnitId: 'E', destUnitId: 'P', spellId: 408, spellName: 'Kidney Shot', timestamp: 2000 },
      { logLine: { event: 'UNIT_DIED' }, destUnitId: 'P', timestamp: 3000 },
      { logLine: { event: 'SPELL_AURA_REMOVED' }, destUnitId: 'P', spellId: 408, spellName: 'Kidney Shot', timestamp: 4000 },
      // P uses a defensive
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellId: 104773, spellName: 'Unending Resolve', timestamp: 2500 },
      // P damages E (counts); P damages ALLY (friendly-fire, excluded); E damages P (P's damageDone unaffected)
      { logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'P', destUnitId: 'E', spellName: 'Chaos Bolt', amount: 1000, timestamp: 5000 },
      { logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'P', destUnitId: 'ALLY', spellName: 'Rain of Fire', amount: 50, timestamp: 5500 },
      { logLine: { event: 'SPELL_HEAL' }, srcUnitId: 'ALLY', destUnitId: 'P', spellName: 'Heal', amount: 300, timestamp: 6000 },
    ],
  };
  const units = run(match);
  const me = units.find((u) => u.unitId === 'P')!;

  it('counts interrupts suffered + what got kicked', () => {
    expect(me.interruptsSuffered).toBe(1);
    expect(me.interruptsSufferedBySpell).toEqual([{ spellName: 'Polymorph', count: 1 }]);
  });
  it('detects death while CC-d (stun active at death)', () => {
    expect(me.deathsWhileCcd).toBe(1);
    expect(me.deathsWhileCcdBySpell).toEqual([{ spellName: 'Kidney Shot', count: 1 }]);
  });
  it('counts defensives used', () => {
    expect(me.defensivesUsed).toBe(1);
    expect(me.defensivesUsedBySpell).toEqual([{ spellName: 'Unending Resolve', count: 1 }]);
  });
  it('attributes damage with friendly-fire exclusion', () => {
    expect(me.damageDone).toBe(1000); // hit on E counts; hit on ALLY (friendly) excluded
    expect(me.dps).toBeCloseTo(600, 0); // 1000 dmg / 100s * 60
  });
  it('attributes healing received unaffects P healingDone; ALLY healingDone counts it', () => {
    expect(me.healingDone).toBe(0);
    expect(units.find((u) => u.unitId === 'ALLY')!.healingDone).toBe(300);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run test/perUnit.test.ts` (signature change + missing fields).

- [ ] **Step 3: Modify `src/metrics/perUnit.ts`** — extend `Acc`, the loop, and the result mapping. Apply these changes:

(a) Imports: add `import { spellId, amount, hpPct } from './eventAccess.js';`, `import { isInterrupt, ccInfo, isDefensive } from '../metadata/spells.js';`, `import type { AuraState } from './auraState.js';`, and `import { sampleAt } from './sampleAt.js';`. Add `unitTeam` is already imported; ensure `Sample`, `CcTakenEntry` types imported from `./types.js`.

(b) Extend the `Acc` interface with:
```ts
  interruptsSuffered: string[];
  ccTaken: { category: string; ms: number; spell: string }[];
  deathsWhileCcd: string[];
  defensives: { spell: string; ms: number }[];
  damageDone: number;
  healingDone: number;
  absorbDone: number;
  samples: Sample[];
```
and initialize them in `emptyAcc()` (arrays `[]`, numbers `0`).

(c) Change signature: `export function computeUnitMetrics(match: unknown, auras: AuraState): UnitMetrics[]`. Compute `startMs = matchStartMs(events)` (already present). Add a team lookup: `const teamOf = (id: string|undefined) => unitTeam((units[id ?? ''] ?? {}).reaction);`.

(d) In the event loop, after the existing branches, ADD handling (note: keep existing cast/interrupt-landed/dispel/steal/death branches; add the new attributions). Specifically:
- For EVERY event with a source `s`, capture a position/HP sample: `const p = position(ev); const ms = eventTimeMs(ev); if (s && ms !== undefined && startMs !== undefined) { const hp = hpPct(ev); if (p || hp !== undefined) acc(s).samples.push({ tSec: (ms - startMs)/1000, x: p?.x ?? NaN, y: p?.y ?? NaN, facing: p?.facing, hpPct: hp }); }` — but only push x/y when `p` exists (for pure-HP events store x/y as the last known? Simpler: only push a sample when `p` exists; capture hpPct on it too). Use: `if (s && p && ms !== undefined && startMs !== undefined) acc(s).samples.push({ tSec:(ms-startMs)/1000, x:p.x, y:p.y, facing:p.facing, hpPct: hpPct(ev) });`
- `SPELL_INTERRUPT` where dest `d` is the unit: `acc(d).interruptsSuffered.push(extraSpellName(ev) ?? spellName(ev))` (in addition to the existing source-side interruptsLanded).
- `SPELL_AURA_APPLIED`/`SPELL_AURA_REFRESH`: `const cc = ccInfo(spellId(ev)); if (cc && d) acc(d).ccTaken.push({ category: cc.category, ms: eventTimeMs(ev) ?? 0, spell: spellName(ev) });`
- `SPELL_CAST_SUCCESS` where `isDefensive(spellId(ev))` and src `s`: `acc(s).defensives.push({ spell: spellName(ev), ms: eventTimeMs(ev) ?? 0 });` (this is IN ADDITION to the existing cast counting).
- `UNIT_DIED` dest `d`: in addition to existing death handling, query auras: `const active = auras.activeOn(d, eventTimeMs(ev) ?? -1); const cc = active.find((a) => ccInfo(a.spellId)); if (cc) acc(d).deathsWhileCcd.push(cc.name);`
- Damage events (`SPELL_DAMAGE`/`SPELL_PERIODIC_DAMAGE`/`SWING_DAMAGE`/`SWING_DAMAGE_LANDED`/`RANGE_DAMAGE`) with src `s`, dest `d`: apply exclusion — count only if NOT friendly-fire: `if (s && teamOf(s) !== teamOf(d)) acc(s).damageDone += amount(ev);` (different teams ⇒ real damage; same team ⇒ excluded; `neutral` vs anything counts as different ⇒ counted, acceptable).
- Heal events (`SPELL_HEAL`/`SPELL_PERIODIC_HEAL`) with src `s`: `acc(s).healingDone += amount(ev);` (healing attributed to the healer regardless of target).
- Absorb (`SPELL_ABSORBED`): best-effort — `if (s) acc(s).absorbDone += amount(ev);` (source of the absorbing shield where available; if the shape differs this stays 0 — acceptable for this slice).

(e) In the result mapping, sort `a.samples` by tSec into `track`, and add the new fields:
```ts
  const track = a.samples.sort((x, y) => x.tSec - y.tSec);
  const ccByCat = new Map<string, { count: number; durationSec: number }>();
  for (const c of a.ccTaken) { const e = ccByCat.get(c.category) ?? { count: 0, durationSec: 0 }; e.count += 1; ccByCat.set(c.category, e); }
  const durationSec = typeof m.durationInSeconds === 'number' ? m.durationInSeconds : 0;
  // defensivesIntoBurst: a defensive cast where the unit's hp dropped within [t-2s, t+1s] (via track) OR n/a if no track
  let defensivesIntoBurst = 0;
  for (const d of a.defensives) {
    if (startMs === undefined) break;
    const tSec = (d.ms - startMs) / 1000;
    const before = sampleAt(track, tSec - 2)?.hpPct;
    const after = sampleAt(track, tSec + 1)?.hpPct;
    if (before !== undefined && after !== undefined && before - after >= 0.15) defensivesIntoBurst += 1;
  }
```
Then in the returned object add:
```ts
    track,
    interruptsSuffered: a.interruptsSuffered.length,
    interruptsSufferedBySpell: tally(a.interruptsSuffered),
    ccTaken: a.ccTaken.length,
    ccTakenByCategory: [...ccByCat.entries()].map(([category, v]) => ({ category, count: v.count, durationSec: Math.round(v.durationSec) })) as CcTakenEntry[],
    deathsWhileCcd: a.deathsWhileCcd.length,
    deathsWhileCcdBySpell: tally(a.deathsWhileCcd),
    defensivesUsed: a.defensives.length,
    defensivesUsedBySpell: tally(a.defensives.map((d) => d.spell)),
    defensivesIntoBurst,
    damageDone: Math.round(a.damageDone),
    healingDone: Math.round(a.healingDone),
    absorbDone: Math.round(a.absorbDone),
    dps: durationSec > 0 ? Math.round((a.damageDone / durationSec) * 60) / 60 * 60 : 0,
    hps: durationSec > 0 ? Math.round((a.healingDone / durationSec) * 60) / 60 * 60 : 0,
```
NOTE on dps: the intent is damage-per-second. Use `dps: durationSec > 0 ? Math.round(a.damageDone / durationSec) : 0` (per-second). (Fix the expression to plain per-second; ignore the convoluted form above — `Math.round(a.damageDone / durationSec)`.) Same for hps.
(`ccTakenByCategory.durationSec` is left at 0 for this slice — duration tracking from aura intervals is a refinement; the count is the signal. Keep the field for shape stability.)

- [ ] **Step 4: Run, confirm PASS** — `npx vitest run test/perUnit.test.ts`. (The DPS assertion in the test expects `damageDone/duration*60`? — re-check: the test asserts `me.dps` ≈ 600 for 1000 dmg / 100s. That is per-MINUTE. DECIDE: dps = per-second is conventional. Update the TEST to `expect(me.dps).toBe(10)` (1000/100 = 10 dps) and keep `dps = Math.round(a.damageDone/durationSec)`.) Make the test and impl agree on **damage per second**. Re-run until green. `npx tsc --noEmit` (grouping/metrics/render still error until next tasks).

- [ ] **Step 5: Commit**
```bash
git add src/metrics/perUnit.ts test/perUnit.test.ts
git commit -m "feat: perUnit Phase 4 (suffered/cc/deaths-while-ccd/defensives) + Phase 5 (dmg/heal+exclusions) + track

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: grouping — combined damage/healing

**Files:** Modify `src/metrics/grouping.ts`, `test/grouping.test.ts`

- [ ] **Step 1: Add a test** — in `test/grouping.test.ts`, extend the `u(...)` helper defaults to include the new `UnitMetrics` fields (set all new numeric fields to 0, arrays to [], `track: []`), then add:
```ts
it('combines damage/healing across player+pets', () => {
  const units = [
    u({ unitId: 'P', kind: 'player', team: 'friendly', damageDone: 1000, healingDone: 0 }),
    u({ unitId: 'PET', kind: 'primary-pet', team: 'friendly', ownerId: 'P', damageDone: 400, healingDone: 0 }),
  ];
  const pg = groupUnits(units, 'P').find((t) => t.team === 'friendly')!.players[0];
  expect(pg.combined.damageDone).toBe(1400);
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run test/grouping.test.ts`.

- [ ] **Step 3: Modify `combine()` in `src/metrics/grouping.ts`** — add to the returned `CombinedTotals`:
```ts
    damageDone: sum((u) => u.damageDone),
    healingDone: sum((u) => u.healingDone),
```

- [ ] **Step 4: Run, confirm PASS** — `npx vitest run test/grouping.test.ts`. `npx tsc --noEmit` (metrics/render still error until Tasks 7–8).

- [ ] **Step 5: Commit**
```bash
git add src/metrics/grouping.ts test/grouping.test.ts
git commit -m "feat: combined player+pet damage/healing totals

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Coordination (Phase 6)

**Files:** Create `src/metrics/coordination.ts`, `test/coordination.test.ts`

- [ ] **Step 1: Write the failing test** — `test/coordination.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { computeCoordination } from '../src/metrics/coordination.js';

const match = {
  units: {
    A1: { name: 'Ally1', type: 1, reaction: 1, spec: '0' },
    A2: { name: 'Ally2', type: 1, reaction: 1, spec: '0' },
    H:  { name: 'EnemyHealer', type: 1, reaction: 2, spec: '105' }, // resto druid (healer spec id)
    E:  { name: 'EnemyDps', type: 1, reaction: 2, spec: '0' },
  },
  events: [
    { logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'A1', destUnitId: 'E', amount: 500, timestamp: 1000 },
    { logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'A2', destUnitId: 'E', amount: 500, timestamp: 1500 }, // both hit E within 3s -> focus-fire window
    { logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'A1', destUnitId: 'H', amount: 200, timestamp: 9000 }, // healer pressure
  ],
};

describe('computeCoordination', () => {
  const teams = computeCoordination(match, ['105']); // pass healer spec ids
  const friendly = teams.find((t) => t.team === 'friendly')!.summary;
  it('detects a focus-fire window and top target', () => {
    expect(friendly.focusFireWindows).toBeGreaterThanOrEqual(1);
    expect(friendly.topFocusTarget).toBe('EnemyDps');
  });
  it('measures healer pressure on the enemy team', () => {
    expect(friendly.healerPressureDamage).toBe(200);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run test/coordination.test.ts`.

- [ ] **Step 3: Implement `src/metrics/coordination.ts`**

```ts
import { eventType, srcId, destId, amount, eventTimeMs } from './eventAccess.js';
import { unitTeam, type Team, type CoordinationSummary } from './types.js';

const FOCUS_WINDOW_MS = 3000;

export function computeCoordination(match: unknown, healerSpecIds: string[]): { team: Team; summary: CoordinationSummary }[] {
  const m = match as { events?: unknown[]; units?: Record<string, { name?: unknown; reaction?: unknown; spec?: unknown }> };
  const events = Array.isArray(m.events) ? m.events : [];
  const units = m.units ?? {};
  const healer = new Set(healerSpecIds);
  const teamOf = (id: string | undefined) => unitTeam((units[id ?? ''] ?? {}).reaction);
  const nameOf = (id: string | undefined) => { const u = units[id ?? '']; return u && typeof u.name === 'string' ? u.name : id ?? '?'; };
  const isHealer = (id: string | undefined) => healer.has(String((units[id ?? ''] ?? {}).spec));

  function summarize(team: Team): CoordinationSummary {
    // damage events BY this team on the OTHER team
    const dmg = events.filter((e) => /DAMAGE/.test(eventType(e)) && teamOf(srcId(e)) === team && teamOf(destId(e)) !== team && teamOf(destId(e)) !== 'neutral');
    const byTarget = new Map<string, number>();
    for (const e of dmg) { const d = destId(e); if (d) byTarget.set(d, (byTarget.get(d) ?? 0) + amount(e)); }
    const targetPriority = [...byTarget.entries()].map(([id, damageTaken]) => ({ name: nameOf(id), damageTaken })).sort((a, b) => b.damageTaken - a.damageTaken);
    // focus-fire windows: per target, count windows where >=2 distinct attackers hit within FOCUS_WINDOW_MS
    let focusFireWindows = 0;
    const swaps = countSwaps(dmg);
    const targets = new Set([...byTarget.keys()]);
    for (const tgt of targets) {
      const hits = dmg.filter((e) => destId(e) === tgt).map((e) => ({ src: srcId(e), ms: eventTimeMs(e) ?? 0 })).sort((a, b) => a.ms - b.ms);
      for (let i = 0; i < hits.length; i++) {
        const attackers = new Set<string>();
        for (let j = i; j < hits.length && hits[j].ms - hits[i].ms <= FOCUS_WINDOW_MS; j++) if (hits[j].src) attackers.add(hits[j].src!);
        if (attackers.size >= 2) { focusFireWindows += 1; break; } // count one window per target (coarse signal)
      }
    }
    const healerPressureDamage = dmg.filter((e) => isHealer(destId(e))).reduce((s, e) => s + amount(e), 0);
    return { focusFireWindows, topFocusTarget: targetPriority[0]?.name, targetPriority, healerPressureDamage, swaps };
  }

  function countSwaps(dmg: unknown[]): number {
    let swaps = 0; let prev: string | undefined;
    for (const e of [...dmg].sort((a, b) => (eventTimeMs(a) ?? 0) - (eventTimeMs(b) ?? 0))) {
      const d = destId(e);
      if (prev !== undefined && d !== prev) swaps += 1;
      prev = d;
    }
    return swaps;
  }

  return (['friendly', 'enemy'] as Team[]).map((team) => ({ team, summary: summarize(team) }));
}
```

- [ ] **Step 4: Run, confirm PASS** — `npx vitest run test/coordination.test.ts`. `npx tsc --noEmit` (metrics/render still pending).

- [ ] **Step 5: Commit**
```bash
git add src/metrics/coordination.ts test/coordination.test.ts
git commit -m "feat: Phase 6 coordination (focus-fire windows, target priority, healer pressure, swaps)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Orchestrator wiring + healer-spec list + golden

**Files:** Modify `src/metrics/metrics.ts`, `src/metrics/registry.ts` (healer spec ids), Rewrite `test/metrics.test.ts` additions

- [ ] **Step 1: Add a `HEALER_SPEC_IDS` constant** in `src/metrics/registry.ts`:
```ts
/** WoW healer specialization IDs (used to identify enemy healers for coordination). */
export const HEALER_SPEC_IDS: string[] = ['65','105','256','257','264','270','1468','1473']; // Holy Pal, Resto Druid, Disc, Holy Priest, Resto Sham, Mistweaver, Preservation, (Augmentation? no) — see note
```
(Note: these are the standard retail healer spec IDs: HolyPaladin 65, RestoDruid 105, DiscPriest 256, HolyPriest 257, RestoShaman 264, Mistweaver 270, PreservationEvoker 1468. Adjust if a fixture shows a healer spec not matching.)

- [ ] **Step 2: Rewrite `src/metrics/metrics.ts` orchestrator**

```ts
import { computeUnitMetrics } from './perUnit.js';
import { groupUnits } from './grouping.js';
import { buildTimeline } from './timeline.js';
import { buildAuraState } from './auraState.js';
import { computeCoordination } from './coordination.js';
import { HEALER_SPEC_IDS } from './registry.js';
import type { MatchMetrics } from './types.js';

export * from './types.js';

export function computeMatchMetrics(match: unknown): MatchMetrics {
  const m = match as { playerId?: unknown };
  const playerUnitId = typeof m.playerId === 'string' ? m.playerId : undefined;
  const auras = buildAuraState(match);
  const units = computeUnitMetrics(match, auras);
  return {
    teams: groupUnits(units, playerUnitId),
    timeline: buildTimeline(match),
    coordination: computeCoordination(match, HEALER_SPEC_IDS),
    playerUnitId,
  };
}
```

- [ ] **Step 3: Update `test/metrics.test.ts`** — the synthetic orchestrator test's `computeMatchMetrics` calls still work (signature unchanged). Update the fixture golden to assert the new data:
```ts
const FIXTURE = 'test-data/fixtures/arena-sample.log';
describe('computeMatchMetrics phases 4-6 (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('produces damage, suffered, coordination, and tracks', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const mm = computeMatchMetrics(arenaMatches[0]);
    const me = mm.teams.flatMap((t) => t.players).find((p) => p.player.unitId === mm.playerUnitId)!;
    expect(me.combined.damageDone).toBeGreaterThan(0);
    expect(me.player.track.length).toBeGreaterThan(0);
    expect(typeof me.player.ccTaken).toBe('number');
    expect(typeof me.player.deathsWhileCcd).toBe('number');
    expect(mm.coordination.length).toBe(2);
    expect(mm.coordination.find((c) => c.team === 'friendly')!.summary.targetPriority.length).toBeGreaterThan(0);
  });
});
```
(Keep the existing synthetic test from before; ensure its synthetic units include the new fields implicitly via computeMatchMetrics — they will, since computeUnitMetrics now populates them.)

- [ ] **Step 4: Run + DIAGNOSTIC** — `npx vitest run test/metrics.test.ts`. Then print real numbers:
```
npx tsx -e "import('./src/parser/parserClient.js').then(async pm=>{const mm=await import('./src/metrics/metrics.js');const {arenaMatches}=await pm.parseLogFile('test-data/fixtures/arena-sample.log');const M=mm.computeMatchMetrics(arenaMatches[0]);const me=M.teams.flatMap(t=>t.players).find(p=>p.player.unitId===M.playerUnitId);console.log('you combined dmg/heal:',me.combined.damageDone,me.combined.healingDone,'dps:',me.player.dps);console.log('ccTaken:',me.player.ccTaken,'deathsWhileCcd:',me.player.deathsWhileCcd,'defensives:',me.player.defensivesUsed,'intoBurst:',me.player.defensivesIntoBurst,'track:',me.player.track.length);console.log('coordination friendly:',JSON.stringify(M.coordination.find(c=>c.team==='friendly').summary));})"
```
INCLUDE THIS OUTPUT VERBATIM in the report (sanity-check: dmg>0, dps plausible, coordination targetPriority lists enemies). `npx tsc --noEmit` — only `renderReport.ts` should still error now (fixed in Task 9).

- [ ] **Step 5: Commit**
```bash
git add src/metrics/metrics.ts src/metrics/registry.ts test/metrics.test.ts
git commit -m "feat: orchestrate aura-state + Phase 4-6 into computeMatchMetrics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Extract renderMetrics + lean report rows + replay JSON export + real report

**Files:** Create `src/view/renderMetrics.ts`; Modify `src/view/renderReport.ts`, `src/cli/view.ts`, `test/renderReport.test.ts`

- [ ] **Step 1: Move the metrics rendering into `src/view/renderMetrics.ts`.** Cut the metrics-rendering helpers (`TEAM_LABEL`, `tallyStr`, `unitRow`, `playerGroupBlock`, `teamBlock`, `timelineBlock`, `metricsBlock`) out of `renderReport.ts` into a new `src/view/renderMetrics.ts`, exporting `metricsBlock(mm: MatchMetrics | undefined): string`. Import `escapeHtml` from `renderReport.ts` (export it there) OR move `escapeHtml` into a small `src/view/html.ts` and import in both. Choose the `html.ts` approach: create `src/view/html.ts` exporting `escapeHtml`, import it in both `renderReport.ts` and `renderMetrics.ts`. `renderReport.ts` imports `metricsBlock` from `renderMetrics.js` and calls it in `matchSection` (same spot).

- [ ] **Step 2: Extend the rendering (LEAN) in `renderMetrics.ts`** — add compact columns/lines for the new data. Update `unitRow` to append damage/heal + suffered/defensive cells, and `playerGroupBlock`'s combined head to include dmg/heal; add a coordination line per team. Concretely, extend the team table header to include `dmg`, `heal`, `ccTaken`, `died-CC`, `def(used/burst)` and have `unitRow` emit:
```ts
  `<td>${u.damageDone}</td><td>${u.healingDone}</td><td>${u.ccTaken}</td><td>${u.deathsWhileCcd}</td><td>${u.defensivesUsed}/${u.defensivesIntoBurst}</td>`
```
and the combined head emit `<td>${c.damageDone}</td><td>${c.healingDone}</td>` in the matching columns (leave suffered/def blank on the head row). After the team table, add:
```ts
function coordinationBlock(coordination: { team: string; summary: { focusFireWindows: number; topFocusTarget?: string; healerPressureDamage: number; swaps: number } }[]): string {
  return coordination.map((c) => `<p class="coord">${escapeHtml(c.team)} coordination: focus-fire windows ${c.summary.focusFireWindows}, top target ${escapeHtml(c.summary.topFocusTarget ?? '—')}, healer pressure ${c.summary.healerPressureDamage}, swaps ${c.summary.swaps}</p>`).join('');
}
```
and call it inside `metricsBlock` (after the team sections, before/after the timeline). Keep it terse — validation, not UI.

- [ ] **Step 3: Update `test/renderReport.test.ts`** — the metrics-block test's `MatchMetrics` literal must include the new required fields (add `coordination: []`, and on the UnitMetrics literals add `track: [], interruptsSuffered: 0, interruptsSufferedBySpell: [], ccTaken: 0, ccTakenByCategory: [], deathsWhileCcd: 0, deathsWhileCcdBySpell: [], defensivesUsed: 0, defensivesUsedBySpell: [], defensivesIntoBurst: 0, damageDone: 0, healingDone: 0, absorbDone: 0, dps: 0, hps: 0`; on `combined` add `damageDone: 0, healingDone: 0`). Add an assertion that a coordination summary renders when present:
```ts
// extend the existing per-player metrics test's `metrics` literal with coordination, then:
expect(html).toContain('coordination');
```
Import `metricsBlock`/types as needed (the test imports `MatchMetrics` from `../src/metrics/metrics.js`).

- [ ] **Step 4: Run, confirm PASS** — `npx vitest run test/renderReport.test.ts`. Full `npm test` — ALL green now. `npx tsc --noEmit` — clean.

- [ ] **Step 5: Replay JSON export in `src/cli/view.ts`** — after computing `views`, also write per-match replay data. For each parsed match `m` with its computed `metrics`, build a compact object and write `output/replay/<matchId>.json`:
```ts
import { mkdirSync, writeFileSync } from 'node:fs'; // already imported
import { join } from 'node:path'; // already imported
// after building `views` (which carry metrics):
const replayDir = join(cfg.outputDir, 'replay');
mkdirSync(replayDir, { recursive: true });
views.forEach((v, i) => {
  if (!v.metrics) return;
  const tracks = v.metrics.teams.flatMap((t) => [...t.players.flatMap((p) => [p.player, ...p.pets]), ...t.unownedPets])
    .map((u) => ({ unitId: u.unitId, name: u.name, kind: u.kind, team: u.team, track: u.track }));
  writeFileSync(join(replayDir, `match-${i}.json`), JSON.stringify({ playerUnitId: v.metrics.playerUnitId, timeline: v.metrics.timeline, tracks }));
});
```
(matchId: use the index `i` for now — a stable per-match id can come with the store later. `output/` is git-ignored.)

- [ ] **Step 6: Run, confirm PASS** — `npm test` green, `npx tsc --noEmit` clean.

- [ ] **Step 7: Commit**
```bash
git add src/view/renderMetrics.ts src/view/renderReport.ts src/view/html.ts src/cli/view.ts test/renderReport.test.ts
git commit -m "feat: renderMetrics extraction + lean Phase 4-6 report rows + replay JSON export

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Generate the real report (deliverable)**
```bash
npm run view -- "D:/WoW_Arena_Coach/sample_data/logs/WoWCombatLog-052926_235715.txt"
```
(Reads NAS sidecars; may take minutes.) Confirm `Wrote report` + that `output/replay/match-0.json` exists and is non-trivial. Report the path, a sanity grep of the new columns (`grep -oE 'coordination|dmg|died-CC' output/report.html | head`), and `ls -la output/replay | head`.

---

## Self-Review

**1. Spec coverage:**
- §2 time-series (Sample, track retained, sampleAt, replay JSON export) → Task 2 (Sample/sampleAt) + Task 5 (track capture) + Task 9 Step 5 (export). ✓
- §3 spell-metadata (curated JSON, helpers, generator documented) → Task 3 (generator is documented in the spec; this plan ships the curated seed). ✓
- §4 aura-state tracker → Task 4. ✓
- §5 Phase 4 (suffered, ccTaken, deaths-while-ccd, defensives + intoBurst) → Task 5. ✓
- §6 Phase 5 (damage/healing, exclusions, dps/hps, combined) → Task 5 + Task 6. ✓ (absorbs best-effort.)
- §7 Phase 6 coordination → Task 7 + Task 8 (wired). ✓
- §8 shapes → Task 2 (types) + per-task fields. ✓
- §9 file structure (renderMetrics extraction, html.ts, modules) → Task 9. ✓
- §10 lean report → Task 9 Step 2. ✓
- §1/§2 amount accessor → Task 1. ✓
- §12 testing (per-module + golden) → each task's tests + Task 8 golden. ✓
- §13 deferred (replay UI, generator, DR-duration tracking) → NOT in plan; documented. ✓

**2. Placeholder scan:** No TBD/TODO. Field-name uncertainties (`amount`/`spellId`/`hpPct`) handled by Task 1's TDD-discovery on the real fixture with a concrete dump command. The dps/hps note in Task 5 explicitly resolves to per-second and aligns the test in Step 4 — no ambiguity left. The curated metadata seed is "partial by design" (a data choice, not a placeholder).

**3. Type consistency:** All new shapes (`Sample`, `DrCategory`, `CcTakenEntry`, `CoordinationSummary`, extended `UnitMetrics`/`CombinedTotals`/`MatchMetrics`) defined once in `types.ts` (Task 2) and consumed consistently. `computeUnitMetrics(match, auras)` new 2-arg signature is updated at its only call site (`metrics.ts`, Task 8) and in `perUnit.test.ts` (Task 5 via the `run()` helper). `computeMatchMetrics(match)` signature unchanged → `view.ts` call site stays valid. `buildAuraState(match): AuraState`, `computeCoordination(match, healerSpecIds): {team,summary}[]`, `sampleAt(track, tSec)`, `spellMeta/isInterrupt/ccInfo/isDefensive` signatures match their tests + callers. `metricsBlock` moves to `renderMetrics.ts` and is imported by `renderReport.ts`; `escapeHtml` moves to `html.ts` imported by both.
```
