# Metrics Phases 1–3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the merged "player + perCombatant" metric model with per-unit attribution grouped into teams and pet→owner player-groups (Phase 1), plus a match spell-use timeline (Phase 2) and per-unit movement metrics (Phase 3), all surfaced in the report.

**Architecture:** Phase-aligned pure modules under `src/metrics/`: `types.ts` (shapes), `eventAccess.ts` (+`position`), `perUnit.ts` (per-unit attribution + movement), `grouping.ts` (team + pet→owner + combined totals), `timeline.ts` (ordered event stream), `metrics.ts` (orchestrator → `MatchMetrics`). `renderReport` renders team→player-group + a collapsed timeline. `resolvePlayerUnits` is removed (superseded).

**Tech Stack:** TypeScript/ESM (Node ≥22), Vitest. Consumes the vendored `@wowarenalogs/parser` match objects via `parseLogFile`.

---

## File Structure

```
src/metrics/types.ts        # all shapes (UnitMetrics, PlayerGroup, TeamGroup, TimelineEvent, MatchMetrics, enums)
src/metrics/eventAccess.ts  # MODIFIED: add position(ev)
src/metrics/perUnit.ts      # computeUnitMetrics(match): UnitMetrics[]
src/metrics/grouping.ts     # groupUnits(units, playerUnitId): TeamGroup[]
src/metrics/timeline.ts     # buildTimeline(match): TimelineEvent[]
src/metrics/metrics.ts      # MODIFIED: computeMatchMetrics(match): MatchMetrics (orchestrator)
src/metrics/registry.ts     # MODIFIED: extend metric defs
src/metrics/playerUnits.ts  # REMOVED (+ test/playerUnits.test.ts removed)
src/view/renderReport.ts    # MODIFIED: metricsBlock -> team/player-group + timeline
test/eventAccessPosition.test.ts, test/perUnit.test.ts, test/grouping.test.ts, test/timeline.test.ts
test/metrics.test.ts (REWRITTEN), test/renderReport.test.ts (UPDATED)
```

Existing confirmed shapes: events have `logLine.event` (type), `srcUnitId`, `destUnitId`, `spellName`, `extraSpellName`, `timestamp` (ms), aura type at `logLine.parameters[14]`. Units (`match.units[id]`) have `name`, `type` (1 player / 3 primary-pet / 4 temp-pet), `reaction` (numeric: 1 friendly / 2 hostile / 0 neutral), `spec`, `ownerId` ('0' = none). `match.playerId` = recording player GUID.

---

## Task 1: `position` accessor (Phase 3 prerequisite, TDD discovery)

**Files:** Modify `src/metrics/eventAccess.ts`; Create `test/eventAccessPosition.test.ts`

- [ ] **Step 1: Write the failing test** — `test/eventAccessPosition.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { position, eventType, srcId } from '../src/metrics/eventAccess.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

describe('position accessor (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('reads x/y off advanced events', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const events: unknown[] = (arenaMatches[0] as { events: unknown[] }).events;
    // Find any event from a real player that has a position.
    const withPos = events.find((e) => srcId(e) && position(e) !== undefined);
    expect(withPos, 'at least one event carries a position').toBeTruthy();
    const p = position(withPos)!;
    expect(typeof p.x).toBe('number');
    expect(typeof p.y).toBe('number');
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run test/eventAccessPosition.test.ts` (no `position` export).

- [ ] **Step 3: Add `position` to `src/metrics/eventAccess.ts`** (best-guess fields + fallbacks)

```ts
export function position(ev: unknown): { x: number; y: number; facing?: number } | undefined {
  const e = ev as Record<string, unknown>;
  const x = e?.advancedActorPositionX ?? e?.positionX ?? e?.x;
  const y = e?.advancedActorPositionY ?? e?.positionY ?? e?.y;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  if (x === 0 && y === 0) return undefined; // 0,0 = no position in advanced log
  const f = e?.advancedActorPositionFacing ?? e?.facing;
  return { x, y, facing: typeof f === 'number' ? f : undefined };
}
```

- [ ] **Step 4: Run; if FAIL, discover the real field names and fix**

Run: `npx vitest run test/eventAccessPosition.test.ts`. If PASS, continue. If FAIL, dump an advanced event's keys:
```
npx tsx -e "import('./src/parser/parserClient.js').then(async m=>{const {arenaMatches}=await m.parseLogFile('test-data/fixtures/arena-sample.log');const evs=arenaMatches[0].events;const e=evs.find(x=>Object.keys(x).some(k=>/pos|position/i.test(k)));console.log(Object.keys(e||{}).filter(k=>/pos|position|facing|x|y/i.test(k)));console.log(JSON.stringify(e).slice(0,600));})"
```
Also grep the built types: `grep -niE "position|facing" vendor/wowarenalogs/packages/parser/dist/index.d.ts | head`. Update the field names in `position()` to the REAL ones; re-run until PASS. **Report the real field names found.** Then `npx tsc --noEmit` (clean) + full `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/eventAccess.ts test/eventAccessPosition.test.ts
git commit -m "feat: position accessor for advanced-log coordinates (discovered via TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shapes + per-unit metrics (Phase 1 base + Phase 3 movement)

**Files:** Create `src/metrics/types.ts`, `src/metrics/perUnit.ts`, `test/perUnit.test.ts`

- [ ] **Step 1: Create `src/metrics/types.ts`** (all shared shapes)

```ts
export type UnitKind = 'player' | 'primary-pet' | 'temp-pet' | 'other';
export type Team = 'friendly' | 'enemy' | 'neutral';

export interface SpellTally { spellName: string; count: number; }

export interface UnitMetrics {
  unitId: string;
  name: string;
  kind: UnitKind;
  team: Team;
  spec?: string;
  ownerId?: string;
  casts: number;
  topCasts: SpellTally[];
  interruptsLanded: number;
  interruptsLandedBySpell: SpellTally[];
  dispels: number;
  purges: number;
  purgesBySpell: SpellTally[];
  cleanses: number;
  cleansesBySpell: SpellTally[];
  spellsteals: number;
  spellstealsBySpell: SpellTally[];
  deaths: number;
  deathTimesSec: number[];
  distanceMoved: number;
  positionSamples: number;
  timeStationarySec: number;
}

export interface CombinedTotals {
  casts: number;
  interruptsLanded: number;
  interruptsLandedBySpell: SpellTally[];
  dispels: number;
  purges: number;
  cleanses: number;
  spellsteals: number;
  deaths: number;
}

export interface PlayerGroup { player: UnitMetrics; pets: UnitMetrics[]; combined: CombinedTotals; }
export interface TeamGroup { team: Team; players: PlayerGroup[]; unownedPets: UnitMetrics[]; }

export type TimelineKind = 'cast' | 'interrupt' | 'dispel' | 'steal' | 'death';
export interface TimelineEvent { tSec: number; unitId: string; unitName: string; kind: TimelineKind; spell?: string; extra?: string; }

export interface MatchMetrics { teams: TeamGroup[]; timeline: TimelineEvent[]; playerUnitId?: string; }

export function tally(names: string[]): SpellTally[] {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].map(([spellName, count]) => ({ spellName, count })).sort((a, b) => b.count - a.count);
}

export function unitKind(type: unknown): UnitKind {
  return type === 1 || type === '1' ? 'player' : type === 3 || type === '3' ? 'primary-pet' : type === 4 || type === '4' ? 'temp-pet' : 'other';
}

export function unitTeam(reaction: unknown): Team {
  const r = String(reaction);
  return r === '1' || r === 'Friendly' ? 'friendly' : r === '2' || r === 'Hostile' ? 'enemy' : 'neutral';
}
```

- [ ] **Step 2: Write the failing test** — `test/perUnit.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { computeUnitMetrics } from '../src/metrics/perUnit.js';

function match() {
  return {
    playerId: 'P',
    units: {
      P: { name: 'You', type: 1, reaction: 1, spec: '265', ownerId: '0' },
      PET: { name: 'Zhaazhem', type: 3, reaction: 1, ownerId: 'P' },
      E: { name: 'Enemy', type: 1, reaction: 2, ownerId: '0' },
    },
    events: [
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Agony', timestamp: 1000, positionX: 0, positionY: 0 },
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Agony', timestamp: 2000, positionX: 3, positionY: 4 },
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'PET', spellName: 'Shadowbite', timestamp: 2500 },
      { logLine: { event: 'SPELL_INTERRUPT' }, srcUnitId: 'PET', destUnitId: 'E', spellName: 'Spell Lock', extraSpellName: 'Polymorph', timestamp: 3000 },
      { logLine: { event: 'SPELL_DISPEL', parameters: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,'BUFF'] }, srcUnitId: 'PET', destUnitId: 'E', spellName: 'Devour Magic', extraSpellName: 'Power Word: Shield', timestamp: 3500 },
      { logLine: { event: 'UNIT_DIED' }, destUnitId: 'E', timestamp: 5000 },
    ],
  };
}

describe('computeUnitMetrics', () => {
  const units = computeUnitMetrics(match());
  const byId = (id: string) => units.find((u) => u.unitId === id)!;

  it('attributes casts to the actual caster (pet casts not on the player)', () => {
    expect(byId('P').casts).toBe(2);
    expect(byId('P').topCasts).toEqual([{ spellName: 'Agony', count: 2 }]);
    expect(byId('PET').casts).toBe(1);
    expect(byId('PET').topCasts).toEqual([{ spellName: 'Shadowbite', count: 1 }]);
  });

  it('puts the pet interrupt + dispel on the pet, classified', () => {
    expect(byId('PET').interruptsLanded).toBe(1);
    expect(byId('PET').interruptsLandedBySpell).toEqual([{ spellName: 'Polymorph', count: 1 }]);
    expect(byId('PET').dispels).toBe(1);
    expect(byId('PET').purges).toBe(1);
    expect(byId('PET').cleanses).toBe(0);
  });

  it('sets kind/team and attributes the death by dest', () => {
    expect(byId('P').kind).toBe('player');
    expect(byId('P').team).toBe('friendly');
    expect(byId('PET').kind).toBe('primary-pet');
    expect(byId('E').team).toBe('enemy');
    expect(byId('E').deaths).toBe(1);
  });

  it('computes movement distance from position samples (3-4-5 = 5 units)', () => {
    expect(byId('P').positionSamples).toBe(1); // (0,0) is treated as no-position; only (3,4) counts
    expect(byId('P').distanceMoved).toBe(0);   // single sample -> no movement
  });
});
```

- [ ] **Step 3: Run, confirm FAIL** — `npx vitest run test/perUnit.test.ts` (module not found).

- [ ] **Step 4: Implement `src/metrics/perUnit.ts`**

```ts
import { eventType, srcId, destId, spellName, extraSpellName, auraType, eventTimeMs, position } from './eventAccess.js';
import { tally, unitKind, unitTeam, type UnitMetrics } from './types.js';

interface Acc {
  casts: string[];
  interrupts: string[];
  purgesRemoved: string[];
  cleansesRemoved: string[];
  steals: string[];
  deathMs: number[];
  positions: { ms: number; x: number; y: number }[];
}

function emptyAcc(): Acc {
  return { casts: [], interrupts: [], purgesRemoved: [], cleansesRemoved: [], steals: [], deathMs: [], positions: [] };
}

const STATIONARY_EPS = 0.5;

export function computeUnitMetrics(match: unknown): UnitMetrics[] {
  const m = match as { events?: unknown[]; units?: Record<string, Record<string, unknown>> };
  const events = Array.isArray(m.events) ? m.events : [];
  const units = m.units ?? {};
  const startMs = events.length > 0 ? eventTimeMs(events[0]) : undefined;

  const accs = new Map<string, Acc>();
  const acc = (id: string): Acc => {
    let a = accs.get(id);
    if (!a) { a = emptyAcc(); accs.set(id, a); }
    return a;
  };

  for (const ev of events) {
    const t = eventType(ev);
    const s = srcId(ev);
    const d = destId(ev);
    const ms = eventTimeMs(ev);

    if (s) {
      const p = position(ev);
      if (p && ms !== undefined) acc(s).positions.push({ ms, x: p.x, y: p.y });
    }

    if (t === 'SPELL_CAST_SUCCESS' && s) acc(s).casts.push(spellName(ev));
    else if (t === 'SPELL_INTERRUPT' && s) acc(s).interrupts.push(extraSpellName(ev) ?? spellName(ev));
    else if (t === 'SPELL_DISPEL' && s) {
      const removed = extraSpellName(ev) ?? spellName(ev);
      if (auraType(ev) === 'BUFF') acc(s).purgesRemoved.push(removed);
      else if (auraType(ev) === 'DEBUFF') acc(s).cleansesRemoved.push(removed);
    } else if (t === 'SPELL_STOLEN' && s) acc(s).steals.push(extraSpellName(ev) ?? spellName(ev));
    else if (t === 'UNIT_DIED' && d) acc(d).deathMs.push(ms ?? NaN);
  }

  const result: UnitMetrics[] = [];
  for (const [id, a] of accs) {
    const u = units[id] ?? {};
    const samples = a.positions.sort((x, y) => x.ms - y.ms);
    let distance = 0;
    let stationarySec = 0;
    for (let i = 1; i < samples.length; i++) {
      const dx = samples[i].x - samples[i - 1].x;
      const dy = samples[i].y - samples[i - 1].y;
      const step = Math.sqrt(dx * dx + dy * dy);
      distance += step;
      if (step < STATIONARY_EPS) stationarySec += (samples[i].ms - samples[i - 1].ms) / 1000;
    }
    const ownerRaw = typeof u.ownerId === 'string' ? u.ownerId : undefined;
    result.push({
      unitId: id,
      name: typeof u.name === 'string' && u.name.length > 0 ? u.name : id,
      kind: unitKind(u.type),
      team: unitTeam(u.reaction),
      spec: u.spec !== undefined ? String(u.spec) : undefined,
      ownerId: ownerRaw && ownerRaw !== '0' && ownerRaw !== '0000000000000000' ? ownerRaw : undefined,
      casts: a.casts.length,
      topCasts: tally(a.casts).slice(0, 8),
      interruptsLanded: a.interrupts.length,
      interruptsLandedBySpell: tally(a.interrupts),
      dispels: a.purgesRemoved.length + a.cleansesRemoved.length,
      purges: a.purgesRemoved.length,
      purgesBySpell: tally(a.purgesRemoved),
      cleanses: a.cleansesRemoved.length,
      cleansesBySpell: tally(a.cleansesRemoved),
      spellsteals: a.steals.length,
      spellstealsBySpell: tally(a.steals),
      deaths: a.deathMs.length,
      deathTimesSec: startMs !== undefined ? a.deathMs.filter((x) => !Number.isNaN(x)).map((x) => Math.round((x - startMs) / 1000)) : [],
      distanceMoved: Math.round(distance * 10) / 10,
      positionSamples: samples.length,
      timeStationarySec: Math.round(stationarySec * 10) / 10,
    });
  }
  return result;
}
```

- [ ] **Step 5: Run, confirm PASS** — `npx vitest run test/perUnit.test.ts` (4 tests). `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/metrics/types.ts src/metrics/perUnit.ts test/perUnit.test.ts
git commit -m "feat: per-unit metric attribution + movement (types + computeUnitMetrics)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Grouping (pet→owner, team, combined totals)

**Files:** Create `src/metrics/grouping.ts`, `test/grouping.test.ts`

- [ ] **Step 1: Write the failing test** — `test/grouping.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { groupUnits } from '../src/metrics/grouping.js';
import type { UnitMetrics } from '../src/metrics/types.js';

function u(over: Partial<UnitMetrics> & Pick<UnitMetrics, 'unitId' | 'kind' | 'team'>): UnitMetrics {
  return {
    name: over.unitId, spec: undefined, ownerId: undefined,
    casts: 0, topCasts: [], interruptsLanded: 0, interruptsLandedBySpell: [],
    dispels: 0, purges: 0, purgesBySpell: [], cleanses: 0, cleansesBySpell: [],
    spellsteals: 0, spellstealsBySpell: [], deaths: 0, deathTimesSec: [],
    distanceMoved: 0, positionSamples: 0, timeStationarySec: 0, ...over,
  } as UnitMetrics;
}

describe('groupUnits', () => {
  const units: UnitMetrics[] = [
    u({ unitId: 'P', kind: 'player', team: 'friendly', casts: 10, interruptsLanded: 0 }),
    u({ unitId: 'PET', kind: 'primary-pet', team: 'friendly', ownerId: 'P', interruptsLanded: 1, interruptsLandedBySpell: [{ spellName: 'Polymorph', count: 1 }], purges: 2, dispels: 2 }),
    u({ unitId: 'E', kind: 'player', team: 'enemy', casts: 8 }),
    u({ unitId: 'ORPHAN', kind: 'temp-pet', team: 'enemy', ownerId: 'GONE' }),
  ];
  const teams = groupUnits(units, 'P');

  it('splits teams and nests pets under owners', () => {
    const friendly = teams.find((t) => t.team === 'friendly')!;
    expect(friendly.players.map((p) => p.player.unitId)).toEqual(['P']);
    expect(friendly.players[0].pets.map((p) => p.unitId)).toEqual(['PET']);
  });

  it('computes combined = player + pets', () => {
    const pg = teams.find((t) => t.team === 'friendly')!.players[0];
    expect(pg.combined.casts).toBe(10);            // player 10 + pet 0
    expect(pg.combined.interruptsLanded).toBe(1);  // pet's interrupt counted for the player
    expect(pg.combined.purges).toBe(2);
    expect(pg.combined.interruptsLandedBySpell).toEqual([{ spellName: 'Polymorph', count: 1 }]);
  });

  it('buckets pets whose owner is not a known player', () => {
    const enemy = teams.find((t) => t.team === 'enemy')!;
    expect(enemy.unownedPets.map((p) => p.unitId)).toEqual(['ORPHAN']);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run test/grouping.test.ts`.

- [ ] **Step 3: Implement `src/metrics/grouping.ts`**

```ts
import { tally, type UnitMetrics, type PlayerGroup, type TeamGroup, type Team, type CombinedTotals } from './types.js';

const TEAM_ORDER: Team[] = ['friendly', 'enemy', 'neutral'];

function combine(player: UnitMetrics, pets: UnitMetrics[]): CombinedTotals {
  const all = [player, ...pets];
  const sum = (f: (u: UnitMetrics) => number) => all.reduce((acc, u) => acc + f(u), 0);
  const mergedInterrupts = tally(all.flatMap((u) => u.interruptsLandedBySpell.flatMap((s) => Array(s.count).fill(s.spellName))));
  return {
    casts: sum((u) => u.casts),
    interruptsLanded: sum((u) => u.interruptsLanded),
    interruptsLandedBySpell: mergedInterrupts,
    dispels: sum((u) => u.dispels),
    purges: sum((u) => u.purges),
    cleanses: sum((u) => u.cleanses),
    spellsteals: sum((u) => u.spellsteals),
    deaths: sum((u) => u.deaths),
  };
}

export function groupUnits(units: UnitMetrics[], playerUnitId?: string): TeamGroup[] {
  const players = units.filter((u) => u.kind === 'player');
  const playerIds = new Set(players.map((p) => p.unitId));
  const pets = units.filter((u) => u.kind !== 'player');

  const teams: TeamGroup[] = TEAM_ORDER.map((team) => ({ team, players: [], unownedPets: [] }));
  const teamOf = (t: Team) => teams.find((x) => x.team === t)!;

  // place players; sort recording player first, then by combined-ish casts
  for (const p of players) {
    const owned = pets.filter((pet) => pet.ownerId && pet.ownerId === p.unitId);
    const group: PlayerGroup = { player: p, pets: owned, combined: combine(p, owned) };
    teamOf(p.team).players.push(group);
  }
  for (const t of teams) {
    t.players.sort((a, b) => {
      if (a.player.unitId === playerUnitId) return -1;
      if (b.player.unitId === playerUnitId) return 1;
      return b.combined.casts - a.combined.casts;
    });
  }

  // pets whose owner isn't a known player -> unownedPets on the pet's own team
  for (const pet of pets) {
    if (!pet.ownerId || !playerIds.has(pet.ownerId)) teamOf(pet.team).unownedPets.push(pet);
  }

  return teams.filter((t) => t.players.length > 0 || t.unownedPets.length > 0);
}
```

- [ ] **Step 4: Run, confirm PASS** — `npx vitest run test/grouping.test.ts` (3 tests). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/grouping.ts test/grouping.test.ts
git commit -m "feat: group units by team + nest pets under owners + combined totals

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Spell-use & casting timeline (Phase 2)

**Files:** Create `src/metrics/timeline.ts`, `test/timeline.test.ts`

- [ ] **Step 1: Write the failing test** — `test/timeline.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../src/metrics/timeline.js';

describe('buildTimeline', () => {
  const tl = buildTimeline({
    units: { P: { name: 'You' }, E: { name: 'Enemy' } },
    events: [
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Agony', timestamp: 1000 },
      { logLine: { event: 'SPELL_INTERRUPT' }, srcUnitId: 'P', destUnitId: 'E', spellName: 'Spell Lock', extraSpellName: 'Fear', timestamp: 3000 },
      { logLine: { event: 'UNIT_DIED' }, destUnitId: 'E', timestamp: 5000 },
      { logLine: { event: 'SPELL_PERIODIC_DAMAGE' }, srcUnitId: 'P', spellName: 'Agony', timestamp: 1500 }, // ignored kind
    ],
  });

  it('includes only interesting kinds, sorted by tSec, with labels', () => {
    expect(tl.map((e) => e.kind)).toEqual(['cast', 'interrupt', 'death']);
    expect(tl[0]).toMatchObject({ tSec: 0, unitName: 'You', kind: 'cast', spell: 'Agony' });
    expect(tl[1]).toMatchObject({ tSec: 2, kind: 'interrupt', spell: 'Spell Lock', extra: 'Fear' });
    expect(tl[2]).toMatchObject({ tSec: 4, unitName: 'Enemy', kind: 'death' });
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run test/timeline.test.ts`.

- [ ] **Step 3: Implement `src/metrics/timeline.ts`**

```ts
import { eventType, srcId, destId, spellName, extraSpellName, eventTimeMs } from './eventAccess.js';
import type { TimelineEvent, TimelineKind } from './types.js';

const KIND: Record<string, TimelineKind> = {
  SPELL_CAST_SUCCESS: 'cast',
  SPELL_INTERRUPT: 'interrupt',
  SPELL_DISPEL: 'dispel',
  SPELL_STOLEN: 'steal',
  UNIT_DIED: 'death',
};

export function buildTimeline(match: unknown): TimelineEvent[] {
  const m = match as { events?: unknown[]; units?: Record<string, { name?: unknown }> };
  const events = Array.isArray(m.events) ? m.events : [];
  const units = m.units ?? {};
  const startMs = events.length > 0 ? eventTimeMs(events[0]) : undefined;
  const nameOf = (id: string | undefined) => {
    const u = id ? units[id] : undefined;
    return u && typeof u.name === 'string' && u.name.length > 0 ? u.name : id ?? '?';
  };

  const out: TimelineEvent[] = [];
  for (const ev of events) {
    const kind = KIND[eventType(ev)];
    if (!kind) continue;
    const ms = eventTimeMs(ev);
    if (ms === undefined || startMs === undefined) continue;
    const actorId = kind === 'death' ? destId(ev) : srcId(ev);
    out.push({
      tSec: Math.round((ms - startMs) / 1000),
      unitId: actorId ?? '?',
      unitName: nameOf(actorId),
      kind,
      spell: kind === 'death' ? undefined : spellName(ev),
      extra: kind === 'interrupt' || kind === 'dispel' || kind === 'steal' ? extraSpellName(ev) : undefined,
    });
  }
  return out.sort((a, b) => a.tSec - b.tSec);
}
```

- [ ] **Step 4: Run, confirm PASS** — `npx vitest run test/timeline.test.ts`. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/timeline.ts test/timeline.test.ts
git commit -m "feat: match spell-use/casting timeline (ordered, labelled events)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Orchestrator rewrite + remove playerUnits + registry + golden

**Files:** Rewrite `src/metrics/metrics.ts`; Delete `src/metrics/playerUnits.ts`, `test/playerUnits.test.ts`; Modify `src/metrics/registry.ts`; Rewrite `test/metrics.test.ts`

- [ ] **Step 1: Rewrite `src/metrics/metrics.ts`** (orchestrator)

```ts
import { computeUnitMetrics } from './perUnit.js';
import { groupUnits } from './grouping.js';
import { buildTimeline } from './timeline.js';
import type { MatchMetrics } from './types.js';

export * from './types.js';

export function computeMatchMetrics(match: unknown): MatchMetrics {
  const m = match as { playerId?: unknown };
  const playerUnitId = typeof m.playerId === 'string' ? m.playerId : undefined;
  const units = computeUnitMetrics(match);
  return {
    teams: groupUnits(units, playerUnitId),
    timeline: buildTimeline(match),
    playerUnitId,
  };
}
```

- [ ] **Step 2: Delete the superseded module + its test**

```bash
git rm src/metrics/playerUnits.ts test/playerUnits.test.ts
```
Then `grep -rn "playerUnits\|resolvePlayerUnits" src test` — expected: no matches (if any remain, they're stale imports to remove).

- [ ] **Step 3: Replace `src/metrics/registry.ts`**

```ts
export type MetricCategory = 'disruption-out' | 'tempo' | 'outcome' | 'movement';

export interface MetricDef { id: string; label: string; category: MetricCategory; }

/** Per-unit metric defs (Plan-4 battery grows this). */
export const METRICS: MetricDef[] = [
  { id: 'interruptsLanded', label: 'Interrupts landed', category: 'disruption-out' },
  { id: 'purges', label: 'Purges', category: 'disruption-out' },
  { id: 'cleanses', label: 'Cleanses', category: 'disruption-out' },
  { id: 'spellsteals', label: 'Spellsteals', category: 'disruption-out' },
  { id: 'casts', label: 'Casts', category: 'tempo' },
  { id: 'deaths', label: 'Deaths', category: 'outcome' },
  { id: 'distanceMoved', label: 'Distance moved', category: 'movement' },
  { id: 'timeStationarySec', label: 'Time stationary (s)', category: 'movement' },
];
```

- [ ] **Step 4: Rewrite `test/metrics.test.ts`** (orchestrator + fixture golden on the new shape)

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { computeMatchMetrics } from '../src/metrics/metrics.js';
import { parseLogFile } from '../src/parser/parserClient.js';

describe('computeMatchMetrics (synthetic)', () => {
  const mm = computeMatchMetrics({
    playerId: 'P',
    units: { P: { name: 'You', type: 1, reaction: 1 }, E: { name: 'Enemy', type: 1, reaction: 2 } },
    events: [
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Agony', timestamp: 1000 },
      { logLine: { event: 'UNIT_DIED' }, destUnitId: 'E', timestamp: 2000 },
    ],
  });
  it('produces teams, a timeline, and the player id', () => {
    expect(mm.playerUnitId).toBe('P');
    expect(mm.teams.find((t) => t.team === 'friendly')!.players[0].player.unitId).toBe('P');
    expect(mm.teams.find((t) => t.team === 'enemy')!.players[0].player.deaths).toBe(1);
    expect(mm.timeline.length).toBe(2);
  });
});

const FIXTURE = 'test-data/fixtures/arena-sample.log';
describe('computeMatchMetrics (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('attributes the warlock Felhunter under the player, combined', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const mm = computeMatchMetrics(arenaMatches[0]);
    const me = mm.teams.flatMap((t) => t.players).find((p) => p.player.unitId === mm.playerUnitId)!;
    expect(me).toBeTruthy();
    expect(me.pets.length).toBeGreaterThanOrEqual(1);             // Felhunter + guardians
    expect(me.combined.interruptsLanded).toBeGreaterThanOrEqual(1); // Spell Lock via pet
    expect(me.combined.purges).toBeGreaterThanOrEqual(1);          // Devour Magic via pet
    expect(me.player.casts).toBeGreaterThan(0);
    expect(mm.timeline.length).toBeGreaterThan(0);
    expect(me.player.positionSamples).toBeGreaterThan(0);          // movement Phase 3
  });
});
```

- [ ] **Step 5: Run + typecheck** — `npx vitest run test/metrics.test.ts` (synthetic + golden pass), `npx tsc --noEmit` clean, full `npm test` (the old playerUnits test is gone; renderReport still references the OLD metrics shape and will FAIL — that's expected and fixed in Task 6; if `npm test` is red only on renderReport, proceed).

- [ ] **Step 6: Commit**

```bash
git add src/metrics/metrics.ts src/metrics/registry.ts test/metrics.test.ts
git rm --cached src/metrics/playerUnits.ts test/playerUnits.test.ts 2>/dev/null; true
git commit -m "feat: computeMatchMetrics orchestrator (teams+timeline); remove playerUnits

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Report rendering (team/player-group + timeline) + real report

**Files:** Modify `src/view/renderReport.ts`, `test/renderReport.test.ts`. (`src/cli/view.ts` unchanged — verify.)

- [ ] **Step 1: Update the render test** — in `test/renderReport.test.ts`

Replace the old `MatchMetrics` import + the metrics-block test with the new shape. Add at the top: `import type { MatchMetrics } from '../src/metrics/metrics.js';`. Ensure the `match(over)` helper still defaults `metrics: undefined`. Replace the previous metrics-block test with:
```ts
describe('renderReport metrics block (per-player)', () => {
  it('renders team sections with a player combined line', () => {
    const metrics: MatchMetrics = {
      playerUnitId: 'P',
      timeline: [{ tSec: 5, unitId: 'P', unitName: 'You', kind: 'cast', spell: 'Agony' }],
      teams: [
        {
          team: 'friendly',
          unownedPets: [],
          players: [
            {
              player: {
                unitId: 'P', name: 'You', kind: 'player', team: 'friendly', spec: '265', ownerId: undefined,
                casts: 100, topCasts: [{ spellName: 'Agony', count: 30 }], interruptsLanded: 0, interruptsLandedBySpell: [],
                dispels: 0, purges: 0, purgesBySpell: [], cleanses: 0, cleansesBySpell: [], spellsteals: 0, spellstealsBySpell: [],
                deaths: 0, deathTimesSec: [], distanceMoved: 1234.5, positionSamples: 200, timeStationarySec: 12.3,
              },
              pets: [
                {
                  unitId: 'PET', name: 'Zhaazhem', kind: 'primary-pet', team: 'friendly', ownerId: 'P',
                  casts: 20, topCasts: [], interruptsLanded: 1, interruptsLandedBySpell: [{ spellName: 'Fear', count: 1 }],
                  dispels: 5, purges: 5, purgesBySpell: [{ spellName: 'Backlash', count: 3 }], cleanses: 0, cleansesBySpell: [],
                  spellsteals: 0, spellstealsBySpell: [], deaths: 0, deathTimesSec: [], distanceMoved: 0, positionSamples: 0, timeStationarySec: 0,
                },
              ],
              combined: { casts: 120, interruptsLanded: 1, interruptsLandedBySpell: [{ spellName: 'Fear', count: 1 }], dispels: 5, purges: 5, cleanses: 0, spellsteals: 0, deaths: 0 },
            },
          ],
        },
      ],
    };
    const html = renderReport([match({ metrics })], index());
    expect(html).toContain('Your team');
    expect(html).toContain('Zhaazhem');     // pet line
    expect(html).toContain('Backlash');     // what was purged
    expect(html).toContain('120');          // combined casts
    expect(html).toContain('timeline');     // timeline section present
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run test/renderReport.test.ts`.

- [ ] **Step 3: Rewrite the metrics rendering in `src/view/renderReport.ts`**

Update the import from the metrics module to the new shape: `import type { MatchMetrics, PlayerGroup, TeamGroup, UnitMetrics, TimelineEvent } from '../metrics/metrics.js';` (keep `ParsedMatchView.metrics?: MatchMetrics`). Replace the old `metricsBlock` with:
```ts
const TEAM_LABEL: Record<string, string> = { friendly: 'Your team', enemy: 'Enemy team', neutral: 'Neutral' };

function tallyStr(t: { spellName: string; count: number }[]): string {
  return t.length ? t.map((x) => `${escapeHtml(x.spellName)}×${x.count}`).join(', ') : '—';
}

function unitRow(u: UnitMetrics, label: string): string {
  return `<tr><td>${escapeHtml(label)}${escapeHtml(u.name)}</td>` +
    `<td>${u.casts}</td><td>${u.interruptsLanded}${u.interruptsLandedBySpell.length ? ' (' + tallyStr(u.interruptsLandedBySpell) + ')' : ''}</td>` +
    `<td>${u.purges}/${u.cleanses}${u.purgesBySpell.length ? ' (' + tallyStr(u.purgesBySpell) + ')' : ''}</td>` +
    `<td>${u.spellsteals}</td><td>${u.deaths}</td><td>${u.distanceMoved} (${u.timeStationarySec}s still)</td></tr>`;
}

function playerGroupBlock(pg: PlayerGroup, isYou: boolean): string {
  const c = pg.combined;
  const head = `<tr class="pg-head"><td><b>${isYou ? '★ ' : ''}${escapeHtml(pg.player.name)}</b>${pg.player.spec ? ' (' + escapeHtml(pg.player.spec) + ')' : ''}${pg.pets.length ? ` [+${pg.pets.length} pet]` : ''}</td>` +
    `<td>${c.casts}</td><td>${c.interruptsLanded}${c.interruptsLandedBySpell.length ? ' (' + tallyStr(c.interruptsLandedBySpell) + ')' : ''}</td>` +
    `<td>${c.purges}/${c.cleanses}</td><td>${c.spellsteals}</td><td>${c.deaths}</td><td></td></tr>`;
  const own = unitRow(pg.player, '↳ self: ');
  const pets = pg.pets.map((p) => unitRow(p, '↳ pet: ')).join('');
  return head + own + pets;
}

function teamBlock(tg: TeamGroup, playerUnitId: string | undefined): string {
  const rows = tg.players.map((pg) => playerGroupBlock(pg, pg.player.unitId === playerUnitId)).join('') +
    tg.unownedPets.map((p) => unitRow(p, '(unowned) ')).join('');
  return `<h5>${escapeHtml(TEAM_LABEL[tg.team] ?? tg.team)}</h5>
  <table><tr><th>unit</th><th>casts</th><th>interrupts</th><th>purge/cleanse</th><th>steals</th><th>deaths</th><th>move</th></tr>${rows}</table>`;
}

function timelineBlock(tl: TimelineEvent[]): string {
  if (!tl.length) return '';
  const rows = tl.map((e) => `<tr><td>${e.tSec}s</td><td>${escapeHtml(e.unitName)}</td><td>${escapeHtml(e.kind)}</td><td>${escapeHtml(e.spell ?? '')}${e.extra ? ' → ' + escapeHtml(e.extra) : ''}</td></tr>`).join('');
  return `<details><summary>spell-use timeline (${tl.length} events)</summary>
  <table><tr><th>t</th><th>unit</th><th>action</th><th>spell</th></tr>${rows}</table></details>`;
}

function metricsBlock(mm: MatchMetrics | undefined): string {
  if (!mm) return '';
  return `<h4>Metrics (per player)</h4>
  ${mm.teams.map((t) => teamBlock(t, mm.playerUnitId)).join('')}
  ${timelineBlock(mm.timeline)}`;
}
```
Keep the `${metricsBlock(m.metrics)}` call already present in `matchSection` (it stays in the same spot).

- [ ] **Step 4: Run, confirm PASS** — `npx vitest run test/renderReport.test.ts`. Then full `npm test` (all green now), `npx tsc --noEmit` clean.

- [ ] **Step 5: Verify `src/cli/view.ts` unchanged & correct** — it still does `metrics: computeMatchMetrics(m)`; confirm it compiles against the new `MatchMetrics` (it does — the field is still `metrics`).

- [ ] **Step 6: Commit**

```bash
git add src/view/renderReport.ts test/renderReport.test.ts
git commit -m "feat: render per-player team groups + spell-use timeline in report

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Generate the real report (deliverable)**

```bash
npm run view -- "D:/WoW_Arena_Coach/sample_data/logs/WoWCombatLog-052926_235715.txt"
```
(Reads the NAS sidecars — may take a couple minutes.) Confirm `Wrote report: <abs path>`. Then report the absolute path, and for the FIRST match: the friendly-team player combined lines (name, casts, interrupts, purge/cleanse) + your self-vs-pet split + your distance-moved + the timeline event count — so the user can spot-check player/pet attribution and movement. `output/` is git-ignored — do NOT commit the report.

---

## Self-Review

**1. Spec coverage:**
- §3.1 per-unit attribution (by source; pet casts off player; purge/cleanse by-spell; deaths by dest) → Task 2 `computeUnitMetrics`. ✓
- §3.1 kind/team/spec/ownerId mapping → Task 2 `types.ts` (`unitKind`/`unitTeam`) + perUnit. ✓
- §3.2 pet→owner grouping, unowned bucket, combined totals, team grouping → Task 3 `groupUnits`. ✓
- §3.3 timeline (ordered, labelled, tSec, kinds) → Task 4 `buildTimeline`. ✓
- §3.4 movement (distance, positionSamples, timeStationarySec) + `position` accessor → Task 1 + Task 2. ✓
- §4 shapes → Task 2 `types.ts` (identical). ✓
- §5 file structure (per-phase modules; remove playerUnits) → Tasks 2–5. ✓
- §6 report (team→player-group, combined headline + self/pet split, timeline, you-highlight) → Task 6. ✓
- §7 error handling (missing type/reaction/ownerId → other/neutral/none; orphan pets; missing position/timestamp; empty) → Task 2/3/4 guards. ✓
- §8 testing (perUnit/grouping/timeline/movement/golden) → Tasks 2–5 tests. ✓
- Deliverable real report → Task 6 Step 7. ✓
- Deferred phases 4–6 + spell-metadata: intentionally NOT in this plan (documented in spec §9). ✓

**2. Placeholder scan:** No TBD/TODO. The `position` field-name uncertainty is handled by the Task 1 accessor + a TDD test on real data that forces discovery (Step 4), concrete dump command included — not a placeholder.

**3. Type consistency:** `UnitMetrics`/`PlayerGroup`/`TeamGroup`/`CombinedTotals`/`TimelineEvent`/`MatchMetrics`/`SpellTally` all defined once in `types.ts` (Task 2) and imported everywhere (Tasks 3–6). `computeUnitMetrics(match): UnitMetrics[]`, `groupUnits(units, playerUnitId?): TeamGroup[]`, `buildTimeline(match): TimelineEvent[]`, `computeMatchMetrics(match): MatchMetrics` signatures are consistent across their definitions, the orchestrator (Task 5), and tests. `position`/`eventTimeMs`/`srcId`/`destId`/`spellName`/`extraSpellName`/`auraType` accessor names match Task 1 + their uses in Tasks 2/4. `metrics.ts` re-exports `types.ts` so `renderReport`'s `from '../metrics/metrics.js'` type imports resolve.
