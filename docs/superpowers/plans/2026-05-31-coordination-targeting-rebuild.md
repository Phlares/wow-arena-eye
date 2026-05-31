# Coordination & Targeting Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the noisy `swaps`/`focusFireWindows` coordination metrics with a rolling-window, damage-weighted dominant-target engine (yielding debounced swaps, time-on-target, and team alignment + a retained per-player target track), and fix `absorbDone` to credit the shield owner.

**Architecture:** A new pure engine `targeting.ts` turns damage events into a per-attacker time series of "dominant target" (argmax of damage over a trailing 5s window, with hysteresis on ties and a debounce that removes sub-1s flickers), run-length-encoded into segments. `coordination.ts` is rewritten to consume that engine for swaps/time-on-target/alignment while keeping `targetPriority`/`healerPressureDamage` from raw damage buckets. The engine output rides onto `MatchMetrics.focusTracks` for later analysis and replay export. Separately, a new `absorbInfo` accessor lets `perUnit` attribute absorbs to the shield caster.

**Tech Stack:** TypeScript (ESM, NodeNext — local imports use `.js`), Vitest, tsx. Node ≥22. Tests run with `npx vitest run <file>`; full suite `npm test`.

---

## Conventions for every task

- This codebase isolates all parser field reads behind `src/metrics/eventAccess.ts`. Never read raw event fields elsewhere — go through accessors.
- Local imports use the `.js` extension even though the files are `.ts` (NodeNext). Example: `import { unitTeam } from './types.js';`
- `amount(ev)` already returns a non-negative magnitude; `unitTeam(reaction)` returns `'friendly' | 'enemy' | 'neutral'`.
- Money values are rounded for display only at the edges; keep internal sums precise, round when assembling the result objects (see existing `perUnit.ts`).
- Work on branch `feat/coordination-targeting-rebuild` (already created). Commit after each task.

---

## Task 1: Shared types for the targeting engine

**Files:**
- Modify: `src/metrics/types.ts`

No test of its own — this is type scaffolding that Task 2's test will exercise. Verified by `npx tsc --noEmit` compiling.

- [ ] **Step 1: Add the focus-track and attacker-focus types, redefine `CoordinationSummary`, extend `MatchMetrics`**

In `src/metrics/types.ts`, **replace** the existing `CoordinationSummary` interface (currently lines 12–18):

```ts
export interface CoordinationSummary {
  focusFireWindows: number;
  topFocusTarget?: string;
  targetPriority: { name: string; damageTaken: number }[];
  healerPressureDamage: number;
  swaps: number;
}
```

with the new shapes (drop `focusFireWindows`, add per-attacker focus + alignment + the engine track types):

```ts
export interface FocusSegment { target: string; targetName: string; fromSec: number; toSec: number; }

export interface AttackerTrack {
  attacker: string;        // owning player's unitId
  attackerName: string;
  team: Team;
  ticks: (string | null)[]; // smoothed dominant-target unitId per tick (null = not engaged)
  segments: FocusSegment[]; // run-length encoding of `ticks` (the retained track)
}

export interface FocusTracks { stepMs: number; tickCount: number; startMs: number; tracks: AttackerTrack[]; }

export interface AttackerFocus {
  attacker: string;
  attackerName: string;
  swaps: number;
  topTarget?: string;
  topTargetSec: number;
  engagedSec: number;
}

export interface CoordinationSummary {
  targetPriority: { name: string; damageTaken: number }[];
  topFocusTarget?: string;
  healerPressureDamage: number;
  swaps: number;                  // debounced dominant-target re-aligns (team sum)
  attackerFocus: AttackerFocus[];
  alignmentFraction: number;      // 0..1
  alignedTimeSec: number;
}
```

Then **extend** `MatchMetrics` (currently line 81) to carry the engine output. Replace:

```ts
export interface MatchMetrics { teams: TeamGroup[]; timeline: TimelineEvent[]; playerUnitId?: string; coordination: { team: Team; summary: CoordinationSummary }[]; }
```

with:

```ts
export interface MatchMetrics { teams: TeamGroup[]; timeline: TimelineEvent[]; playerUnitId?: string; coordination: { team: Team; summary: CoordinationSummary }[]; focusTracks: FocusTracks; }
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: Errors ONLY in files that still reference the old shape (`src/metrics/coordination.ts`, `src/metrics/metrics.ts`, `src/view/renderMetrics.ts`, `test/coordination.test.ts`, `test/renderReport.test.ts`). These are fixed in later tasks. No errors inside `types.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/metrics/types.ts
git commit -m "feat(types): focus-track + attacker-focus shapes; redefine CoordinationSummary"
```

---

## Task 2: The targeting engine (`targeting.ts`)

**Files:**
- Create: `src/metrics/targeting.ts`
- Test: `test/targeting.test.ts`

The engine: bucket damage per attacker (pets roll to owner), build a fixed-step tick grid, compute the dominant target per tick over a trailing window with hysteresis on ties, debounce sub-dwell flickers, and run-length-encode into segments.

- [ ] **Step 1: Write the failing test**

Create `test/targeting.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeFocusTracks } from '../src/metrics/targeting.js';

// Helper: build a SPELL_DAMAGE event
const dmg = (src: string, dst: string, amt: number, ms: number) => ({
  logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: src, destUnitId: dst, amount: amt, timestamp: ms,
});

const units = {
  A: { name: 'Ally', type: 1, reaction: 1 },
  B: { name: 'Ally2', type: 1, reaction: 1 },
  Pet: { name: 'Felhunter', type: 3, reaction: 1, ownerId: 'A' },
  X: { name: 'EnemyX', type: 1, reaction: 2 },
  Y: { name: 'EnemyY', type: 1, reaction: 2 },
};

describe('computeFocusTracks', () => {
  it('tracks dominant target switching from X to Y as one swap', () => {
    // A hits X hard for [0,4000), then Y hard for [6000,10000). 500ms step, 5s window.
    const events = [];
    for (let ms = 0; ms < 4000; ms += 500) events.push(dmg('A', 'X', 1000, ms));
    for (let ms = 6000; ms <= 10000; ms += 500) events.push(dmg('A', 'Y', 1000, ms));
    const ft = computeFocusTracks({ units, events });
    const track = ft.tracks.find((t) => t.attacker === 'A')!;
    expect(track.segments.map((s) => s.target)).toEqual(['X', 'Y']);
    // exactly one X->Y transition in the smoothed ticks
    let swaps = 0, prev: string | null = null;
    for (const c of track.ticks) { if (c !== null && prev !== null && c !== prev) swaps++; if (c !== null) prev = c; }
    expect(swaps).toBe(1);
  });

  it('keeps the incumbent target on an equal-damage tie (no churn)', () => {
    // A commits to X, then a tick where X and Y are dealt equal damage in-window: stays X.
    const events = [
      dmg('A', 'X', 1000, 0), dmg('A', 'X', 1000, 500), dmg('A', 'X', 1000, 1000),
      // at t=1500 add equal Y damage so window has X=3000,Y=... keep feeding equal so they tie
      dmg('A', 'Y', 1000, 1500), dmg('A', 'X', 1000, 1500),
    ];
    const ft = computeFocusTracks({ units, events });
    const track = ft.tracks.find((t) => t.attacker === 'A')!;
    // never switches away from X
    expect(track.ticks.filter((t) => t === 'Y').length).toBe(0);
    expect(track.segments.map((s) => s.target)).toEqual(['X']);
  });

  it('debounces a sub-dwell flicker (no extra swap)', () => {
    // A on X throughout, with a single 500ms blip where Y briefly out-damages X.
    const events = [];
    for (let ms = 0; ms <= 8000; ms += 500) events.push(dmg('A', 'X', 1000, ms));
    // one big Y hit at t=4000 that would win that single tick
    events.push(dmg('A', 'Y', 9000, 4000));
    const ft = computeFocusTracks({ units, events, }, { dwellMs: 1000 });
    const track = ft.tracks.find((t) => t.attacker === 'A')!;
    // flicker shorter than dwell (2 ticks) is held -> Y never appears as a stable segment
    expect(track.segments.map((s) => s.target)).toEqual(['X']);
  });

  it('rolls pet damage onto the owner', () => {
    const events = [dmg('Pet', 'X', 1000, 0), dmg('Pet', 'X', 1000, 500)];
    const ft = computeFocusTracks({ units, events });
    expect(ft.tracks.map((t) => t.attacker)).toEqual(['A']); // pet attributed to owner A
    expect(ft.tracks[0].segments[0].target).toBe('X');
  });

  it('returns empty tracks when there is no damage', () => {
    const ft = computeFocusTracks({ units, events: [] });
    expect(ft.tickCount).toBe(0);
    expect(ft.tracks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/targeting.test.ts`
Expected: FAIL — `Failed to resolve import "../src/metrics/targeting.js"` (module does not exist yet).

- [ ] **Step 3: Implement the engine**

Create `src/metrics/targeting.ts`:

```ts
import { eventType, srcId, destId, amount, eventTimeMs } from './eventAccess.js';
import { unitTeam, type Team, type FocusTracks, type AttackerTrack, type FocusSegment } from './types.js';

const WINDOW_MS = 5000;
const STEP_MS = 500;
const DWELL_MS = 1000;
const DAMAGE_EVENTS = /^(SPELL_DAMAGE|SPELL_PERIODIC_DAMAGE|RANGE_DAMAGE|SWING_DAMAGE|SWING_DAMAGE_LANDED)$/;

export interface FocusOpts { windowMs?: number; stepMs?: number; dwellMs?: number; }

interface Hit { target: string; ms: number; amount: number; }

/** Hold the previous *stable* target through any non-null run shorter than dwellTicks.
 *  A genuine disengage (null run >= dwellTicks) resets the memory. */
function debounce(raw: (string | null)[], dwellTicks: number): (string | null)[] {
  if (dwellTicks <= 1) return raw.slice();
  const out = raw.slice();
  let lastStable: string | null = null;
  let i = 0;
  while (i < out.length) {
    let j = i;
    while (j < out.length && out[j] === out[i]) j++;
    const runLen = j - i;
    const val = out[i];
    if (val === null) {
      if (runLen >= dwellTicks) lastStable = null;
    } else if (runLen < dwellTicks) {
      for (let k = i; k < j; k++) out[k] = lastStable;
    } else {
      lastStable = val;
    }
    i = j;
  }
  return out;
}

function encodeSegments(ticks: (string | null)[], stepMs: number, nameOf: (id: string) => string): FocusSegment[] {
  const segs: FocusSegment[] = [];
  let i = 0;
  while (i < ticks.length) {
    const val = ticks[i];
    let j = i;
    while (j < ticks.length && ticks[j] === val) j++;
    if (val !== null) segs.push({ target: val, targetName: nameOf(val), fromSec: (i * stepMs) / 1000, toSec: (j * stepMs) / 1000 });
    i = j;
  }
  return segs;
}

export function computeFocusTracks(match: unknown, opts: FocusOpts = {}): FocusTracks {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const stepMs = opts.stepMs ?? STEP_MS;
  const dwellTicks = Math.max(1, Math.round((opts.dwellMs ?? DWELL_MS) / stepMs));

  const m = match as { events?: unknown[]; units?: Record<string, Record<string, unknown>> };
  const events = Array.isArray(m.events) ? m.events : [];
  const units = m.units ?? {};
  const teamOf = (id: string | undefined): Team => unitTeam((units[id ?? ''] ?? {}).reaction);
  const nameOf = (id: string): string => { const u = units[id]; return u && typeof u.name === 'string' ? u.name : id; };
  const isPlayer = (u: Record<string, unknown> | undefined): boolean => !!u && (u.type === 1 || u.type === '1');

  // Resolve a damage source to its owning PLAYER (pet damage rolls to owner); undefined if not a player-attributable source.
  const attackerOf = (id: string | undefined): string | undefined => {
    const u = units[id ?? ''];
    if (!u) return undefined;
    const ownerRaw = typeof u.ownerId === 'string' && u.ownerId !== '0' && u.ownerId !== '0000000000000000' ? u.ownerId : undefined;
    if (ownerRaw) return isPlayer(units[ownerRaw]) ? ownerRaw : undefined;
    return isPlayer(u) ? id : undefined;
  };

  // Bucket hits per attacker; track match damage span.
  const hitsByAttacker = new Map<string, Hit[]>();
  let startMs: number | undefined;
  let endMs: number | undefined;
  for (const ev of events) {
    if (!DAMAGE_EVENTS.test(eventType(ev))) continue;
    const ms = eventTimeMs(ev);
    if (ms === undefined) continue;
    const attacker = attackerOf(srcId(ev));
    const target = destId(ev);
    if (!attacker || !target) continue;
    const at = teamOf(attacker);
    if (at === 'neutral' || at === teamOf(target)) continue; // enemy dest only (neutral dest = enemy summon, allowed)
    let arr = hitsByAttacker.get(attacker);
    if (!arr) { arr = []; hitsByAttacker.set(attacker, arr); }
    arr.push({ target, ms, amount: amount(ev) });
    if (startMs === undefined || ms < startMs) startMs = ms;
    if (endMs === undefined || ms > endMs) endMs = ms;
  }

  if (startMs === undefined || endMs === undefined) return { stepMs, tickCount: 0, startMs: 0, tracks: [] };
  const tickCount = Math.floor((endMs - startMs) / stepMs) + 1;

  const tracks: AttackerTrack[] = [];
  for (const [attacker, hits] of hitsByAttacker) {
    hits.sort((a, b) => a.ms - b.ms);
    const raw: (string | null)[] = new Array(tickCount).fill(null);
    const windowSum = new Map<string, number>();
    let lo = 0, hi = 0;
    let prevDominant: string | null = null;
    for (let i = 0; i < tickCount; i++) {
      const tickMs = startMs + i * stepMs;
      const loBound = tickMs - windowMs;
      while (hi < hits.length && hits[hi].ms <= tickMs) {
        windowSum.set(hits[hi].target, (windowSum.get(hits[hi].target) ?? 0) + hits[hi].amount);
        hi++;
      }
      while (lo < hi && hits[lo].ms < loBound) {
        const t = hits[lo].target;
        const c = (windowSum.get(t) ?? 0) - hits[lo].amount;
        if (c <= 0) windowSum.delete(t); else windowSum.set(t, c);
        lo++;
      }
      // argmax with hysteresis: keep incumbent unless a challenger STRICTLY exceeds it.
      let best: string | null = null;
      let bestDmg = 0;
      const incumbentDmg = prevDominant !== null ? (windowSum.get(prevDominant) ?? 0) : 0;
      if (incumbentDmg > 0) { best = prevDominant; bestDmg = incumbentDmg; }
      for (const [t, dmg] of windowSum) if (dmg > bestDmg) { best = t; bestDmg = dmg; }
      raw[i] = best;
      prevDominant = best;
    }
    const smoothed = debounce(raw, dwellTicks);
    tracks.push({ attacker, attackerName: nameOf(attacker), team: teamOf(attacker), ticks: smoothed, segments: encodeSegments(smoothed, stepMs, nameOf) });
  }
  return { stepMs, tickCount, startMs, tracks };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/targeting.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/targeting.ts test/targeting.test.ts
git commit -m "feat(metrics): rolling-window dominant-target engine (hysteresis + debounce + RLE)"
```

---

## Task 3: Rewrite `coordination.ts` to consume the engine

**Files:**
- Modify: `src/metrics/coordination.ts` (full rewrite)
- Modify: `test/coordination.test.ts`

`swaps` becomes the debounced dominant-target re-aligns (summed per team), `attackerFocus` gives per-player time-on-target, `alignmentFraction`/`alignedTimeSec` replace `focusFireWindows`. `targetPriority`/`healerPressureDamage` keep their meaning, computed from the same damage buckets. `computeCoordination` gains an optional `tracks` param so `metrics.ts` can share one engine run (falls back to computing its own).

- [ ] **Step 1: Update the test to the new shape**

Replace the whole body of `test/coordination.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { computeCoordination } from '../src/metrics/coordination.js';

const dmg = (src: string, dst: string, amt: number, ms: number) => ({
  logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: src, destUnitId: dst, amount: amt, timestamp: ms,
});

const units = {
  A1: { name: 'Ally1', type: 1, reaction: 1, spec: '0' },
  A2: { name: 'Ally2', type: 1, reaction: 1, spec: '0' },
  H:  { name: 'EnemyHealer', type: 1, reaction: 2, spec: '105' },
  E:  { name: 'EnemyDps', type: 1, reaction: 2, spec: '0' },
};

// Both allies focus E for the first 4s (aligned), then A1 pokes the healer.
const events = [];
for (let ms = 0; ms < 4000; ms += 500) { events.push(dmg('A1', 'E', 800, ms)); events.push(dmg('A2', 'E', 800, ms)); }
events.push(dmg('A1', 'H', 200, 9000));

describe('computeCoordination', () => {
  const teams = computeCoordination({ units, events }, ['105']);
  const friendly = teams.find((t) => t.team === 'friendly')!.summary;

  it('ranks target priority and names the top focus target', () => {
    expect(friendly.topFocusTarget).toBe('EnemyDps');
    expect(friendly.targetPriority[0].name).toBe('EnemyDps');
  });
  it('measures healer pressure on the enemy team', () => {
    expect(friendly.healerPressureDamage).toBe(200);
  });
  it('reports per-attacker focus with sane (small) swap counts', () => {
    expect(friendly.attackerFocus.length).toBeGreaterThanOrEqual(2);
    // A2 only ever hit E -> zero swaps; nobody churns
    expect(friendly.swaps).toBeLessThanOrEqual(2);
    const a2 = friendly.attackerFocus.find((a) => a.attacker === 'A2')!;
    expect(a2.swaps).toBe(0);
    expect(a2.topTarget).toBe('EnemyDps');
    expect(a2.engagedSec).toBeGreaterThan(0);
  });
  it('detects alignment while both allies focus the same target', () => {
    expect(friendly.alignmentFraction).toBeGreaterThan(0);
    expect(friendly.alignmentFraction).toBeLessThanOrEqual(1);
    expect(friendly.alignedTimeSec).toBeGreaterThan(0);
  });
  it('returns both teams', () => {
    expect(teams.map((t) => t.team).sort()).toEqual(['enemy', 'friendly']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/coordination.test.ts`
Expected: FAIL — the current `coordination.ts` still returns `focusFireWindows` and has no `attackerFocus`/`alignmentFraction`, so the new assertions fail / TypeScript errors on missing fields.

- [ ] **Step 3: Rewrite `coordination.ts`**

Replace the entire contents of `src/metrics/coordination.ts` with:

```ts
import { eventType, srcId, destId, amount } from './eventAccess.js';
import { unitTeam, type Team, type CoordinationSummary, type AttackerFocus, type FocusTracks } from './types.js';
import { computeFocusTracks } from './targeting.js';

const DAMAGE_EVENTS = /^(SPELL_DAMAGE|SPELL_PERIODIC_DAMAGE|RANGE_DAMAGE|SWING_DAMAGE|SWING_DAMAGE_LANDED)$/;

export function computeCoordination(
  match: unknown,
  healerSpecIds: string[],
  tracks?: FocusTracks,
): { team: Team; summary: CoordinationSummary }[] {
  const focus = tracks ?? computeFocusTracks(match);
  const m = match as { events?: unknown[]; units?: Record<string, { name?: unknown; reaction?: unknown; spec?: unknown }> };
  const events = Array.isArray(m.events) ? m.events : [];
  const units = m.units ?? {};
  const healer = new Set(healerSpecIds);
  const teamOf = (id: string | undefined) => unitTeam((units[id ?? ''] ?? {}).reaction);
  const nameOf = (id: string | undefined) => { const u = units[id ?? '']; return u && typeof u.name === 'string' ? u.name : id ?? '?'; };
  const isHealer = (id: string | undefined) => healer.has(String((units[id ?? ''] ?? {}).spec));
  const stepSec = focus.stepMs / 1000;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  function summarize(team: Team): CoordinationSummary {
    // Damage buckets (kept): target priority + healer pressure.
    const dmg = events.filter((e) => DAMAGE_EVENTS.test(eventType(e)) && teamOf(srcId(e)) === team && teamOf(destId(e)) !== team);
    const byTarget = new Map<string, number>();
    for (const e of dmg) { const d = destId(e); if (!d) continue; byTarget.set(d, (byTarget.get(d) ?? 0) + amount(e)); }
    const targetPriority = [...byTarget.entries()].map(([id, total]) => ({ name: nameOf(id), damageTaken: total })).sort((a, b) => b.damageTaken - a.damageTaken);
    const healerPressureDamage = dmg.filter((e) => isHealer(destId(e))).reduce<number>((s, e) => s + amount(e), 0);

    // Focus-track derived: per-attacker swaps + time-on-target.
    const teamTracks = focus.tracks.filter((t) => t.team === team);
    const attackerFocus: AttackerFocus[] = teamTracks.map((t) => {
      let swaps = 0;
      let prev: string | null = null;
      let engagedTicks = 0;
      const dwellByTarget = new Map<string, number>();
      for (const cur of t.ticks) {
        if (cur !== null) {
          engagedTicks++;
          dwellByTarget.set(cur, (dwellByTarget.get(cur) ?? 0) + 1);
          if (prev !== null && cur !== prev) swaps++;
          prev = cur; // keep prev across null gaps: re-engaging the SAME target is not a swap
        }
      }
      let topTarget: string | undefined;
      let topTicks = 0;
      for (const [tgt, ticks] of dwellByTarget) if (ticks > topTicks) { topTicks = ticks; topTarget = tgt; }
      return {
        attacker: t.attacker,
        attackerName: t.attackerName,
        swaps,
        topTarget: topTarget ? nameOf(topTarget) : undefined,
        topTargetSec: round1(topTicks * stepSec),
        engagedSec: round1(engagedTicks * stepSec),
      };
    });
    const swaps = attackerFocus.reduce((s, a) => s + a.swaps, 0);

    // Team alignment: ticks where >=2 teammates share the same non-null dominant target.
    let alignedTicks = 0;
    let contestedTicks = 0;
    for (let i = 0; i < focus.tickCount; i++) {
      const counts = new Map<string, number>();
      for (const t of teamTracks) { const v = t.ticks[i]; if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1); }
      const engaged = [...counts.values()].reduce((s, c) => s + c, 0);
      if (engaged >= 2) {
        contestedTicks++;
        if ([...counts.values()].some((c) => c >= 2)) alignedTicks++;
      }
    }
    const alignmentFraction = contestedTicks > 0 ? Math.round((alignedTicks / contestedTicks) * 100) / 100 : 0;
    const alignedTimeSec = round1(alignedTicks * stepSec);

    return { targetPriority, topFocusTarget: targetPriority[0]?.name, healerPressureDamage, swaps, attackerFocus, alignmentFraction, alignedTimeSec };
  }

  return (['friendly', 'enemy'] as Team[]).map((team) => ({ team, summary: summarize(team) }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/coordination.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/coordination.ts test/coordination.test.ts
git commit -m "feat(metrics): coordination from focus tracks (swaps/time-on-target/alignment)"
```

---

## Task 4: Wire the engine into `metrics.ts` (share one run, expose `focusTracks`)

**Files:**
- Modify: `src/metrics/metrics.ts`
- Modify: `test/metrics.test.ts`

`computeMatchMetrics` computes the focus tracks once, passes them into `computeCoordination`, and returns them on `MatchMetrics.focusTracks`. The fixture golden gains a sanity bound on `swaps` (the explicit check against the old 747) and asserts `focusTracks` exist.

- [ ] **Step 1: Update the golden test**

In `test/metrics.test.ts`, the synthetic block (lines 6–21) currently asserts `mm.timeline.length`. Add a `focusTracks` assertion to it. Replace the synthetic `it(...)` block with:

```ts
  it('produces teams, a timeline, focus tracks, and the player id', () => {
    expect(mm.playerUnitId).toBe('P');
    expect(mm.teams.find((t) => t.team === 'friendly')!.players[0].player.unitId).toBe('P');
    expect(mm.teams.find((t) => t.team === 'enemy')!.players[0].player.deaths).toBe(1);
    expect(mm.timeline.length).toBe(2);
    expect(mm.focusTracks).toBeDefined();
    expect(Array.isArray(mm.focusTracks.tracks)).toBe(true);
  });
```

Then **replace** the real-fixture `it(...)` block (lines 25–36) with one that adds the swap sanity bound + focus-track assertions:

```ts
  it.runIf(existsSync(FIXTURE))('produces damage, coordination, focus tracks, and sane swaps', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const mm = computeMatchMetrics(arenaMatches[0]);
    const me = mm.teams.flatMap((t) => t.players).find((p) => p.player.unitId === mm.playerUnitId)!;
    expect(me).toBeTruthy();
    expect(me.combined.damageDone).toBeGreaterThan(0);
    expect(me.player.track.length).toBeGreaterThan(0);

    expect(mm.coordination.length).toBe(2);
    const friendly = mm.coordination.find((c) => c.team === 'friendly')!.summary;
    expect(friendly.targetPriority.length).toBeGreaterThan(0);
    // Sanity: the rebuilt swaps metric is a believable per-match number, not the old 150+/747.
    expect(friendly.swaps).toBeLessThan(60);
    expect(friendly.alignmentFraction).toBeGreaterThanOrEqual(0);
    expect(friendly.alignmentFraction).toBeLessThanOrEqual(1);
    expect(friendly.attackerFocus.length).toBeGreaterThan(0);

    // Retained per-player dominant-target track exists for at least one attacker.
    expect(mm.focusTracks.tracks.some((t) => t.segments.length > 0)).toBe(true);
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/metrics.test.ts`
Expected: FAIL — `mm.focusTracks` is `undefined` (not yet returned by `computeMatchMetrics`); TypeScript also errors that `focusTracks` is missing from the returned object.

- [ ] **Step 3: Update `metrics.ts`**

Replace the body of `computeMatchMetrics` in `src/metrics/metrics.ts`. Add the import and compute the tracks once:

```ts
import { computeUnitMetrics } from './perUnit.js';
import { groupUnits } from './grouping.js';
import { buildTimeline } from './timeline.js';
import { buildAuraState } from './auraState.js';
import { computeCoordination } from './coordination.js';
import { computeFocusTracks } from './targeting.js';
import { HEALER_SPEC_IDS } from './registry.js';
import type { MatchMetrics } from './types.js';

export * from './types.js';

export function computeMatchMetrics(match: unknown): MatchMetrics {
  const m = match as { playerId?: unknown };
  const playerUnitId = typeof m.playerId === 'string' ? m.playerId : undefined;
  const auras = buildAuraState(match);
  const units = computeUnitMetrics(match, auras);
  const focusTracks = computeFocusTracks(match);
  return {
    teams: groupUnits(units, playerUnitId),
    timeline: buildTimeline(match),
    coordination: computeCoordination(match, HEALER_SPEC_IDS, focusTracks),
    focusTracks,
    playerUnitId,
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/metrics.test.ts`
Expected: PASS. (If the real-fixture `swaps` assertion fails because the value is unexpectedly high, STOP and report the actual number — that is the very signal this rebuild exists to surface, and may mean the dwell/window needs tuning before the bound is finalized.)

- [ ] **Step 5: Commit**

```bash
git add src/metrics/metrics.ts test/metrics.test.ts
git commit -m "feat(metrics): share focus engine into coordination + expose focusTracks; swap sanity bound"
```

---

## Task 5: `absorbInfo` accessor — discover the SPELL_ABSORBED shape on the fixture

**Files:**
- Modify: `src/metrics/eventAccess.ts`
- Test: `test/eventAccessAbsorb.test.ts`

`SPELL_ABSORBED.srcUnitId` is the *attacker*, not the shield caster. We add `absorbInfo(ev)` returning the shield owner + absorbed amount. The exact field layout is **discovered against the real fixture**, exactly as every other accessor in this file was (see the file header). Follow the discovery procedure — do not guess blindly.

- [ ] **Step 1: Discovery — inspect a real SPELL_ABSORBED event**

Create a temporary discovery test `test/eventAccessAbsorb.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { eventType } from '../src/metrics/eventAccess.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

describe('SPELL_ABSORBED shape discovery', () => {
  it.runIf(existsSync(FIXTURE))('prints the shape of a real absorbed event', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const events: unknown[] = (arenaMatches[0] as { events: unknown[] }).events;
    const abs = events.find((e) => eventType(e) === 'SPELL_ABSORBED');
    // eslint-disable-next-line no-console
    console.log('KEYS:', abs ? Object.keys(abs as object) : 'NONE');
    // eslint-disable-next-line no-console
    console.log('PARAMS:', JSON.stringify((abs as { logLine?: { parameters?: unknown[] } })?.logLine?.parameters));
    expect(abs, 'fixture contains a SPELL_ABSORBED event').toBeTruthy();
  });
});
```

Run: `npx vitest run test/eventAccessAbsorb.test.ts`
Expected: PASS, and the console prints the event's field keys and raw `parameters` array. **Read that output.** Identify (a) the field/param holding the *absorbing caster* GUID (the shield owner — distinct from `srcUnitId`/`destUnitId`), and (b) the field/param holding the absorbed amount. In raw WoW logs `SPELL_ABSORBED` has two forms; the absorbing-caster GUID + spell + amount sit in a trailing block: `… , absorbCasterGUID, absorbCasterName, absorbCasterFlags, absorbCasterRaidFlags, absorbSpellId, absorbSpellName, absorbSpellSchool, absorbAmount [, critical]`. The wowarenalogs parser may also expose these as named fields (e.g. an `advancedActor*` or `absorb*` field) — prefer a named field if one exists, else read from `logLine.parameters` by index.

If the fixture contains **no** SPELL_ABSORBED event, STOP and report — `absorbInfo` cannot be validated and the absorb fix must be deferred again rather than shipped unverified.

- [ ] **Step 2: Write the failing assertion test**

Replace the contents of `test/eventAccessAbsorb.test.ts` with the real assertion (keep the discovery `console.log`s removed):

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { eventType, absorbInfo, srcId } from '../src/metrics/eventAccess.js';

const FIXTURE = 'test-data/fixtures/arena-sample.log';

describe('absorbInfo (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('returns the shield owner and amount, distinct from the attacker', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const match = arenaMatches[0] as { events: unknown[]; units: Record<string, unknown> };
    const abs = match.events.find((e) => eventType(e) === 'SPELL_ABSORBED' && absorbInfo(e) !== undefined);
    expect(abs, 'an absorbed event with resolvable shield owner exists').toBeTruthy();
    const info = absorbInfo(abs)!;
    expect(typeof info.shieldOwnerId).toBe('string');
    expect(info.shieldOwnerId.length).toBeGreaterThan(0);
    expect(info.amount).toBeGreaterThan(0);
    // The shield owner is the absorbing caster, NOT the attacking source.
    expect(info.shieldOwnerId).not.toBe(srcId(abs));
    // And it is a real unit in the match.
    expect(match.units[info.shieldOwnerId]).toBeTruthy();
  });

  it('returns undefined for non-absorb events', () => {
    expect(absorbInfo({ logLine: { event: 'SPELL_DAMAGE' } })).toBeUndefined();
  });
});
```

Run: `npx vitest run test/eventAccessAbsorb.test.ts`
Expected: FAIL — `absorbInfo` is not exported from `eventAccess.ts` yet.

- [ ] **Step 3: Implement `absorbInfo` against the discovered layout**

Add to `src/metrics/eventAccess.ts` (after `amount`). Use the field/index identified in Step 1. The template below reads from `logLine.parameters`; **set `OWNER_IDX` / `AMOUNT_IDX` (or switch to the named field) to what Step 1 revealed**, and handle both SPELL_ABSORBED forms if the discovery showed a variable-length params array:

```ts
/**
 * Shield owner + absorbed amount for SPELL_ABSORBED.
 * srcUnitId on this event is the ATTACKER; the absorbing caster (shield owner) is a
 * separate field. Field positions discovered via TDD against the real fixture
 * (see test/eventAccessAbsorb.test.ts). Returns undefined when not resolvable.
 */
export function absorbInfo(ev: unknown): { shieldOwnerId: string; amount: number } | undefined {
  if (eventType(ev) !== 'SPELL_ABSORBED') return undefined;
  const ll = logLine(ev);
  const p = ll?.parameters;
  if (!Array.isArray(p)) return undefined;
  // The absorbing-caster block sits at the tail: GUID then (name,flags,raidFlags,spellId,spellName,spellSchool,amount).
  // Discovery (Step 1) confirms the exact offsets for this build; the absorbed amount is the last numeric param,
  // and the shield-owner GUID is the GUID 7 positions before it.
  const amountIdx = p.length - (typeof p[p.length - 1] === 'boolean' || p[p.length - 1] === 'nil' ? 2 : 1);
  const ownerIdx = amountIdx - 7;
  const owner = ownerIdx >= 0 ? str(p[ownerIdx]) : '';
  const amt = Number(p[amountIdx]);
  if (!owner || !owner.includes('-') || !Number.isFinite(amt) || amt <= 0) return undefined;
  return { shieldOwnerId: owner, amount: Math.abs(amt) };
}
```

If Step 1 revealed a **named field** for the shield owner (e.g. the parser already exposes one), prefer reading that directly instead of param indices, and simplify accordingly. The assertion test is the source of truth — make it pass with the cleanest implementation the discovered shape allows.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/eventAccessAbsorb.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/eventAccess.ts test/eventAccessAbsorb.test.ts
git commit -m "feat(metrics): absorbInfo accessor — resolve SPELL_ABSORBED shield owner"
```

---

## Task 6: Credit `absorbDone` to the shield owner in `perUnit.ts`

**Files:**
- Modify: `src/metrics/perUnit.ts`
- Modify: `test/perUnit.test.ts`

`absorbDone` is currently hard-zeroed. Accumulate it per shield owner using `absorbInfo`, then set it on each unit's result.

- [ ] **Step 1: Write the failing test**

Add this test to `test/perUnit.test.ts` (append a new `it` inside the existing top-level `describe`, or add a new `describe`). It builds a synthetic match where an enemy attacks the player and the player's own shield absorbs part of it:

```ts
import { computeUnitMetrics } from '../src/metrics/perUnit.js';
import { buildAuraState } from '../src/metrics/auraState.js';

describe('absorbDone attribution', () => {
  it('credits the shield owner, not the attacker', () => {
    const match = {
      units: {
        P: { name: 'You', type: 1, reaction: 1 },
        E: { name: 'Enemy', type: 1, reaction: 2 },
      },
      events: [
        // Enemy E attacks You P; P's own absorb soaks 300. Shield owner = P (param layout per absorbInfo).
        { logLine: {
            event: 'SPELL_ABSORBED',
            parameters: ['E', 'Enemy', '0x0', '0x0', 'P', 'You', '0x0', '0x0', 'P', 'You', '0x0', '0x0', 17, 'Shield', 1, 300],
          },
          srcUnitId: 'E', destUnitId: 'P', timestamp: 1000 },
      ],
    };
    const units = computeUnitMetrics(match, buildAuraState(match));
    const you = units.find((u) => u.unitId === 'P')!;
    const enemy = units.find((u) => u.unitId === 'E')!;
    expect(you.absorbDone).toBe(300);
    expect(enemy?.absorbDone ?? 0).toBe(0);
  });
});
```

NOTE: the `parameters` array above mirrors the standard SPELL_ABSORBED tail (`…, absorbCasterGUID='P', name, flags, raidFlags, spellId, spellName, spellSchool, amount=300`). If Task 5's discovery established a different layout/field, mirror THAT layout here so the synthetic event matches what `absorbInfo` actually reads.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/perUnit.test.ts`
Expected: FAIL — `you.absorbDone` is `0` (still hard-zeroed).

- [ ] **Step 3: Implement absorb accumulation**

In `src/metrics/perUnit.ts`:

1. Add `absorbInfo` to the import from `./eventAccess.js` (line 1):

```ts
import { eventType, srcId, destId, spellName, extraSpellName, auraType, eventTimeMs, matchStartMs, position, spellId, amount, hpPct, absorbInfo } from './eventAccess.js';
```

2. Add `absorbDone` to the `Acc` interface (after `healingDone: number;`):

```ts
  healingDone: number;
  absorbDone: number;
```

3. Initialise it in `emptyAcc()`:

```ts
    damageDone: 0, healingDone: 0, absorbDone: 0, samples: [],
```

4. Accumulate inside the event loop, after the Healing block (~line 99):

```ts
    // Absorbs: credit the shield owner (SPELL_ABSORBED.srcId is the attacker).
    if (t === 'SPELL_ABSORBED') {
      const info = absorbInfo(ev);
      if (info) acc(info.shieldOwnerId).absorbDone += info.amount;
    }
```

5. Replace the hard-zeroed result field (~line 167) `absorbDone: 0,` with:

```ts
      absorbDone: Math.round(a.absorbDone),
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/perUnit.test.ts`
Expected: PASS (all perUnit tests, including the new absorb test).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/perUnit.ts test/perUnit.test.ts
git commit -m "feat(metrics): credit absorbDone to the shield owner"
```

---

## Task 7: Report rendering — new coordination line + attacker-focus detail

**Files:**
- Modify: `src/view/renderMetrics.ts`
- Modify: `test/renderReport.test.ts`

The per-team coordination line drops `focusFireWindows` and shows swaps, alignment %, aligned time, top target, healer pressure, plus a collapsed per-attacker focus table. Lean — this is validation output, not UI.

- [ ] **Step 1: Update the renderReport test fixture to the new summary shape**

In `test/renderReport.test.ts`, line 94 currently builds the old summary literal. Replace it with the new shape:

```ts
      coordination: [{ team: 'friendly', summary: { topFocusTarget: 'EnemyDps', targetPriority: [{ name: 'EnemyDps', damageTaken: 1000 }], healerPressureDamage: 300, swaps: 4, attackerFocus: [{ attacker: 'A1', attackerName: 'Ally1', swaps: 2, topTarget: 'EnemyDps', topTargetSec: 12.5, engagedSec: 20 }], alignmentFraction: 0.8, alignedTimeSec: 16 } }],
```

The MatchMetrics literal in this test must also satisfy the new required `focusTracks` field. Add this property to the object passed to `metricsBlock`/`renderReport` (alongside `coordination`):

```ts
      focusTracks: { stepMs: 500, tickCount: 0, startMs: 0, tracks: [] },
```

Keep the existing assertion `expect(html).toContain('coordination')` (line ~133); add one more:

```ts
    expect(html).toContain('alignment');
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/renderReport.test.ts`
Expected: FAIL — `metricsBlock` still renders `focusFireWindows` and has no `alignment` text; the literal no longer matches the rendered output.

- [ ] **Step 3: Update `renderMetrics.ts`**

Replace the `coordinationBlock` function (lines 43–46) in `src/view/renderMetrics.ts` with:

```ts
function attackerFocusRows(af: CoordinationSummary['attackerFocus']): string {
  if (!af.length) return '';
  const rows = af.map((a) => `<tr><td>${escapeHtml(a.attackerName)}</td><td>${a.swaps}</td><td>${escapeHtml(a.topTarget ?? '—')}</td><td>${a.topTargetSec}s</td><td>${a.engagedSec}s</td></tr>`).join('');
  return `<details><summary>per-attacker focus</summary>
  <table><tr><th>player</th><th>swaps</th><th>top target</th><th>on target</th><th>engaged</th></tr>${rows}</table></details>`;
}

function coordinationBlock(coord: MatchMetrics['coordination']): string {
  if (!coord?.length) return '';
  return coord.map((c) => {
    const s = c.summary;
    return `<p class="coord">${escapeHtml(c.team)} coordination — swaps: ${s.swaps}, alignment: ${Math.round(s.alignmentFraction * 100)}% (${s.alignedTimeSec}s), top target: ${escapeHtml(s.topFocusTarget ?? '—')}, healer pressure: ${s.healerPressureDamage}</p>${attackerFocusRows(s.attackerFocus)}`;
  }).join('');
}
```

(`CoordinationSummary` is already imported on line 2; no import change needed.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/renderReport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/view/renderMetrics.ts test/renderReport.test.ts
git commit -m "feat(view): coordination line with swaps/alignment + per-attacker focus detail"
```

---

## Task 8: Export focus tracks into the replay JSON

**Files:**
- Modify: `src/cli/view.ts`

The retained per-player dominant-target segments should ride along into the `--replay` JSON so the future replay viewer and offline analysis can use them.

- [ ] **Step 1: Add focus segments to the replay payload**

In `src/cli/view.ts`, inside the `--replay` block, extend the per-match JSON written for each view. Replace the `writeFileSync(join(replayDir, ...))` line (line 40) with:

```ts
      const focus = v.metrics.focusTracks.tracks.map((t) => ({ attacker: t.attacker, attackerName: t.attackerName, team: t.team, segments: t.segments }));
      writeFileSync(join(replayDir, `match-${i}.json`), JSON.stringify({ playerUnitId: v.metrics.playerUnitId, timeline: v.metrics.timeline, tracks, focus }));
```

- [ ] **Step 2: Verify it compiles and runs**

Run: `npx tsc --noEmit`
Expected: No errors.

(There is no unit test for the CLI; it is exercised by the smoke run in Task 9.)

- [ ] **Step 3: Commit**

```bash
git add src/cli/view.ts
git commit -m "feat(view): include per-player focus segments in replay JSON export"
```

---

## Task 9: Full-suite green + real-data smoke check

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: All tests pass (previous 51 + the new targeting/coordination/absorb tests; the discovery-only console logs are gone). If anything is red, fix it before proceeding.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: No errors. (Confirms no stale reference to `focusFireWindows` or the old summary shape remains anywhere.)

- [ ] **Step 3: Regenerate the report on a real log and eyeball the numbers**

Run: `npm run view -- "D:/WoW_Arena_Coach/sample_data/logs/WoWCombatLog-052926_235715.txt"`
Expected: `Wrote report: …output/report.html (… matches …)`. Open the report and confirm the coordination line now reads `swaps: N, alignment: XX% (Ns), …` with **N a believable per-match number** (single/low-double digits per team, not 150+/747). If swaps are still implausibly high, STOP and report the actual values — the dwell/window constants may need tuning in `targeting.ts` (`DWELL_MS`/`WINDOW_MS`) before this is considered done.

- [ ] **Step 4: No commit** (verification task; report.html is git-ignored).

---

## Plan self-review notes

- **Spec coverage:** §2 engine → Task 2; §2.1 pet-rolling/allowlist/enemy-dest → Task 2 `attackerOf`/filter; §2.2 grid+window+hysteresis → Task 2 inner loop; §2.3 debounce → Task 2 `debounce`; §2.4 RLE → Task 2 `encodeSegments`; §3 derived metrics (swaps/attackerFocus/alignment, kept targetPriority/healerPressure) → Task 3; §3.1 types → Task 1; retained `MatchMetrics.focusTracks` → Tasks 1 + 4; §4 absorbInfo + absorbDone → Tasks 5 + 6; §5 report → Task 7; replay export (§6 view.ts) → Task 8; §8 tests → distributed; golden swap-sanity bound → Task 4 / Task 9.
- **Type consistency:** `AttackerFocus`/`FocusTracks`/`AttackerTrack`/`FocusSegment`/`CoordinationSummary` field names are used identically in Tasks 1, 3, 4, 7, 8. `computeFocusTracks(match, opts)` and `computeCoordination(match, healerSpecIds, tracks?)` signatures are consistent across Tasks 2–4.
- **Known discovery risk (called out, not a placeholder):** the exact `SPELL_ABSORBED` field layout is established by the Task 5 Step 1 discovery against the real fixture (the same TDD-discovery method the whole `eventAccess.ts` was built with); Tasks 5 Step 3 and Task 6 Step 1 instruct mirroring the discovered layout. If the fixture has no SPELL_ABSORBED event, the absorb portion is reported and deferred rather than shipped unverified.
