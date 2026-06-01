# CC Received/Done + Immune Implementation Plan (Cycle 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CC symmetric (received vs done, player-on-player only, pet-cast rolled to owner) and add immune/wasted-effort tracking (immuned/grounded spells, damage/healing immuned, CC instances immuned) — each with a received/done split.

**Architecture:** Source-aware `auraState` (intervals carry caster+target; `intervalsBy(src)`) lets a new `ccSides.ts` compute per-player `ccReceived` (single union) and `ccDone` (per-enemy-target union, summed). A shared `resolvePlayer` enforces player-on-player + pet→owner. A TDD-discovered `immuneEvent` accessor feeds three immune elements accumulated in `perUnit`. The `UnitMetrics` CC surface is restructured additively (add new nested fields, then remove the Cycle-1 flat ones).

**Tech Stack:** TypeScript (ESM, NodeNext — local imports use `.js`), Vitest, tsx, Node ≥22. Tests: `npx vitest run <file>`; full suite `npm test`; type-check `npx tsc --noEmit`.

---

## Prerequisite

**PR #8 (time-in-CC Cycle 1) must be merged to master first**, then this branch (`feat/cc-received-done`) rebased onto master. The plan builds directly on Cycle 1's `ccTime`/`auraState`/`ccInfo`/`interruptLockoutSec` and the `ccReceived`-able fields. (The branch is currently stacked on Cycle 1, so the code is present either way; rebasing after merge keeps history clean.)

## Conventions

- All parser-event reads go through `src/metrics/eventAccess.ts` accessors. Reading the `units` map / metadata JSON directly is fine.
- Local imports use `.js`. Commit after each task. Run `npx tsc --noEmit` + the task's tests at each boundary; the project stays green at every task (additive-first ordering).

---

## Task 1: Shared `resolvePlayer` helper

**Files:** Modify `src/metrics/types.ts`, `src/metrics/targeting.ts`; Test `test/resolvePlayer.test.ts`.

Extract `targeting.ts`'s source→owning-player rollup into a shared helper and reuse it.

- [ ] **Step 1: Write the failing test** — create `test/resolvePlayer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolvePlayer } from '../src/metrics/types.js';

const units = {
  P: { type: 1 },                 // player
  Pet: { type: 3, ownerId: 'P' }, // primary pet of P
  Orphan: { type: 3, ownerId: '0' },
  NPC: { type: 2 },               // creature/totem
};

describe('resolvePlayer', () => {
  it('returns a player unit as itself', () => expect(resolvePlayer(units, 'P')).toBe('P'));
  it('rolls a pet up to its player owner', () => expect(resolvePlayer(units, 'Pet')).toBe('P'));
  it('returns undefined for a pet with no real owner', () => expect(resolvePlayer(units, 'Orphan')).toBeUndefined());
  it('returns undefined for a non-player', () => expect(resolvePlayer(units, 'NPC')).toBeUndefined());
  it('returns undefined for unknown / missing id', () => {
    expect(resolvePlayer(units, 'Nope')).toBeUndefined();
    expect(resolvePlayer(units, undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run test/resolvePlayer.test.ts` → FAIL (`resolvePlayer` not exported).

- [ ] **Step 3: Add the helper** — in `src/metrics/types.ts`, after `ownerIdOf`, add:

```ts
/** The owning PLAYER unitId for a source: the unit itself if it's a player, else its
 *  owner if that owner is a player, else undefined (pet→owner; NPC/totem→undefined). */
export function resolvePlayer(units: Record<string, { type?: unknown; ownerId?: unknown }>, id: string | undefined): string | undefined {
  const u = id ? units[id] : undefined;
  if (!u) return undefined;
  const owner = ownerIdOf(u);
  if (owner) { const ou = units[owner]; return ou && unitKind(ou.type) === 'player' ? owner : undefined; }
  return unitKind(u.type) === 'player' ? id : undefined;
}
```

- [ ] **Step 4: Reuse it in `targeting.ts`** — replace the local `isPlayer` + `attackerOf` (the two `const` definitions) with a single use of the shared helper. Add `resolvePlayer` to the `./types.js` import, remove `unitKind` from that import if now unused there, and replace:

```ts
  const isPlayer = (u: Record<string, unknown> | undefined): boolean => !!u && unitKind(u.type) === 'player';

  // Resolve a damage source to its owning PLAYER (pet damage rolls to owner); undefined if not a player-attributable source.
  const attackerOf = (id: string | undefined): string | undefined => {
    const u = units[id ?? ''];
    if (!u) return undefined;
    const ownerRaw = ownerIdOf(u);
    if (ownerRaw) return isPlayer(units[ownerRaw]) ? ownerRaw : undefined;
    return isPlayer(u) ? id : undefined;
  };
```

with:

```ts
  const attackerOf = (id: string | undefined): string | undefined => resolvePlayer(units, id);
```

(If `unitKind`/`ownerIdOf` become unused in `targeting.ts` after this, drop them from its import to keep tsc clean.)

- [ ] **Step 5: Verify green** — `npx vitest run test/resolvePlayer.test.ts test/targeting.test.ts` → PASS. `npx tsc --noEmit` → clean. `npm test` → green.

- [ ] **Step 6: Commit**

```bash
git add src/metrics/types.ts src/metrics/targeting.ts test/resolvePlayer.test.ts
git commit -m "refactor(metrics): shared resolvePlayer helper (player/pet→owner), reuse in targeting"
```

---

## Task 2: Source-aware `auraState` (`srcId`/`destId` on intervals + `intervalsBy`)

**Files:** Modify `src/metrics/auraState.ts`; Modify `test/auraState.test.ts`.

Capture the caster at `SPELL_AURA_APPLIED` and index intervals by source as well as dest.

- [ ] **Step 1: Write the failing test** — add to `test/auraState.test.ts` (reuse existing `buildAuraState` import):

```ts
  it('captures the caster (srcId) and indexes intervals by source', () => {
    const st = buildAuraState({
      events: [
        { logLine: { event: 'SPELL_AURA_APPLIED' }, srcUnitId: 'Mage', destUnitId: 'Victim', spellId: '118', spellName: 'Polymorph', timestamp: 1000 },
        { logLine: { event: 'SPELL_AURA_REMOVED' }, srcUnitId: 'Mage', destUnitId: 'Victim', spellId: '118', spellName: 'Polymorph', timestamp: 4000 },
      ],
    });
    const on = st.intervalsOn('Victim');
    expect(on).toHaveLength(1);
    expect(on[0]).toMatchObject({ srcId: 'Mage', destId: 'Victim', spellId: 118, start: 1000, end: 4000 });
    const by = st.intervalsBy('Mage');
    expect(by).toHaveLength(1);
    expect(by[0]).toMatchObject({ srcId: 'Mage', destId: 'Victim', spellId: 118 });
    expect(st.intervalsBy('Nobody')).toEqual([]);
  });
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run test/auraState.test.ts` → FAIL (`intervalsBy` missing; intervals lack `srcId`/`destId`).

- [ ] **Step 3: Update `auraState.ts`** — add `srcId` to the imports and rework. Replace the whole file body with:

```ts
import { eventType, srcId, destId, spellId, spellName, eventTimeMs } from './eventAccess.js';

interface Interval { srcId: string; destId: string; spellId: number; name: string; start: number; end: number; }
export interface AuraState {
  activeOn(unitId: string, ms: number): { spellId: number; name: string }[];
  intervalsOn(unitId: string): Interval[];   // auras ON this unit (by dest)
  intervalsBy(unitId: string): Interval[];    // auras CAST BY this unit (by src)
}

export function buildAuraState(match: unknown): AuraState {
  const m = match as { events?: unknown[] };
  const events = Array.isArray(m.events) ? m.events : [];

  const byDest = new Map<string, Interval[]>();
  const bySrc = new Map<string, Interval[]>();
  const open = new Map<string, Map<number, Interval>>(); // keyed by destId then spellId
  const push = (map: Map<string, Interval[]>, key: string, iv: Interval) => {
    const arr = map.get(key) ?? [];
    arr.push(iv);
    map.set(key, arr);
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
      if (!u.has(sid)) u.set(sid, { srcId: srcId(ev) ?? '', destId: id, spellId: sid, name: spellName(ev), start: ms, end: Number.MAX_SAFE_INTEGER });
    } else if (t === 'SPELL_AURA_REMOVED' || t === 'SPELL_AURA_BROKEN' || t === 'SPELL_AURA_BROKEN_SPELL') {
      const iv = open.get(id)?.get(sid);
      if (iv) { iv.end = ms; open.get(id)!.delete(sid); push(byDest, id, iv); push(bySrc, iv.srcId, iv); }
    }
  }
  for (const [, u] of open) for (const iv of u.values()) { push(byDest, iv.destId, iv); push(bySrc, iv.srcId, iv); }

  const copy = (ivs: Interval[]): Interval[] => ivs.map((iv) => ({ ...iv }));
  return {
    activeOn(unitId, ms) {
      return (byDest.get(unitId) ?? []).filter((iv) => ms >= iv.start && ms < iv.end).map((iv) => ({ spellId: iv.spellId, name: iv.name }));
    },
    intervalsOn(unitId) { return copy(byDest.get(unitId) ?? []); },
    intervalsBy(unitId) { return copy(bySrc.get(unitId) ?? []); },
  };
}
```

(Note: the exported `AuraState` return type for `intervalsOn` widens to include `srcId`/`destId`; existing callers in `perUnit.ts`/`ccTime.ts` only read `spellId/name/start/end` so they remain compatible.)

- [ ] **Step 4: Verify green** — `npx vitest run test/auraState.test.ts` → PASS. `npx tsc --noEmit` → clean (existing `computeCcDurations(auras.intervalsOn(id), …)` still type-checks — the interval is a superset). `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/auraState.ts test/auraState.test.ts
git commit -m "feat(metrics): auraState captures caster + dest on intervals; add intervalsBy(src)"
```

---

## Task 3: `sumCcDurations` (`ccTime.ts`)

**Files:** Modify `src/metrics/ccTime.ts`; Modify `test/ccTime.test.ts`.

Add a helper to sum per-target `CcDurations` (for "done" aggregation across enemies).

- [ ] **Step 1: Write the failing test** — add to `test/ccTime.test.ts`:

```ts
import { sumCcDurations } from '../src/metrics/ccTime.js'; // add to existing import line

describe('sumCcDurations', () => {
  it('adds bucket fields and merges byCategory across parts', () => {
    const a = { timeControlledSec: 4, castDenialSec: 1, hardCcSec: 3, rootSec: 0, byCategory: [{ category: 'stun' as const, durationSec: 3 }, { category: 'silence' as const, durationSec: 1 }] };
    const b = { timeControlledSec: 5, castDenialSec: 0, hardCcSec: 2, rootSec: 3, byCategory: [{ category: 'stun' as const, durationSec: 2 }, { category: 'root' as const, durationSec: 3 }] };
    const s = sumCcDurations([a, b]);
    expect(s.timeControlledSec).toBe(9);
    expect(s.castDenialSec).toBe(1);
    expect(s.hardCcSec).toBe(5);
    expect(s.rootSec).toBe(3);
    expect(s.byCategory.find((c) => c.category === 'stun')?.durationSec).toBe(5);
    expect(s.byCategory.find((c) => c.category === 'root')?.durationSec).toBe(3);
    expect(s.byCategory.find((c) => c.category === 'silence')?.durationSec).toBe(1);
  });
  it('returns zeros for empty input', () => {
    const s = sumCcDurations([]);
    expect(s).toEqual({ timeControlledSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, byCategory: [] });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run test/ccTime.test.ts` → FAIL (`sumCcDurations` not exported).

- [ ] **Step 3: Implement** — in `src/metrics/ccTime.ts`, after `computeCcDurations`, add:

```ts
/** Sum several CcDurations: bucket fields add; byCategory merges per category. Used for "done" across targets. */
export function sumCcDurations(parts: CcDurations[]): CcDurations {
  const byCat = new Map<DrCategory, number>();
  let timeControlledSec = 0, castDenialSec = 0, hardCcSec = 0, rootSec = 0;
  for (const p of parts) {
    timeControlledSec += p.timeControlledSec;
    castDenialSec += p.castDenialSec;
    hardCcSec += p.hardCcSec;
    rootSec += p.rootSec;
    for (const b of p.byCategory) byCat.set(b.category, (byCat.get(b.category) ?? 0) + b.durationSec);
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    timeControlledSec: round1(timeControlledSec),
    castDenialSec: round1(castDenialSec),
    hardCcSec: round1(hardCcSec),
    rootSec: round1(rootSec),
    byCategory: [...byCat.entries()].map(([category, durationSec]) => ({ category, durationSec: round1(durationSec) })),
  };
}
```

- [ ] **Step 4: Verify green** — `npx vitest run test/ccTime.test.ts` → PASS. `npx tsc --noEmit` → clean. `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/ccTime.ts test/ccTime.test.ts
git commit -m "feat(metrics): sumCcDurations for cross-target 'done' aggregation"
```

---

## Task 4: `immuneEvent` accessor — discover immunity + grounding on the fixture

**Files:** Modify `src/metrics/eventAccess.ts`; Test `test/eventAccessImmune.test.ts`.

`immuneEvent(ev)` returns `{ srcId, destId, kind: 'spell' | 'damage' | 'heal', spellId, spellName, amount? } | undefined`. The exact log signature(s) are **discovered against the real fixture** (same method as `absorbInfo`).

- [ ] **Step 1: Discovery — inspect immune + grounding events** — create `test/eventAccessImmune.test.ts` as a temporary probe:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { eventType } from '../src/metrics/eventAccess.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

describe('immune/grounding shape discovery', () => {
  it.runIf(existsSync(FIXTURE))('prints candidate immune + grounding events', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const events: unknown[] = (arenaMatches[0] as { events: unknown[] }).events;
    // SPELL_MISS family + anything mentioning a Grounding Totem
    const miss = events.find((e) => eventType(e) === 'SPELL_MISS');
    // eslint-disable-next-line no-console
    console.log('SPELL_MISS keys:', miss ? Object.keys(miss as object) : 'NONE');
    // eslint-disable-next-line no-console
    console.log('SPELL_MISS sample:', JSON.stringify(miss));
    const missTypes = new Set(events.filter((e) => eventType(e) === 'SPELL_MISS').map((e) => (e as Record<string, unknown>).missType ?? (e as { logLine?: { parameters?: unknown[] } }).logLine?.parameters?.[12]));
    // eslint-disable-next-line no-console
    console.log('observed missTypes:', [...missTypes]);
    // eslint-disable-next-line no-console
    console.log('SPELL_DAMAGE/HEAL with immune-ish fields — inspect one SPELL_DAMAGE keys:', Object.keys((events.find((e) => eventType(e) === 'SPELL_DAMAGE') ?? {}) as object));
    expect(events.length).toBeGreaterThan(0);
  });
});
```

Run: `npx vitest run test/eventAccessImmune.test.ts 2>&1` and **READ the console output**. Determine: (a) does `SPELL_MISS` carry a `missType` field (named or in `logLine.parameters`)? what are the observed values (look for `IMMUNE`)? (b) is the immune amount available? (c) is there any **Grounding Totem** signature — a `SPELL_MISS`/`SPELL_DAMAGE` whose dest is a "Grounding Totem" unit, or a redirect marker? Record which of immunity / grounding are detectable.

If **no** immune-type events exist in the fixture, STOP and report (status DONE_WITH_CONCERNS): the immune sub-features (Tasks 4, and the immune parts of 6/7) defer — `immuneEvent` ships stubbed returning `undefined`, downstream immune fields stay 0, and the received/done CC split (Tasks 5–8) proceeds. Report grounding detectability separately.

- [ ] **Step 2: Write the assertion test** — replace `test/eventAccessImmune.test.ts` with the real assertion against the discovered shape (remove the probe `console.log`s):

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { eventType, immuneEvent } from '../src/metrics/eventAccess.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

describe('immuneEvent (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('resolves an immune-blocked event with src/dest/kind/spell', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const events: unknown[] = (arenaMatches[0] as { events: unknown[] }).events;
    const hit = events.find((e) => immuneEvent(e) !== undefined);
    expect(hit, 'an immune/grounded event exists in the fixture').toBeTruthy();
    const info = immuneEvent(hit)!;
    expect(typeof info.srcId).toBe('string');
    expect(typeof info.destId).toBe('string');
    expect(['spell', 'damage', 'heal']).toContain(info.kind);
    expect(typeof info.spellId).toBe('number');
  });

  it('returns undefined for a normal damage event', () => {
    expect(immuneEvent({ logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'A', destUnitId: 'B' })).toBeUndefined();
  });
});
```

Run: `npx vitest run test/eventAccessImmune.test.ts` → FAIL (`immuneEvent` not exported).

- [ ] **Step 3: Implement `immuneEvent`** — add to `src/metrics/eventAccess.ts`. Use the field/param positions confirmed in Step 1. Template (adjust the `missType` read + `kind` mapping + grounding detection to the discovered shape; prefer named parser fields if present):

```ts
/**
 * Immune-blocked or grounded event → { srcId, destId, kind, spellId, spellName, amount? }, else undefined.
 * Recognizes (a) immunity (SPELL_MISS / SPELL_DAMAGE / SPELL_HEAL with missType === "IMMUNE")
 * and (b) Grounding Totem redirects. Field positions discovered via TDD (test/eventAccessImmune.test.ts).
 */
export function immuneEvent(ev: unknown): { srcId: string; destId: string; kind: 'spell' | 'damage' | 'heal'; spellId: number; spellName: string; amount?: number } | undefined {
  const e = ev as Ev;
  const t = eventType(ev);
  const missType = e?.missType ?? (logLine(ev)?.parameters ?? [])[/* index from Step 1 */ 12];
  const isImmune = (t === 'SPELL_MISS' || t === 'SPELL_DAMAGE' || t === 'SPELL_HEAL' || t === 'RANGE_MISS' || t === 'SPELL_PERIODIC_MISS') && str(missType) === 'IMMUNE';
  // grounding: per Step 1 discovery (e.g. dest is a Grounding Totem unit). Set isGrounded accordingly; if not detectable, leave false.
  const isGrounded = false; // replace with the discovered grounding signature, or keep false if grounding can't be detected
  if (!isImmune && !isGrounded) return undefined;
  const s = strOpt(e?.srcUnitId); const d = strOpt(e?.destUnitId); const sid = spellId(ev);
  if (!s || !d || sid === undefined) return undefined;
  const kind = t === 'SPELL_HEAL' ? 'heal' : (t === 'SPELL_DAMAGE' || t === 'RANGE_MISS' || t === 'SPELL_PERIODIC_MISS') ? 'damage' : 'spell';
  const amt = amount(ev);
  return { srcId: s, destId: d, kind, spellId: sid, spellName: spellName(ev), amount: amt > 0 ? amt : undefined };
}
```

The assertion test is the source of truth — make it pass with the cleanest implementation the discovered shape allows. If grounding is undetectable, leave `isGrounded = false` and note it (the spec permits grounding to defer).

- [ ] **Step 4: Verify** — `npx vitest run test/eventAccessImmune.test.ts` → PASS (2 tests). `npx tsc --noEmit` → clean. `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/eventAccess.ts test/eventAccessImmune.test.ts
git commit -m "feat(metrics): immuneEvent accessor — resolve immunity (+ grounding) on the fixture"
```

---

## Task 5: New types — `CcSide`/`ImmuneSide`, add `ccReceived`/`ccDone`/`immune*` (additive)

**Files:** Modify `src/metrics/types.ts`.

Add the new shapes and fields **without removing** the Cycle-1 flat fields yet (kept until Task 8 so every task stays green).

- [ ] **Step 1: Add the types + UnitMetrics fields** — in `src/metrics/types.ts`:

Rename `CcTakenEntry` to `CcCategoryStat` (keep a back-compat alias so Cycle-1 code still compiles):

```ts
export interface CcCategoryStat { category: DrCategory; count: number; durationSec: number; }
export type CcTakenEntry = CcCategoryStat; // back-compat alias (removed in Task 8)
```

Add the side shapes:

```ts
export interface CcSide {
  timeSec: number;
  castDenialSec: number;
  hardCcSec: number;
  rootSec: number;
  count: number;
  byCategory: CcCategoryStat[];
}

export interface ImmuneSide {
  spellsImmuned: SpellTally[];
  ccImmuned: number;
  ccImmunedByCategory: { category: DrCategory; count: number }[];
  damageImmuned: number;
  healingImmuned: number;
}
```

In `interface UnitMetrics`, add (after the existing `rootSec: number;`):

```ts
  ccReceived: CcSide;
  ccDone: CcSide;
  immuneReceived: ImmuneSide;
  immuneDone: ImmuneSide;
```

- [ ] **Step 2: Verify it fails to compile (expected) then fix the constructors** — `npx tsc --noEmit` now errors that every `UnitMetrics` literal is missing the 4 new required fields (`perUnit.ts` result, `grouping.test.ts` `u()`, `renderReport.test.ts` two literals). That's expected; the NEXT steps populate them. Add empty defaults so the project compiles green within THIS task:

  - In `test/grouping.test.ts` `u()` base (before `...over`) add:
    ```ts
    ccReceived: emptyCcSide(), ccDone: emptyCcSide(), immuneReceived: emptyImmuneSide(), immuneDone: emptyImmuneSide(),
    ```
    and at the top of that file add small local factories (or import from a shared test helper):
    ```ts
    const emptyCcSide = () => ({ timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0, byCategory: [] });
    const emptyImmuneSide = () => ({ spellsImmuned: [], ccImmuned: 0, ccImmunedByCategory: [], damageImmuned: 0, healingImmuned: 0 });
    ```
  - In `test/renderReport.test.ts`, both `UnitMetrics` literals: after each `rootSec: …,` add:
    ```ts
    ccReceived: { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0, byCategory: [] }, ccDone: { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0, byCategory: [] }, immuneReceived: { spellsImmuned: [], ccImmuned: 0, ccImmunedByCategory: [], damageImmuned: 0, healingImmuned: 0 }, immuneDone: { spellsImmuned: [], ccImmuned: 0, ccImmunedByCategory: [], damageImmuned: 0, healingImmuned: 0 },
    ```
  - In `src/metrics/perUnit.ts` result `push({...})`, after `rootSec: cc.rootSec,` add temporary empties (replaced in Task 6):
    ```ts
    ccReceived: { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0, byCategory: [] },
    ccDone: { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0, byCategory: [] },
    immuneReceived: { spellsImmuned: [], ccImmuned: 0, ccImmunedByCategory: [], damageImmuned: 0, healingImmuned: 0 },
    immuneDone: { spellsImmuned: [], ccImmuned: 0, ccImmunedByCategory: [], damageImmuned: 0, healingImmuned: 0 },
    ```

- [ ] **Step 3: Verify green** — `npx tsc --noEmit` → clean. `npm test` → green (all existing tests still pass; new fields are present but zeroed).

- [ ] **Step 4: Commit**

```bash
git add src/metrics/types.ts test/grouping.test.ts test/renderReport.test.ts src/metrics/perUnit.ts
git commit -m "feat(types): add CcSide/ImmuneSide + ccReceived/ccDone/immune* (zeroed; populated next)"
```

---

## Task 6: Compute `ccReceived`/`ccDone`/`immune*` (`ccSides.ts` + `perUnit.ts`)

**Files:** Create `src/metrics/ccSides.ts`; Modify `src/metrics/perUnit.ts`; Test `test/ccSides.test.ts`; Modify `test/perUnit.test.ts`.

### Part A — `ccSides.ts` (received/done from auras)

- [ ] **Step 1: Write the failing test** — create `test/ccSides.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAuraState } from '../src/metrics/auraState.js';
import { ccReceivedSide, ccDoneSide } from '../src/metrics/ccSides.js';

// P (player), Pet (P's), E1/E2 enemies. 408 = Kidney Shot (stun, curated+DB).
const units = {
  P: { type: 1, reaction: 1 }, Pet: { type: 3, reaction: 1, ownerId: 'P' },
  E1: { type: 1, reaction: 2 }, E2: { type: 1, reaction: 2 },
};
const cc = (src: string, dst: string, start: number, end: number) => [
  { logLine: { event: 'SPELL_AURA_APPLIED' }, srcUnitId: src, destUnitId: dst, spellId: '408', spellName: 'Kidney Shot', timestamp: start },
  { logLine: { event: 'SPELL_AURA_REMOVED' }, srcUnitId: src, destUnitId: dst, spellId: '408', spellName: 'Kidney Shot', timestamp: end },
];

describe('ccSides', () => {
  it('done sums per-target unions across enemies; received unions on you', () => {
    const events = [...cc('P', 'E1', 0, 2000), ...cc('Pet', 'E2', 0, 3000), ...cc('E1', 'P', 0, 4000)];
    const auras = buildAuraState({ events });
    const done = ccDoneSide('P', ['Pet'], units, auras, [], 100000);
    expect(done.hardCcSec).toBe(5);   // 2s on E1 + 3s on E2 (pet rolled to P), summed
    expect(done.count).toBe(2);
    const recv = ccReceivedSide('P', units, auras, [], 100000);
    expect(recv.hardCcSec).toBe(4);   // 4s stun on P from E1
    expect(recv.count).toBe(1);
  });

  it('ignores CC on/from non-players (player-on-player only)', () => {
    const events = [...cc('NPC', 'P', 0, 5000), ...cc('P', 'NPC', 0, 5000)];
    const auras = buildAuraState({ events: events });
    expect(ccReceivedSide('P', units, auras, [], 100000).hardCcSec).toBe(0); // CC from NPC ignored
    expect(ccDoneSide('P', [], units, auras, [], 100000).hardCcSec).toBe(0); // CC on NPC ignored
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run test/ccSides.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `ccSides.ts`**

```ts
import { computeCcDurations, sumCcDurations, type Window } from './ccTime.js';
import { ccInfo, interruptLockoutSec } from '../metadata/spells.js';
import { resolvePlayer, unitTeam, type CcSide } from './types.js';
import type { AuraState } from './auraState.js';

type Units = Record<string, { type?: unknown; reaction?: unknown; ownerId?: unknown }>;
export interface LandedInterrupt { ms: number; spellId: number; targetId: string; }
export interface SufferedInterrupt { ms: number; spellId: number; }

const teamOf = (units: Units, id: string) => unitTeam((units[id] ?? {}).reaction);

// CC instance count + per-category counts from a set of CC intervals.
function countSide(intervals: { spellId: number }[]): { count: number; byCount: Map<string, number> } {
  let count = 0;
  const byCount = new Map<string, number>();
  for (const iv of intervals) {
    const cc = ccInfo(iv.spellId);
    if (!cc) continue;
    count++;
    byCount.set(cc.category, (byCount.get(cc.category) ?? 0) + 1);
  }
  return { count, byCount };
}

function toCcSide(d: { timeControlledSec: number; castDenialSec: number; hardCcSec: number; rootSec: number; byCategory: { category: string; durationSec: number }[] }, count: number, byCount: Map<string, number>): CcSide {
  return {
    timeSec: d.timeControlledSec,
    castDenialSec: d.castDenialSec,
    hardCcSec: d.hardCcSec,
    rootSec: d.rootSec,
    count,
    byCategory: d.byCategory.map((b) => ({ category: b.category as CcSide['byCategory'][number]['category'], count: byCount.get(b.category) ?? 0, durationSec: b.durationSec })),
  };
}

/** CC suffered by `playerId` from enemy players (single union). */
export function ccReceivedSide(playerId: string, units: Units, auras: AuraState, suffered: SufferedInterrupt[], matchEndMs: number): CcSide {
  const myTeam = teamOf(units, playerId);
  const intervals = auras.intervalsOn(playerId).filter((iv) => {
    const caster = resolvePlayer(units, iv.srcId);
    return !!caster && teamOf(units, caster) !== myTeam;
  });
  const windows: Window[] = suffered.map((x) => ({ start: x.ms, end: x.ms + interruptLockoutSec(x.spellId) * 1000 }));
  const d = computeCcDurations(intervals, windows, matchEndMs);
  const { count, byCount } = countSide(intervals);
  return toCcSide(d, count, byCount);
}

/** CC `playerId` (+ pets) landed on enemy players: per-target union, summed across targets. */
export function ccDoneSide(playerId: string, petIds: string[], units: Units, auras: AuraState, landed: LandedInterrupt[], matchEndMs: number): CcSide {
  const myTeam = teamOf(units, playerId);
  const byTarget = new Map<string, { spellId: number; name: string; start: number; end: number }[]>();
  for (const casterId of [playerId, ...petIds]) {
    for (const iv of auras.intervalsBy(casterId)) {
      const tgt = resolvePlayer(units, iv.destId);
      if (!tgt || teamOf(units, tgt) === myTeam) continue;
      const arr = byTarget.get(tgt) ?? []; arr.push(iv); byTarget.set(tgt, arr);
    }
  }
  const windowsByTarget = new Map<string, Window[]>();
  for (const x of landed) {
    const tgt = resolvePlayer(units, x.targetId);
    if (!tgt || teamOf(units, tgt) === myTeam) continue;
    const w = { start: x.ms, end: x.ms + interruptLockoutSec(x.spellId) * 1000 };
    const arr = windowsByTarget.get(tgt) ?? []; arr.push(w); windowsByTarget.set(tgt, arr);
  }
  const targets = new Set([...byTarget.keys(), ...windowsByTarget.keys()]);
  const parts = [...targets].map((tgt) => computeCcDurations(byTarget.get(tgt) ?? [], windowsByTarget.get(tgt) ?? [], matchEndMs));
  const summed = sumCcDurations(parts);
  const allIntervals = [...byTarget.values()].flat();
  const { count, byCount } = countSide(allIntervals);
  return toCcSide(summed, count, byCount);
}
```

- [ ] **Step 4: Verify** — `npx vitest run test/ccSides.test.ts` → PASS (2 tests). `npx tsc --noEmit` → clean.

### Part B — wire into `perUnit.ts` + immune accumulation

- [ ] **Step 5: Write the failing perUnit test** — add to `test/perUnit.test.ts` a `describe('CC received/done + immune')`:

```ts
import { ccDoneSide } from '../src/metrics/ccSides.js'; // (only if needed; perUnit test uses computeUnitMetrics)

describe('CC received/done + immune (perUnit)', () => {
  it('splits received/done player-on-player and rolls pet CC to owner', () => {
    const match = {
      durationInSeconds: 100,
      units: {
        P: { name: 'You', type: 1, reaction: 1 }, Pet: { name: 'Felguard', type: 3, reaction: 1, ownerId: 'P' },
        E: { name: 'Enemy', type: 1, reaction: 2 },
      },
      events: [
        // You stun E for 2s (done)
        { logLine: { event: 'SPELL_AURA_APPLIED' }, srcUnitId: 'P', destUnitId: 'E', spellId: '408', spellName: 'Kidney Shot', timestamp: 0 },
        { logLine: { event: 'SPELL_AURA_REMOVED' }, srcUnitId: 'P', destUnitId: 'E', spellId: '408', spellName: 'Kidney Shot', timestamp: 2000 },
        // Your Felguard stuns E for 3s (done, rolled to you)
        { logLine: { event: 'SPELL_AURA_APPLIED' }, srcUnitId: 'Pet', destUnitId: 'E', spellId: '408', spellName: 'Kidney Shot', timestamp: 3000 },
        { logLine: { event: 'SPELL_AURA_REMOVED' }, srcUnitId: 'Pet', destUnitId: 'E', spellId: '408', spellName: 'Kidney Shot', timestamp: 6000 },
        // E polymorphs You for 6s (received)
        { logLine: { event: 'SPELL_AURA_APPLIED' }, srcUnitId: 'E', destUnitId: 'P', spellId: '118', spellName: 'Polymorph', timestamp: 7000 },
        { logLine: { event: 'SPELL_AURA_REMOVED' }, srcUnitId: 'E', destUnitId: 'P', spellId: '118', spellName: 'Polymorph', timestamp: 13000 },
        { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Filler', timestamp: 20000 },
      ],
    };
    const units = computeUnitMetrics(match, buildAuraState(match));
    const you = units.find((u) => u.unitId === 'P')!;
    expect(you.ccDone.hardCcSec).toBe(5);     // 2 (self) + 3 (pet) on E
    expect(you.ccDone.count).toBe(2);
    expect(you.ccReceived.hardCcSec).toBe(6); // 6s poly on you
    expect(you.ccReceived.count).toBe(1);
  });
});
```

- [ ] **Step 6: Run it to confirm it fails** — `npx vitest run test/perUnit.test.ts` → FAIL (`ccDone`/`ccReceived` still zeroed from Task 5).

- [ ] **Step 7: Wire `perUnit.ts`**

1. Imports: add `ccReceivedSide`, `ccDoneSide`, `type LandedInterrupt`, `type SufferedInterrupt` from `./ccSides.js`; add `immuneEvent` to the `./eventAccess.js` import; add `resolvePlayer`, `type CcSide`, `type ImmuneSide`, `type SpellTally` to the `./types.js` import; add `mergeTallies`, `tally` already imported.

2. Extend `Acc` for landed-interrupt detail + immune accumulation:
```ts
  // replace `interrupts: string[]` with detail (keep a names view via .map)
  interruptsLandedDetail: { name: string; ms: number; spellId: number; targetId: string }[];
  // immune accumulators (this unit as the role's subject)
  immuneDoneSpells: string[]; immuneDoneCc: { category: string }[]; immuneDoneDmg: number; immuneDoneHeal: number;
  immuneRecvSpells: string[]; immuneRecvCc: { category: string }[]; immuneRecvDmg: number; immuneRecvHeal: number;
```
   Update `emptyAcc()` to init these (`interruptsLandedDetail: []`, the immune fields to `[]`/`0`). Replace `interrupts: []` accordingly. Everywhere `a.interrupts` was used (the `interruptsLanded`/`interruptsLandedBySpell` result fields), switch to `a.interruptsLandedDetail` (`.length` and `tally(...map(x=>x.name))`).

3. In the event loop, replace the `SPELL_INTERRUPT` landed push to record detail:
```ts
    } else if (t === 'SPELL_INTERRUPT' && s) {
      acc(s).interruptsLandedDetail.push({ name: extraSpellName(ev) ?? spellName(ev), ms: ms ?? 0, spellId: spellId(ev) ?? 0, targetId: d ?? '' });
      if (d) acc(d).interruptsSuffered.push({ name: extraSpellName(ev) ?? spellName(ev), ms: ms ?? 0, spellId: spellId(ev) ?? 0 });
    }
```

4. Add an immune accumulation block in the loop (after the absorb block), player-on-player via `resolvePlayer`:
```ts
    const imm = immuneEvent(ev);
    if (imm) {
      const src = resolvePlayer(units, imm.srcId);
      const dst = resolvePlayer(units, imm.destId);
      const cc = ccInfo(imm.spellId);
      const sameTeam = src && dst && teamOf(src) === teamOf(dst);
      // done (source's wasted effort) — source must be a player; for damage/cc the target is an enemy player; for heal the target is a friendly player
      if (src && dst && (imm.kind === 'heal' ? sameTeam : !sameTeam)) {
        const A = acc(src);
        A.immuneDoneSpells.push(imm.spellName);
        if (cc) A.immuneDoneCc.push({ category: cc.category });
        if (imm.kind === 'damage') A.immuneDoneDmg += imm.amount ?? 0;
        if (imm.kind === 'heal') A.immuneDoneHeal += imm.amount ?? 0;
        // received (target avoided / wasted-on)
        const B = acc(dst);
        B.immuneRecvSpells.push(imm.spellName);
        if (cc) B.immuneRecvCc.push({ category: cc.category });
        if (imm.kind === 'damage') B.immuneRecvDmg += imm.amount ?? 0;
        if (imm.kind === 'heal') B.immuneRecvHeal += imm.amount ?? 0;
      }
    }
```

5. In the result loop, compute pet ids + the four new fields. Before `result.push`, add:
```ts
    const petIds = Object.keys(units).filter((uid) => ownerIdOf(units[uid]) === id);
    const ccReceived = ccReceivedSide(id, units, auras, a.interruptsSuffered, endMs);
    const ccDone = ccDoneSide(id, petIds, units, auras, a.interruptsLandedDetail, endMs);
    const ccByCatImm = (list: { category: string }[]) => { const m = new Map<string, number>(); for (const c of list) m.set(c.category, (m.get(c.category) ?? 0) + 1); return [...m.entries()].map(([category, count]) => ({ category: category as ImmuneSide['ccImmunedByCategory'][number]['category'], count })); };
    const immuneReceived: ImmuneSide = { spellsImmuned: tally(a.immuneRecvSpells), ccImmuned: a.immuneRecvCc.length, ccImmunedByCategory: ccByCatImm(a.immuneRecvCc), damageImmuned: Math.round(a.immuneRecvDmg), healingImmuned: Math.round(a.immuneRecvHeal) };
    const immuneDone: ImmuneSide = { spellsImmuned: tally(a.immuneDoneSpells), ccImmuned: a.immuneDoneCc.length, ccImmunedByCategory: ccByCatImm(a.immuneDoneCc), damageImmuned: Math.round(a.immuneDoneDmg), healingImmuned: Math.round(a.immuneDoneHeal) };
```
   Replace the temporary zeroed `ccReceived`/`ccDone`/`immuneReceived`/`immuneDone` (from Task 5) in the `push` with these computed values. Only players get non-empty sides — `ccReceivedSide`/`ccDoneSide` already return zeros for non-player ids (their interval/source resolution yields nothing), so no extra guard is needed, but the existing logic naturally zeroes pets/NPCs.

- [ ] **Step 8: Verify green** — `npx vitest run test/perUnit.test.ts test/ccSides.test.ts` → PASS. `npx tsc --noEmit` → clean. `npm test` → green.

- [ ] **Step 9: Commit**

```bash
git add src/metrics/ccSides.ts src/metrics/perUnit.ts test/ccSides.test.ts test/perUnit.test.ts
git commit -m "feat(metrics): compute ccReceived/ccDone (player-only, pet→owner) + immune received/done"
```

---

## Task 7: Report — CC received/done + immune lines (`renderMetrics.ts`)

**Files:** Modify `src/view/renderMetrics.ts`; Modify `test/renderReport.test.ts`.

- [ ] **Step 1: Update the test** — in `test/renderReport.test.ts`, set non-zero values on the `player` literal's new fields:
```ts
        ccReceived: { timeSec: 12.5, castDenialSec: 6, hardCcSec: 4.5, rootSec: 2, count: 5, byCategory: [] },
        ccDone: { timeSec: 8, castDenialSec: 2, hardCcSec: 6, rootSec: 0, count: 4, byCategory: [] },
        immuneReceived: { spellsImmuned: [{ spellName: 'Polymorph', count: 1 }], ccImmuned: 1, ccImmunedByCategory: [], damageImmuned: 0, healingImmuned: 0 },
        immuneDone: { spellsImmuned: [], ccImmuned: 0, ccImmunedByCategory: [], damageImmuned: 1500, healingImmuned: 0 },
```
   Add assertions near the existing ones:
```ts
    expect(html).toContain('CC recv');
    expect(html).toContain('CC done');
    expect(html).toContain('immuned');
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run test/renderReport.test.ts` → FAIL (renderer still shows the old single CC cell, no recv/done/immuned).

- [ ] **Step 3: Update `renderMetrics.ts`** — in `unitRow`, replace the single CC cell `<td>${u.timeControlledSec}s (...)</td>` with two stacked CC lines + an immune line in one cell:
```ts
    `<td>CC recv: ${u.ccReceived.timeSec}s (${u.ccReceived.castDenialSec}/${u.ccReceived.hardCcSec}/${u.ccReceived.rootSec})<br>` +
    `CC done: ${u.ccDone.timeSec}s (${u.ccDone.castDenialSec}/${u.ccDone.hardCcSec}/${u.ccDone.rootSec})<br>` +
    `immuned recv ${u.immuneReceived.ccImmuned}cc/${u.immuneReceived.damageImmuned}dmg · done ${u.immuneDone.ccImmuned}cc/${u.immuneDone.damageImmuned}dmg</td>` +
    `<td>${u.deathsWhileCcd}</td><td>${u.defensivesUsed}/${u.defensivesIntoBurst}</td></tr>`;
```
   In `teamBlock`'s header, change `<th>CC time (cd/hard/root)</th>` to `<th>CC recv/done · immuned</th>`.

- [ ] **Step 4: Verify green** — `npx vitest run test/renderReport.test.ts` → PASS. `npx tsc --noEmit` → clean. `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add src/view/renderMetrics.ts test/renderReport.test.ts
git commit -m "feat(view): render CC received/done + immune lines"
```

---

## Task 8: Remove the Cycle-1 flat CC fields (cleanup)

**Files:** Modify `src/metrics/types.ts`, `src/metrics/perUnit.ts`, `test/metrics.test.ts`, `test/grouping.test.ts`, `test/renderReport.test.ts`.

Now that `ccReceived` carries the same bucket values, remove the redundant flat fields.

- [ ] **Step 1: Remove the fields from `UnitMetrics`** — in `src/metrics/types.ts`, delete `timeControlledSec`, `castDenialSec`, `hardCcSec`, `rootSec`, `ccTaken`, `ccTakenByCategory` from `interface UnitMetrics`, and remove the `CcTakenEntry` back-compat alias (keep `CcCategoryStat`).

- [ ] **Step 2: Run tsc to find every reader** — `npx tsc --noEmit` → errors point to `perUnit.ts` (the result `push` still sets these), `renderMetrics.ts` (if any stray reference), `test/grouping.test.ts` `u()` base, `test/renderReport.test.ts` literals, `test/metrics.test.ts` golden assertions on `me.player.timeControlledSec` etc.

- [ ] **Step 3: Fix each reader**
  - `perUnit.ts`: delete the `timeControlledSec/castDenialSec/hardCcSec/rootSec` lines from the result `push`, and delete the now-unneeded `ccTaken`/`ccTakenByCategory` lines. The local `const cc = computeCcDurations(...)` and `ccByCat` that fed them are now only used by `ccReceivedSide` internally — remove the now-dead `cc`/`ccByCat`/`interruptWindows` locals if nothing else uses them (the received side is computed inside `ccReceivedSide`). Keep `a.interruptsSuffered` (used by `ccReceivedSide`).
  - `test/grouping.test.ts`: remove the flat fields from the `u()` base.
  - `test/renderReport.test.ts`: remove the flat fields from both literals.
  - `test/metrics.test.ts`: replace golden assertions that read the flat fields with the nested ones:
    ```ts
    expect(me.player.ccReceived.timeSec).toBeGreaterThanOrEqual(0);
    expect(me.player.ccReceived.castDenialSec + me.player.ccReceived.hardCcSec + me.player.ccReceived.rootSec).toBeGreaterThanOrEqual(me.player.ccReceived.timeSec);
    expect(me.player.ccReceived.byCategory.every((c) => c.durationSec >= 0)).toBe(true);
    ```

- [ ] **Step 4: Verify green** — `npx tsc --noEmit` → clean (no remaining references to the removed fields anywhere). `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/types.ts src/metrics/perUnit.ts test/metrics.test.ts test/grouping.test.ts test/renderReport.test.ts
git commit -m "refactor(metrics): drop flat Cycle-1 CC fields, fully migrated to ccReceived/ccDone"
```

---

## Task 9: Full-suite green + real-data smoke

**Files:** none (verification only)

- [ ] **Step 1: Whole suite + type-check** — `npm test` → all green; `npx tsc --noEmit` → clean.

- [ ] **Step 2: Real-data smoke** — `npm run view -- "D:/WoW_Arena_Coach/sample_data/logs/WoWCombatLog-052926_235715.txt"`. Open `output/report.html` and confirm per player: `CC recv` ≈ the old Cycle-1 CC numbers (the player filter only drops non-player-cast CC, so recv should be very close); `CC done` is a believable CC-output number (a heavy-CC enemy comp shows more done CC on you than your warlock applies); `immuned recv/done` are sane small counts; no NPC/creature row shows CC. If `ccDone` is implausibly high (e.g. exceeds the match duration after the per-instance cap from Cycle 1), STOP and report — the per-target sum is correct but a runaway would indicate an attribution bug.

- [ ] **Step 3: Verify immune wired end-to-end (if discovered)** — add a quick check that some unit has `immuneReceived.spellsImmuned.length > 0` OR (if Task 4 reported no immune events) confirm the fields are 0 and note the deferral. (No commit; this is the smoke confirmation.)

- [ ] **Step 4: No commit** (verification; report.html is git-ignored).

---

## Plan self-review notes

- **Spec coverage:** §2 data model → Tasks 5 (add) + 8 (remove old); §3 resolvePlayer → Task 1; §4 auraState srcId/intervalsBy → Task 2; §5 done computation + sumCcDurations → Tasks 3 + 6; §6 landed interrupts → Task 6 (interruptsLandedDetail with targetId); §7 immune three elements (A spellsImmuned incl grounded, B dmg/heal, C cc count) received/done → Tasks 4 (accessor incl grounding discovery) + 6 (accumulation); §8 report → Task 7; §11 error handling (player-only, heal same-team exception, deferral) → Tasks 1/4/6; §12 testing → distributed.
- **Type consistency:** `CcSide` fields (`timeSec`/`castDenialSec`/`hardCcSec`/`rootSec`/`count`/`byCategory`) and `ImmuneSide` fields (`spellsImmuned`/`ccImmuned`/`ccImmunedByCategory`/`damageImmuned`/`healingImmuned`) are used identically across Tasks 5–8; `ccReceivedSide`/`ccDoneSide`/`sumCcDurations`/`resolvePlayer`/`immuneEvent`/`intervalsBy` signatures consistent across the tasks that define and call them; `toCcSide` maps `timeControlledSec → timeSec` exactly as the spec specifies.
- **Discovery risk (called out, not a placeholder):** Task 4's `immuneEvent` field positions + the grounding signature are established by the Step-1 probe against the real fixture (the same TDD-discovery method `absorbInfo` used). If no immune events exist, Task 4 reports and the immune accumulation (Task 6 step 4/7.4) yields zeros — the received/done split still ships. Grounding may defer even if immunity is found.
- **Green at every task:** additive ordering (Task 5 adds zeroed fields with constructors fixed in-task; Task 8 removes the old fields only after the new ones are populated + rendered), so `npm test` + `tsc` pass at every commit.
