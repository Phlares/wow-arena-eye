# Positioning / Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 2D spatial foundation of GO analysis — a mobility-aware, queryable position-track store for every player, the generic distance-at-any-moment primitive, passive-target gap-filling, pairwise distance bands, and a per-offensive-window positioning record.

**Architecture:** A curated metadata table (`repositioning.ts`) seeds mobility/anchor abilities. A core module (`positionTracks.ts`) builds the enriched per-unit track store (observed + inferred samples + mobility breaks) and exposes the distance primitive. An analytics module (`spacing.ts`) derives the per-player spacing summary, distance bands, and per-window positioning. `metrics.ts` wires these in non-invasively; `computeUnitMetrics` and `offensiveWindows.ts` are NOT modified. Render and the `--replay` export surface the new data.

**Tech Stack:** TypeScript/ESM (NodeNext — local imports use `.js`), Node ≥22, Vitest, tsx. Test one file: `npx vitest run test/<file>.test.ts`. Type-check: `npx tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-06-02-positioning-spacing-design.md`

**Key existing facts (do not rediscover):**
- `eventAccess.position(ev)` → `{ x, y, facing? } | undefined` is the **actor (source)** position; `{0,0}` treated as absent. `SWING_DAMAGE` / `SWING_DAMAGE_LANDED` carry advanced actor position (parser offset 8).
- `eventAccess.matchStartMs(events)` → epoch ms of the first timestamped event (the `t=0` reference). `eventTimeMs`, `srcId`, `destId`, `spellId`, `eventType` are the other accessors.
- `Sample` (in `types.ts`) = `{ tSec, x, y, facing?, hpPct? }`. `tSec` is **seconds since matchStart**. `UnitMetrics.track: Sample[]` is the per-unit **observed** track, already sorted ascending by `tSec` (built in `perUnit.ts`).
- `cooldownTimeline.collectCasts(match)` → `Map<unitId, {spellId,name,ms}[]>` (ms ascending). `isAvailable(castMs: number[], cooldownMs, maxCharges, atMs) → boolean`.
- `offensiveWindows.computeOffensiveWindows(match, units: UnitMetrics[], auras, casts)` → `OffensiveWindow[]`; each window already has `startSec`/`endSec` (seconds), `attackingTeam`/`defendingTeam`, and `damageByTarget` sorted **descending** by damage (so `damageByTarget[0]` is the primary target).
- `registry.HEALER_SPEC_IDS: string[]` identifies healer specs; `UnitMetrics.spec` is the spec id string.

**Constants (define in the module that owns them; reuse by import):**
`MAX_GAP_SEC = 3`, `PRE_CAST_VALID_SEC = 0.5`, `LAST_KNOWN_N = 3` (in `positionTracks.ts`); `STEP_MS = 500`, `MELEE_YD = 8`, `HEAL_RANGE_YD = 40` (in `spacing.ts`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/metadata/repositioning.ts` (new) | Curated `MOBILITY_ABILITIES` set + `ANCHOR_ABILITIES` map; `isMobility`, `anchorInfo`. |
| `src/metrics/positionTracks.ts` (new) | `PositionTrack` store builder + the distance primitive (`resolvePosition`/`positionAt`/`distanceAt`). |
| `src/metrics/spacing.ts` (new) | `attachSpacing` (per-player summary), `computeDistanceBands`, `collectAnchors` + `addWindowPositioning`. |
| `src/metrics/types.ts` (modify) | `Sample.inferred?`; new `PositionTrack`/`PositionQuery`/`SpacingSummary`/`WindowPositioning`/`DistanceBandRow`; field additions to `UnitMetrics`/`OffensiveWindow`/`MatchMetrics`. |
| `src/metrics/metrics.ts` (modify) | Wire the three new computations into `computeMatchMetrics`. |
| `src/view/renderMetrics.ts` (modify) | Per-window positioning cell + per-unit spacing in the move cell. |
| `src/cli/view.ts` (modify) | Add `positionTracks` + `distanceBands` to the `--replay` JSON. |

---

## Task 1: Types foundation

**Files:**
- Modify: `src/metrics/types.ts`
- Modify (required-field stubs): `src/metrics/perUnit.ts`, `src/metrics/metrics.ts`
- Modify (fixtures): `test/renderReport.test.ts`, `test/metrics.test.ts`

> **Why the stubs:** `spacing` (on `UnitMetrics`) and `positionTracks`/`distanceBands` (on `MatchMetrics`) are *required* fields, but `UnitMetrics` is constructed in `perUnit.ts` and `MatchMetrics` in `metrics.ts`. To keep `tsc` green until the real computations land (Tasks 7–10), this task adds zero/empty **stubs** in those two files. They are overwritten later (`attachSpacing` replaces the spacing stub; Task 10 replaces the metrics stubs). The stub in `perUnit.ts` is the ONLY change to that file in this whole plan and it does NOT compute anything.

- [ ] **Step 1: Add the new types and field additions to `src/metrics/types.ts`**

Add `inferred?` to the existing `Sample` interface (line ~6):

```ts
export interface Sample { tSec: number; x: number; y: number; facing?: number; hpPct?: number; inferred?: boolean; }
```

Add these new interfaces (place them just after `Sample`):

```ts
/** A unit's enriched position time series: observed + inferred samples (sorted by tSec),
 *  plus mobility-cast break times (tSec) where interpolation must not cross a teleport. */
export interface PositionTrack { unitId: string; samples: Sample[]; breaks: number[]; }

/** Result of a position query. `position` is undefined when genuinely unknowable
 *  (mid-teleport, beyond MAX_GAP_SEC of any sample); `lastKnown` always carries up to
 *  the 3 most recent real samples (with timestamps) so inference can decide for itself. */
export interface PositionQuery { position?: Sample; inferred: boolean; lastKnown: Sample[]; }

/** Per-player whole-match spacing summary (derived; raw tracks remain on MatchMetrics). */
export interface SpacingSummary { meleeRangeSec: number; isolatedSec: number; }

/** Escape-anchor state for a window's primary target (e.g. Demon Circle). */
export interface WindowEscape { anchorPlaced: boolean; anchorDistanceYd?: number; escapeAvailable: boolean; }

/** Spatial context of one offensive window, computed for its primary target. All
 *  distances in yards; undefined when positions are unresolvable. */
export interface WindowPositioning {
  primaryTargetId: string;
  threatDistanceStartYd?: number;
  threatDistanceMinYd?: number;
  nearestHealerYd?: number;
  teamSpreadYd?: number;
  escape?: WindowEscape;
}

/** Fraction of sampled time one player pair spent in each distance band. Fractions are
 *  over `sampledSec` (resolved ticks only) so gaps never inflate a band. */
export interface DistanceBandRow {
  aId: string; bId: string;
  b0_5: number; b5_25: number; b25_40: number; b40plus: number;
  sampledSec: number;
}
```

Add `spacing` to `UnitMetrics` (after the `track: Sample[];` line):

```ts
  spacing: SpacingSummary;
```

Add `positioning?` to `OffensiveWindow` (after `counterPlay: WindowCounterPlay;`):

```ts
  positioning?: WindowPositioning;
```

Add the two arrays to `MatchMetrics` (extend the interface):

```ts
export interface MatchMetrics { teams: TeamGroup[]; timeline: TimelineEvent[]; playerUnitId?: string; coordination: { team: Team; summary: CoordinationSummary }[]; focusTracks: FocusTracks; offensiveWindows: OffensiveWindow[]; positionTracks: PositionTrack[]; distanceBands: DistanceBandRow[]; }
```

- [ ] **Step 2: Run tsc to confirm the build now fails to type-check (RED)**

Run: `npx tsc --noEmit`
Expected: errors in `src/metrics/perUnit.ts` (the `result.push({...})` object is missing `spacing`), `src/metrics/metrics.ts` (the return object is missing `positionTracks`/`distanceBands`), and `test/renderReport.test.ts` (inline `UnitMetrics` lack `spacing`; inline `MatchMetrics` lacks the two arrays).

- [ ] **Step 3: Add the `spacing` stub in `src/metrics/perUnit.ts`**

In the `result.push({ ... })` object (around line 189), add one line alongside the other fields (e.g. right after `track,`):

```ts
      spacing: { meleeRangeSec: 0, isolatedSec: 0 },
```

This zero stub is overwritten by `attachSpacing` (Task 7) once it runs in the pipeline (Task 10). `perUnit.ts` is not modified again.

- [ ] **Step 4: Add the `positionTracks`/`distanceBands` stubs in `src/metrics/metrics.ts`**

In the `computeMatchMetrics` return object, add the two empty arrays alongside `offensiveWindows`:

```ts
    offensiveWindows: computeOffensiveWindows(match, units, auras, casts),
    positionTracks: [],
    distanceBands: [],
    playerUnitId,
```

(Task 10 replaces these with the real values.)

- [ ] **Step 5: Update the `test/renderReport.test.ts` fixtures**

The two inline `UnitMetrics` objects (the `player: { ... }` at ~line 107 and the pet at ~line 121): add `spacing: { meleeRangeSec: 0, isolatedSec: 0 },` immediately after their `track: [],` line.

The inline `MatchMetrics` object (begins ~line 94): add `positionTracks: [], distanceBands: [],` alongside `offensiveWindows: []`.

- [ ] **Step 6: Update `test/metrics.test.ts` if it has inline `MatchMetrics`/`UnitMetrics` fixtures or asserts the shape**

Open `test/metrics.test.ts`. If it builds an inline `MatchMetrics` literal, add `positionTracks: []` and `distanceBands: []` (and `spacing` on any inline `UnitMetrics`). If it only calls `computeMatchMetrics(...)` on a fixture, no change is required here (the positioning assertions are added in Task 10).

- [ ] **Step 7: Run tsc and the full suite to confirm GREEN**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run`
Expected: all existing tests pass (no behavior changed yet — stubs are empty/zero).

- [ ] **Step 8: Commit**

```bash
git add src/metrics/types.ts src/metrics/perUnit.ts src/metrics/metrics.ts test/renderReport.test.ts test/metrics.test.ts
git commit -m "feat: positioning types + required-field stubs (PositionTrack/SpacingSummary/WindowPositioning/DistanceBandRow)"
```

---

## Task 2: Repositioning metadata (mobility + anchor abilities)

**Files:**
- Create: `src/metadata/repositioning.ts`
- Test: `test/repositioning.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isMobility, anchorInfo, MOBILITY_ABILITIES, ANCHOR_ABILITIES } from '../src/metadata/repositioning.js';

describe('repositioning metadata', () => {
  it('flags seeded mobility abilities', () => {
    expect(isMobility(1953)).toBe(true);   // Blink
    expect(isMobility(48020)).toBe(true);  // Demonic Circle: Teleport
    expect(isMobility(8936)).toBe(false);  // Regrowth (not mobility)
    expect(isMobility(undefined)).toBe(false);
    expect(MOBILITY_ABILITIES.size).toBeGreaterThanOrEqual(5);
  });

  it('resolves Demon Circle as an anchor ability with its return spell + cooldown', () => {
    const a = anchorInfo(48018); // Summon Demonic Circle
    expect(a).toBeDefined();
    expect(a!.returnSpellId).toBe(48020);
    expect(a!.returnCooldownMs).toBe(30_000);
    expect(anchorInfo(1953)).toBeUndefined();
    expect(ANCHOR_ABILITIES.has(48018)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/repositioning.test.ts`
Expected: FAIL — cannot find module `../src/metadata/repositioning.js`.

- [ ] **Step 3: Create `src/metadata/repositioning.ts`**

```ts
/** Curated positional-ability metadata. Small, hand-maintained, refreshed per patch like
 *  spells.curated.json. NOT generated. */

export interface AnchorAbility { name: string; returnSpellId: number; returnCooldownMs: number; }

/** Abilities that INSTANTLY relocate the caster — interpolation must not smear across them
 *  (a teleport between two samples is a jump, not a glide). Seeded with the common ones;
 *  extend per spec/class as needed. */
export const MOBILITY_ABILITIES: Set<number> = new Set([
  48020, // Demonic Circle: Teleport (Warlock)
  36554, // Shadowstep (Rogue)
  1953,  // Blink (Mage)
  6544,  // Heroic Leap (Warrior)
  781,   // Disengage (Hunter)
]);

/** Anchor-placing abilities: casting places a fixed return point; a paired ability teleports
 *  the caster back to it. Keyed by the PLACEMENT spell id. Seeded with Demon Circle. */
export const ANCHOR_ABILITIES: Map<number, AnchorAbility> = new Map([
  [48018, { name: 'Demonic Circle', returnSpellId: 48020, returnCooldownMs: 30_000 }],
]);

export function isMobility(spellId: number | undefined): boolean {
  return spellId !== undefined && MOBILITY_ABILITIES.has(spellId);
}

export function anchorInfo(spellId: number | undefined): AnchorAbility | undefined {
  return spellId === undefined ? undefined : ANCHOR_ABILITIES.get(spellId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/repositioning.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/metadata/repositioning.ts test/repositioning.test.ts
git commit -m "feat: curated mobility + anchor ability metadata (repositioning.ts)"
```

---

## Task 3: Distance primitive — base (gap guard, endpoints, lastKnown, lerp)

**Files:**
- Create: `src/metrics/positionTracks.ts`
- Test: `test/positionTracks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolvePosition, positionAt, distanceAt, MAX_GAP_SEC } from '../src/metrics/positionTracks.js';
import type { PositionTrack } from '../src/metrics/types.js';

const track = (samples: PositionTrack['samples'], breaks: number[] = []): PositionTrack =>
  ({ unitId: 'U', samples, breaks });

describe('distance primitive (base)', () => {
  it('lerps between bracketing samples', () => {
    const t = track([{ tSec: 0, x: 0, y: 0 }, { tSec: 2, x: 10, y: 0 }]);
    expect(positionAt(t, 1)!.x).toBeCloseTo(5);
  });

  it('returns undefined when no real sample is within MAX_GAP_SEC', () => {
    const t = track([{ tSec: 0, x: 0, y: 0 }, { tSec: 100, x: 0, y: 0 }]);
    // query at 50: bracketing gap (100s) far exceeds MAX_GAP_SEC
    expect(resolvePosition(t, 50).position).toBeUndefined();
    expect(MAX_GAP_SEC).toBe(3);
  });

  it('clamps to an endpoint only within MAX_GAP_SEC', () => {
    const t = track([{ tSec: 10, x: 5, y: 5 }]);
    expect(positionAt(t, 11)!.x).toBe(5);          // 1s after last → held
    expect(positionAt(t, 20)).toBeUndefined();     // 10s after last → unknown
    expect(positionAt(t, 8)!.x).toBe(5);           // 2s before first → held
  });

  it('returns up to 3 most-recent real samples with timestamps on an unresolved query', () => {
    const t = track([{ tSec: 0, x: 0, y: 0 }, { tSec: 1, x: 1, y: 0 }, { tSec: 2, x: 2, y: 0 }, { tSec: 3, x: 3, y: 0 }, { tSec: 100, x: 9, y: 9 }]);
    const q = resolvePosition(t, 50);
    expect(q.position).toBeUndefined();
    expect(q.lastKnown.map((s) => s.tSec)).toEqual([3, 2, 1]); // most-recent-first, ≤ query, capped at 3
  });

  it('computes 2D Euclidean distance in yards; undefined if either side unresolved', () => {
    const a = track([{ tSec: 0, x: 0, y: 0 }, { tSec: 2, x: 0, y: 0 }]);
    const b = track([{ tSec: 0, x: 3, y: 4 }, { tSec: 2, x: 3, y: 4 }]);
    expect(distanceAt(a, b, 1)).toBeCloseTo(5);
    const empty = track([]);
    expect(distanceAt(a, empty, 1)).toBeUndefined();
  });

  it('marks inferred when a contributing sample is inferred', () => {
    const t = track([{ tSec: 0, x: 0, y: 0, inferred: true }, { tSec: 2, x: 10, y: 0 }]);
    expect(resolvePosition(t, 1).inferred).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/positionTracks.test.ts`
Expected: FAIL — cannot find module `../src/metrics/positionTracks.js`.

- [ ] **Step 3: Create `src/metrics/positionTracks.ts` with the base primitive**

```ts
import type { Sample, PositionTrack, PositionQuery } from './types.js';

export const MAX_GAP_SEC = 3;
export const PRE_CAST_VALID_SEC = 0.5;
export const LAST_KNOWN_N = 3;

/** Up to LAST_KNOWN_N real samples with tSec ≤ t, most-recent-first. */
function lastKnownBefore(samples: Sample[], t: number): Sample[] {
  const out: Sample[] = [];
  for (let i = samples.length - 1; i >= 0 && out.length < LAST_KNOWN_N; i--) {
    if (samples[i].tSec <= t) out.push(samples[i]);
  }
  return out;
}

/** Resolve a unit's position at tSec, honest about uncertainty (see PositionQuery). */
export function resolvePosition(track: PositionTrack, tSec: number): PositionQuery {
  const s = track.samples;
  const lastKnown = lastKnownBefore(s, tSec);
  if (s.length === 0) return { position: undefined, inferred: false, lastKnown };

  // Before first / after last: clamp to the endpoint only within MAX_GAP_SEC.
  if (tSec <= s[0].tSec) {
    const ok = s[0].tSec - tSec <= MAX_GAP_SEC;
    return { position: ok ? { ...s[0], tSec } : undefined, inferred: ok ? !!s[0].inferred : false, lastKnown };
  }
  const last = s[s.length - 1];
  if (tSec >= last.tSec) {
    const ok = tSec - last.tSec <= MAX_GAP_SEC;
    return { position: ok ? { ...last, tSec } : undefined, inferred: ok ? !!last.inferred : false, lastKnown };
  }

  // Bracket: greatest sample ≤ tSec at index lo, next sample at lo+1.
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid].tSec <= tSec) lo = mid; else hi = mid - 1; }
  const a = s[lo];
  const b = s[lo + 1] ?? a;
  if (a.tSec === b.tSec) return { position: { ...a, tSec }, inferred: !!a.inferred, lastKnown };

  // (mobility break handling is inserted here in Task 4)

  if (b.tSec - a.tSec > MAX_GAP_SEC) return { position: undefined, inferred: false, lastKnown };
  const f = (tSec - a.tSec) / (b.tSec - a.tSec);
  const position: Sample = { tSec, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, facing: a.facing, hpPct: a.hpPct };
  return { position, inferred: !!a.inferred || !!b.inferred, lastKnown };
}

/** Convenience: just the resolved Sample (or undefined). */
export function positionAt(track: PositionTrack, tSec: number): Sample | undefined {
  return resolvePosition(track, tSec).position;
}

/** 2D Euclidean distance in yards between two units at tSec; undefined if either unresolved. */
export function distanceAt(a: PositionTrack, b: PositionTrack, tSec: number): number | undefined {
  const pa = resolvePosition(a, tSec).position;
  const pb = resolvePosition(b, tSec).position;
  if (!pa || !pb) return undefined;
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/positionTracks.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/positionTracks.ts test/positionTracks.test.ts
git commit -m "feat: distance primitive (resolvePosition/positionAt/distanceAt) with gap guard + lastKnown"
```

---

## Task 4: Mobility-aware interpolation (split at teleport casts)

**Files:**
- Modify: `src/metrics/positionTracks.ts`
- Test: `test/positionTracks.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test (append to `test/positionTracks.test.ts`)**

```ts
import { PRE_CAST_VALID_SEC } from '../src/metrics/positionTracks.js'; // already importable; ensure imported once at top

describe('mobility-aware interpolation', () => {
  // Sample at 0 (x=0) and at 4 (x=100). A teleport cast (break) at t=2.
  // Without break handling this would lerp to x≈50 at t=3; with it, it must NOT.
  const t = { unitId: 'U', samples: [{ tSec: 0, x: 0, y: 0 }, { tSec: 4, x: 100, y: 0 }], breaks: [2] };

  it('does not lerp across a teleport break', () => {
    // valid pre-cast region: up to 2 - 0.5 = 1.5s → holds the pre-sample (x=0)
    expect(positionAt(t, 1.4)!.x).toBe(0);
    expect(PRE_CAST_VALID_SEC).toBe(0.5);
  });

  it('returns undefined during the transit gap (after Tc-0.5, before the landing sample)', () => {
    expect(positionAt(t, 1.6)).toBeUndefined(); // inside transit
    expect(positionAt(t, 3.5)).toBeUndefined(); // still before landing sample at 4
  });

  it('resolves normally once past the landing sample (no break in the new bracket)', () => {
    const t2 = { unitId: 'U', samples: [{ tSec: 0, x: 0, y: 0 }, { tSec: 4, x: 100, y: 0 }, { tSec: 6, x: 120, y: 0 }], breaks: [2] };
    expect(positionAt(t2, 5)!.x).toBeCloseTo(110); // bracket [4,6], no break between → lerp
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/positionTracks.test.ts`
Expected: FAIL — `positionAt(t, 1.4)` returns ≈35 (lerped) instead of 0; transit queries return lerped values instead of undefined.

- [ ] **Step 3: Insert the break-handling block in `resolvePosition`**

Replace the placeholder comment `// (mobility break handling is inserted here in Task 4)` with:

```ts
  // Mobility break inside the current bracket → never lerp across the teleport.
  const tb = track.breaks.find((bk) => bk > a.tSec && bk < b.tSec);
  if (tb !== undefined) {
    if (tSec <= tb - PRE_CAST_VALID_SEC) {
      // pre-cast: hold the last observed pre-sample, still subject to the gap guard
      const ok = tSec - a.tSec <= MAX_GAP_SEC;
      return { position: ok ? { x: a.x, y: a.y, tSec, facing: a.facing, hpPct: a.hpPct } : undefined, inferred: ok ? !!a.inferred : false, lastKnown };
    }
    // transit (Tc-0.5 .. landing sample b): genuinely unknown
    return { position: undefined, inferred: false, lastKnown };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/positionTracks.test.ts`
Expected: PASS (all base + mobility tests).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/positionTracks.ts test/positionTracks.test.ts
git commit -m "feat: mobility-aware interpolation (split at teleport casts, transit unknown)"
```

---

## Task 5: buildPositionTracks — observed samples + mobility breaks

**Files:**
- Modify: `src/metrics/positionTracks.ts`
- Test: `test/buildPositionTracks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildPositionTracks } from '../src/metrics/positionTracks.js';
import type { UnitMetrics } from '../src/metrics/types.js';

function unit(over: Partial<UnitMetrics>): UnitMetrics {
  return { unitId: 'U', name: 'U', kind: 'player', team: 'friendly', track: [], spacing: { meleeRangeSec: 0, isolatedSec: 0 } } as unknown as UnitMetrics;
}

describe('buildPositionTracks', () => {
  it('copies observed tracks and records mobility-cast breaks in tSec', () => {
    const units: UnitMetrics[] = [{ ...unit({}), unitId: 'P', track: [{ tSec: 0, x: 0, y: 0 }, { tSec: 5, x: 9, y: 0 }] } as unknown as UnitMetrics];
    // matchStart = 1000 (first event timestamp). Blink (1953) cast at ms 3000 → tSec (3000-1000)/1000 = 2.
    const match = {
      events: [
        { timestamp: 1000 },
        { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'P', spellId: '1953', timestamp: 3000 },
      ],
    };
    const tracks = buildPositionTracks(units, match);
    const tr = tracks.get('P')!;
    expect(tr.samples).toHaveLength(2);          // observed copied
    expect(tr.breaks).toEqual([2]);              // mobility break at tSec 2
    expect(units[0].track).toHaveLength(2);      // original untouched
  });

  it('ignores non-mobility casts', () => {
    const units: UnitMetrics[] = [{ ...unit({}), unitId: 'P', track: [{ tSec: 0, x: 0, y: 0 }] } as unknown as UnitMetrics];
    const match = { events: [{ timestamp: 0 }, { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'P', spellId: '8936', timestamp: 2000 }] };
    expect(buildPositionTracks(units, match).get('P')!.breaks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/buildPositionTracks.test.ts`
Expected: FAIL — `buildPositionTracks` is not exported.

- [ ] **Step 3: Add `buildPositionTracks` to `src/metrics/positionTracks.ts`**

Add these imports at the top of the file:

```ts
import { matchStartMs } from './eventAccess.js';
import { collectCasts } from './cooldownTimeline.js';
import { isMobility } from '../metadata/repositioning.js';
import type { UnitMetrics } from './types.js';
```

Append the function:

```ts
/** Build the enriched position-track store: each unit's OBSERVED samples (copied, not mutated)
 *  plus mobility-cast break times (tSec). Inferred samples are added in a later step. */
export function buildPositionTracks(units: UnitMetrics[], match: unknown): Map<string, PositionTrack> {
  const m = match as { events?: unknown[] };
  const events = Array.isArray(m.events) ? m.events : [];
  const startMs = matchStartMs(events) ?? 0;

  const tracks = new Map<string, PositionTrack>();
  for (const u of units) {
    tracks.set(u.unitId, { unitId: u.unitId, samples: u.track.map((s) => ({ ...s })), breaks: [] });
  }

  for (const [uid, list] of collectCasts(match)) {
    const tr = tracks.get(uid);
    if (!tr) continue;
    for (const c of list) if (isMobility(c.spellId)) tr.breaks.push((c.ms - startMs) / 1000);
  }

  for (const tr of tracks.values()) tr.breaks.sort((x, y) => x - y);
  return tracks;
}
```

(`PositionTrack` is already imported via the `types.js` import added in Task 3 — confirm the top import reads `import type { Sample, PositionTrack, PositionQuery } from './types.js';` and extend it to also import `UnitMetrics` if you prefer a single import line.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/buildPositionTracks.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/positionTracks.ts test/buildPositionTracks.test.ts
git commit -m "feat: buildPositionTracks (observed samples + mobility breaks)"
```

---

## Task 6: Passive-target gap-filling (inferred melee samples)

**Files:**
- Modify: `src/metrics/positionTracks.ts`
- Test: `test/buildPositionTracks.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test (append to `test/buildPositionTracks.test.ts`)**

```ts
describe('buildPositionTracks — passive-target gap-filling', () => {
  it('injects an inferred sample at the attacker position when a melee swing hits a target', () => {
    // Target T has no observed samples of its own; attacker A melee-swings it.
    // SWING_DAMAGE carries the ATTACKER's actor position (advancedActorPositionX/Y).
    const units: UnitMetrics[] = [
      { ...unit({}), unitId: 'T', team: 'enemy', track: [] } as unknown as UnitMetrics,
      { ...unit({}), unitId: 'A', team: 'friendly', track: [{ tSec: 0, x: 50, y: 50 }] } as unknown as UnitMetrics,
    ];
    const match = {
      events: [
        { timestamp: 0 },
        { event: 'SWING_DAMAGE', srcUnitId: 'A', destUnitId: 'T', advancedActorPositionX: 50, advancedActorPositionY: 50, amount: 1000, timestamp: 2000 },
      ],
    };
    const tr = buildPositionTracks(units, match).get('T')!;
    expect(tr.samples).toHaveLength(1);
    expect(tr.samples[0]).toMatchObject({ tSec: 2, x: 50, y: 50, inferred: true });
    // observed track of T is unchanged (still empty)
    expect(units[0].track).toHaveLength(0);
  });

  it('keeps samples sorted after injecting inferred ones', () => {
    const units: UnitMetrics[] = [
      { ...unit({}), unitId: 'T', team: 'enemy', track: [{ tSec: 0, x: 1, y: 1 }, { tSec: 4, x: 2, y: 2 }] } as unknown as UnitMetrics,
      { ...unit({}), unitId: 'A', team: 'friendly', track: [] } as unknown as UnitMetrics,
    ];
    const match = { events: [{ timestamp: 0 }, { event: 'SWING_DAMAGE_LANDED', srcUnitId: 'A', destUnitId: 'T', advancedActorPositionX: 9, advancedActorPositionY: 9, amount: 5, timestamp: 2000 }] };
    const tr = buildPositionTracks(units, match).get('T')!;
    expect(tr.samples.map((s) => s.tSec)).toEqual([0, 2, 4]); // inferred (tSec 2) slotted in order
    expect(tr.samples[1].inferred).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/buildPositionTracks.test.ts`
Expected: FAIL — `T` has no samples (inferred injection not implemented).

- [ ] **Step 3: Add inferred-sample injection to `buildPositionTracks`**

Extend the imports at the top of `positionTracks.ts`:

```ts
import { matchStartMs, eventType, destId, eventTimeMs, position } from './eventAccess.js';
```

In `buildPositionTracks`, **after** the mobility-break loop and **before** the final `breaks.sort` loop, insert the inferred-sample pass, then sort both samples and breaks:

```ts
  // Passive-target gap-filling: a melee swing on a unit constrains it to ≈ the attacker's
  // position. position(ev) is the attacker's (actor) position; attribute it to the target,
  // tagged inferred so it is never confused with an observed sample.
  for (const ev of events) {
    const t = eventType(ev);
    if (t !== 'SWING_DAMAGE' && t !== 'SWING_DAMAGE_LANDED') continue;
    const d = destId(ev);
    const ms = eventTimeMs(ev);
    const p = position(ev);
    if (!d || ms === undefined || !p) continue;
    const tr = tracks.get(d);
    if (!tr) continue;
    tr.samples.push({ tSec: (ms - startMs) / 1000, x: p.x, y: p.y, inferred: true });
  }

  for (const tr of tracks.values()) {
    tr.samples.sort((x, y) => x.tSec - y.tSec);
    tr.breaks.sort((x, y) => x - y);
  }
  return tracks;
```

Remove the now-duplicated standalone `for (const tr of tracks.values()) tr.breaks.sort(...)` line from Task 5 (the combined loop above replaces it).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/buildPositionTracks.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/positionTracks.ts test/buildPositionTracks.test.ts
git commit -m "feat: passive-target gap-filling (inferred melee-interaction samples)"
```

---

## Task 7: Per-player spacing summary (attachSpacing)

**Files:**
- Create: `src/metrics/spacing.ts`
- Test: `test/spacing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { attachSpacing, MELEE_YD, HEAL_RANGE_YD } from '../src/metrics/spacing.js';
import type { UnitMetrics, PositionTrack, Sample } from '../src/metrics/types.js';

// Dense (1s-apart) "standing still at (x,y)" track over 0..durSec, so every queried tick is
// within MAX_GAP_SEC (3s) of a real sample and resolves. Sparse samples would (correctly) be
// dropped by the gap guard — keep fixtures dense.
const still = (x: number, y: number, durSec = 20): Sample[] =>
  Array.from({ length: durSec + 1 }, (_, i) => ({ tSec: i, x, y }));

function unit(unitId: string, team: 'friendly' | 'enemy', track: Sample[]): UnitMetrics {
  return { unitId, name: unitId, kind: 'player', team, track, spacing: { meleeRangeSec: 0, isolatedSec: 0 } } as unknown as UnitMetrics;
}
const trackOf = (u: UnitMetrics): [string, PositionTrack] => [u.unitId, { unitId: u.unitId, samples: u.track, breaks: [] }];

describe('attachSpacing', () => {
  it('counts time within melee range of an enemy', () => {
    // P stands at origin for 20s; enemy E is 3yd away (within MELEE_YD=8) the whole time.
    const P = unit('P', 'friendly', still(0, 0));
    const E = unit('E', 'enemy', still(3, 0));
    const out = attachSpacing([P, E], new Map([trackOf(P), trackOf(E)]));
    const p = out.find((u) => u.unitId === 'P')!;
    expect(p.spacing.meleeRangeSec).toBeGreaterThan(9); // ~20s in melee
    expect(MELEE_YD).toBe(8);
  });

  it('counts time isolated from allies (nearest ally beyond HEAL_RANGE_YD)', () => {
    // P at origin; ally Q is 60yd away (> 40) the whole time → isolated.
    const P = unit('P', 'friendly', still(0, 0));
    const Q = unit('Q', 'friendly', still(60, 0));
    const p = attachSpacing([P, Q], new Map([trackOf(P), trackOf(Q)])).find((u) => u.unitId === 'P')!;
    expect(p.spacing.isolatedSec).toBeGreaterThan(9);
    expect(HEAL_RANGE_YD).toBe(40);
  });

  it('gives non-player units a zero summary', () => {
    const pet = { unitId: 'PET', name: 'PET', kind: 'primary-pet', team: 'friendly', track: [], spacing: { meleeRangeSec: 0, isolatedSec: 0 } } as unknown as UnitMetrics;
    const out = attachSpacing([pet], new Map());
    expect(out[0].spacing).toEqual({ meleeRangeSec: 0, isolatedSec: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spacing.test.ts`
Expected: FAIL — cannot find module `../src/metrics/spacing.js`.

- [ ] **Step 3: Create `src/metrics/spacing.ts`**

```ts
import type { UnitMetrics, PositionTrack, SpacingSummary } from './types.js';
import { distanceAt, resolvePosition } from './positionTracks.js';

export const STEP_MS = 500;
export const MELEE_YD = 8;
export const HEAL_RANGE_YD = 40;

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Nearest resolved distance from `self` to any of `others` at tSec, or undefined. */
function nearest(self: PositionTrack, others: PositionTrack[], t: number): number | undefined {
  let min: number | undefined;
  for (const o of others) {
    const d = distanceAt(self, o, t);
    if (d !== undefined && (min === undefined || d < min)) min = d;
  }
  return min;
}

function spacingFor(u: UnitMetrics, players: UnitMetrics[], tracks: Map<string, PositionTrack>): SpacingSummary {
  const self = tracks.get(u.unitId);
  if (!self || self.samples.length === 0) return { meleeRangeSec: 0, isolatedSec: 0 };
  const trackOf = (p: UnitMetrics) => tracks.get(p.unitId);
  const keep = (t: PositionTrack | undefined): t is PositionTrack => !!t;
  const enemies = players.filter((p) => p.team !== u.team && p.unitId !== u.unitId).map(trackOf).filter(keep);
  const allies = players.filter((p) => p.team === u.team && p.unitId !== u.unitId).map(trackOf).filter(keep);

  const stepSec = STEP_MS / 1000;
  const startT = self.samples[0].tSec;
  const endT = self.samples[self.samples.length - 1].tSec;
  let meleeRangeSec = 0;
  let isolatedSec = 0;
  for (let t = startT; t <= endT; t += stepSec) {
    if (!resolvePosition(self, t).position) continue;
    const ne = nearest(self, enemies, t);
    if (ne !== undefined && ne <= MELEE_YD) meleeRangeSec += stepSec;
    const na = nearest(self, allies, t);
    if (na !== undefined && na > HEAL_RANGE_YD) isolatedSec += stepSec;
  }
  return { meleeRangeSec: round1(meleeRangeSec), isolatedSec: round1(isolatedSec) };
}

/** Return a copy of `units` with `spacing` filled per player (non-players get a zero summary). */
export function attachSpacing(units: UnitMetrics[], tracks: Map<string, PositionTrack>): UnitMetrics[] {
  const players = units.filter((u) => u.kind === 'player');
  return units.map((u) => ({
    ...u,
    spacing: u.kind === 'player' ? spacingFor(u, players, tracks) : { meleeRangeSec: 0, isolatedSec: 0 },
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/spacing.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/spacing.ts test/spacing.test.ts
git commit -m "feat: per-player spacing summary (meleeRangeSec/isolatedSec)"
```

---

## Task 8: Pairwise distance bands (computeDistanceBands)

**Files:**
- Modify: `src/metrics/spacing.ts`
- Test: `test/spacing.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test (append to `test/spacing.test.ts`)**

```ts
import { computeDistanceBands } from '../src/metrics/spacing.js';

// `unit`, `still`, and `trackOf` are defined at the top of this file (Task 7).

describe('computeDistanceBands', () => {
  it('classifies a constant-distance pair into one band, fractions summing to 1', () => {
    // A and B held 3yd apart for 20s → entirely in the 0–5 band.
    const A = unit('A', 'friendly', still(0, 0));
    const B = unit('B', 'enemy', still(3, 0));
    const rows = computeDistanceBands([A, B], new Map([trackOf(A), trackOf(B)]));
    expect(rows).toHaveLength(1); // one unordered pair
    const r = rows[0];
    expect(r.b0_5).toBeCloseTo(1);
    expect(r.b5_25 + r.b25_40 + r.b40plus).toBeCloseTo(0);
    expect(r.sampledSec).toBeGreaterThan(9);
  });

  it('excludes unresolved ticks from sampledSec (no inflation across gaps)', () => {
    // Two samples 100s apart: only the handful of ticks within MAX_GAP_SEC of an actual
    // sample resolve, so sampledSec is a few seconds, not ~100.
    const A = unit('A', 'friendly', [{ tSec: 0, x: 0, y: 0 }, { tSec: 100, x: 0, y: 0 }]);
    const B = unit('B', 'enemy', [{ tSec: 0, x: 3, y: 0 }, { tSec: 100, x: 3, y: 0 }]);
    const r = computeDistanceBands([A, B], new Map([trackOf(A), trackOf(B)]))[0];
    expect(r.sampledSec).toBeLessThan(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spacing.test.ts`
Expected: FAIL — `computeDistanceBands` is not exported.

- [ ] **Step 3: Add `computeDistanceBands` to `src/metrics/spacing.ts`**

Extend the type import to include `DistanceBandRow`:

```ts
import type { UnitMetrics, PositionTrack, SpacingSummary, DistanceBandRow } from './types.js';
```

Append:

```ts
type Band = 'b0_5' | 'b5_25' | 'b25_40' | 'b40plus';
function bandOf(d: number): Band {
  if (d < 5) return 'b0_5';
  if (d < 25) return 'b5_25';
  if (d < 40) return 'b25_40';
  return 'b40plus';
}
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Per unordered player pair, the fraction of sampled time in each distance band.
 *  Fractions are over `sampledSec` (resolved ticks only) so unresolved time never inflates a band. */
export function computeDistanceBands(units: UnitMetrics[], tracks: Map<string, PositionTrack>): DistanceBandRow[] {
  const players = units.filter((u) => u.kind === 'player' && (tracks.get(u.unitId)?.samples.length ?? 0) > 0);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of players) {
    const s = tracks.get(p.unitId)!.samples;
    lo = Math.min(lo, s[0].tSec);
    hi = Math.max(hi, s[s.length - 1].tSec);
  }
  const rows: DistanceBandRow[] = [];
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return rows;
  const stepSec = STEP_MS / 1000;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = tracks.get(players[i].unitId)!;
      const b = tracks.get(players[j].unitId)!;
      const acc: Record<Band, number> = { b0_5: 0, b5_25: 0, b25_40: 0, b40plus: 0 };
      let sampled = 0;
      for (let t = lo; t <= hi; t += stepSec) {
        const d = distanceAt(a, b, t);
        if (d === undefined) continue;
        acc[bandOf(d)] += stepSec;
        sampled += stepSec;
      }
      const norm = sampled > 0 ? sampled : 1;
      rows.push({
        aId: players[i].unitId, bId: players[j].unitId,
        b0_5: round3(acc.b0_5 / norm), b5_25: round3(acc.b5_25 / norm),
        b25_40: round3(acc.b25_40 / norm), b40plus: round3(acc.b40plus / norm),
        sampledSec: round1(sampled),
      });
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/spacing.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/spacing.ts test/spacing.test.ts
git commit -m "feat: pairwise distance bands (0-5/5-25/25-40/40+ yd)"
```

---

## Task 9: Per-window positioning (collectAnchors + addWindowPositioning)

**Files:**
- Modify: `src/metrics/spacing.ts`
- Test: `test/windowPositioning.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { collectAnchors, addWindowPositioning } from '../src/metrics/spacing.js';
import type { UnitMetrics, PositionTrack, OffensiveWindow, Sample } from '../src/metrics/types.js';
import type { CastEvent } from '../src/metrics/cooldownTimeline.js';

function player(unitId: string, team: 'friendly' | 'enemy', spec: string): UnitMetrics {
  return { unitId, name: unitId, kind: 'player', team, spec, track: [], spacing: { meleeRangeSec: 0, isolatedSec: 0 } } as unknown as UnitMetrics;
}

// Dense (1s-apart) standing-still track over 0..25s so every tick in the 10–20s window resolves.
const still = (id: string, x: number, y: number): [string, PositionTrack] =>
  [id, { unitId: id, samples: Array.from({ length: 26 }, (_, i): Sample => ({ tSec: i, x, y })), breaks: [] }];

function baseWindow(over: Partial<OffensiveWindow>): OffensiveWindow {
  return {
    attackingTeam: 'enemy', defendingTeam: 'friendly', startSec: 10, endSec: 20,
    openedBy: [], teamDamageTaken: 0,
    damageByTarget: [{ unitId: 'F1', name: 'F1', damage: 5000 }],
    mitigation: { available: [], used: [] }, counterPlay: { ccOnDefenders: [], threatImmuneAuras: [] },
    ...over,
  } as OffensiveWindow;
}

describe('collectAnchors', () => {
  it('records anchor placements at the caster position from the cast event', () => {
    // matchStart=1000; F1 casts Summon Demonic Circle (48018) at ms 5000, at (7, 8).
    const match = { events: [{ timestamp: 1000 }, { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'F1', spellId: '48018', advancedActorPositionX: 7, advancedActorPositionY: 8, timestamp: 5000 }] };
    const a = collectAnchors(match).get('F1')!;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ unitId: 'F1', spellId: 48018, x: 7, y: 8, ms: 5000 });
  });
});

describe('addWindowPositioning', () => {
  // Window 10–20s. matchStart=1000 → window start in ms = 1000 + 10_000 = 11_000.
  // Primary target F1 sits at (0,0). Attacker E1 sits at (3,0) → threat distance 3.
  // Healer F2 (spec 65) sits at (10,0). Defender F1+F2 spread = 10.
  const tracks = new Map<string, PositionTrack>([
    still('F1', 0, 0),    // primary target at origin
    still('F2', 10, 0),   // healer 10yd away
    still('E1', 3, 0),    // attacker 3yd away
  ]);
  const units = [player('F1', 'friendly', '265'), player('F2', 'friendly', '65'), player('E1', 'enemy', '71')];

  it('fills threat / healer / spread distances for the primary target', () => {
    const out = addWindowPositioning([baseWindow({})], tracks, units, { events: [{ timestamp: 1000 }] }, new Map());
    const pos = out[0].positioning!;
    expect(pos.primaryTargetId).toBe('F1');
    expect(pos.threatDistanceStartYd).toBeCloseTo(3);
    expect(pos.threatDistanceMinYd).toBeCloseTo(3);
    expect(pos.nearestHealerYd).toBeCloseTo(10);
    expect(pos.teamSpreadYd).toBeCloseTo(10);
    expect(pos.escape).toBeUndefined(); // no anchor placed
  });

  it('reports escape when an anchor was placed, with availability from the return-spell cooldown', () => {
    // F1 placed Demon Circle (48018) at ms 5000 at (0, 0) → anchorDistance 0 (target at origin).
    const match = { events: [{ timestamp: 1000 }, { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'F1', spellId: '48018', advancedActorPositionX: 0, advancedActorPositionY: 0, timestamp: 5000 }] };
    // Teleport (48020) last cast at ms 1000 → at window start (11_000), 10_000ms elapsed < 30_000 CD → NOT available.
    const casts = new Map<string, CastEvent[]>([['F1', [{ spellId: 48020, name: 'Demonic Circle: Teleport', ms: 1000 }]]]);
    const out = addWindowPositioning([baseWindow({})], tracks, units, match, casts);
    const esc = out[0].positioning!.escape!;
    expect(esc.anchorPlaced).toBe(true);
    expect(esc.anchorDistanceYd).toBeCloseTo(0);
    expect(esc.escapeAvailable).toBe(false);
  });

  it('omits positioning when the window has no damage target', () => {
    const out = addWindowPositioning([baseWindow({ damageByTarget: [] })], tracks, units, { events: [{ timestamp: 1000 }] }, new Map());
    expect(out[0].positioning).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/windowPositioning.test.ts`
Expected: FAIL — `collectAnchors` / `addWindowPositioning` not exported.

- [ ] **Step 3: Add anchors + window positioning to `src/metrics/spacing.ts`**

Extend imports:

```ts
import type { UnitMetrics, PositionTrack, SpacingSummary, DistanceBandRow, OffensiveWindow, WindowPositioning } from './types.js';
import { distanceAt, resolvePosition } from './positionTracks.js';
import { matchStartMs, eventType, srcId, spellId, eventTimeMs, position } from './eventAccess.js';
import { anchorInfo } from '../metadata/repositioning.js';
import { isAvailable, type CastEvent } from './cooldownTimeline.js';
import { HEALER_SPEC_IDS } from './registry.js';
```

Append:

```ts
const HEALERS = new Set(HEALER_SPEC_IDS);

export interface AnchorPlacement { unitId: string; spellId: number; x: number; y: number; ms: number; }

/** Anchor (e.g. Demon Circle) placements per unit, in chronological order, with the caster
 *  position captured from the placement cast. */
export function collectAnchors(match: unknown): Map<string, AnchorPlacement[]> {
  const m = match as { events?: unknown[] };
  const events = Array.isArray(m.events) ? m.events : [];
  const out = new Map<string, AnchorPlacement[]>();
  for (const ev of events) {
    if (eventType(ev) !== 'SPELL_CAST_SUCCESS') continue;
    const sid = spellId(ev);
    if (!anchorInfo(sid)) continue;
    const s = srcId(ev);
    const ms = eventTimeMs(ev);
    const p = position(ev);
    if (!s || ms === undefined || !p) continue;
    const arr = out.get(s) ?? [];
    arr.push({ unitId: s, spellId: sid!, x: p.x, y: p.y, ms });
    out.set(s, arr);
  }
  return out;
}

const r1 = (x: number | undefined) => (x === undefined ? undefined : Math.round(x * 10) / 10);

function windowPositioning(
  w: OffensiveWindow,
  tracks: Map<string, PositionTrack>,
  players: UnitMetrics[],
  anchors: Map<string, AnchorPlacement[]>,
  casts: Map<string, CastEvent[]>,
  startMs: number,
): WindowPositioning | undefined {
  const targetId = w.damageByTarget[0]?.unitId;
  if (!targetId) return undefined;
  const target = tracks.get(targetId);
  if (!target) return { primaryTargetId: targetId };

  const keep = (t: PositionTrack | undefined): t is PositionTrack => !!t;
  const attackers = players.filter((p) => p.team === w.attackingTeam).map((p) => tracks.get(p.unitId)).filter(keep);
  const defenders = players.filter((p) => p.team === w.defendingTeam);
  const stepSec = STEP_MS / 1000;

  const nearestAttacker = (t: number): number | undefined => {
    let min: number | undefined;
    for (const a of attackers) { const d = distanceAt(target, a, t); if (d !== undefined && (min === undefined || d < min)) min = d; }
    return min;
  };

  const threatDistanceStartYd = nearestAttacker(w.startSec);
  let threatDistanceMinYd: number | undefined;
  for (let t = w.startSec; t <= w.endSec; t += stepSec) {
    const d = nearestAttacker(t);
    if (d !== undefined && (threatDistanceMinYd === undefined || d < threatDistanceMinYd)) threatDistanceMinYd = d;
  }

  let nearestHealerYd: number | undefined;
  for (const def of defenders) {
    if (def.unitId === targetId || !HEALERS.has(def.spec ?? '')) continue;
    const ht = tracks.get(def.unitId);
    if (!ht) continue;
    const d = distanceAt(target, ht, w.startSec);
    if (d !== undefined && (nearestHealerYd === undefined || d < nearestHealerYd)) nearestHealerYd = d;
  }

  let teamSpreadYd: number | undefined;
  const defTracks = defenders.map((p) => tracks.get(p.unitId)).filter(keep);
  for (let i = 0; i < defTracks.length; i++) {
    for (let j = i + 1; j < defTracks.length; j++) {
      const d = distanceAt(defTracks[i], defTracks[j], w.startSec);
      if (d !== undefined && (teamSpreadYd === undefined || d > teamSpreadYd)) teamSpreadYd = d;
    }
  }

  let escape: WindowPositioning['escape'];
  const windowStartMs = startMs + w.startSec * 1000;
  const placements = (anchors.get(targetId) ?? []).filter((pl) => pl.ms <= windowStartMs);
  if (placements.length) {
    const latest = placements[placements.length - 1];
    const info = anchorInfo(latest.spellId)!;
    const tp = resolvePosition(target, w.startSec).position;
    const anchorDistanceYd = tp ? Math.hypot(tp.x - latest.x, tp.y - latest.y) : undefined;
    const returnCasts = (casts.get(targetId) ?? []).filter((c) => c.spellId === info.returnSpellId).map((c) => c.ms);
    const escapeAvailable = isAvailable(returnCasts, info.returnCooldownMs, 1, windowStartMs);
    escape = { anchorPlaced: true, anchorDistanceYd: r1(anchorDistanceYd), escapeAvailable };
  }

  return {
    primaryTargetId: targetId,
    threatDistanceStartYd: r1(threatDistanceStartYd),
    threatDistanceMinYd: r1(threatDistanceMinYd),
    nearestHealerYd: r1(nearestHealerYd),
    teamSpreadYd: r1(teamSpreadYd),
    escape,
  };
}

/** Bolt a positioning record onto each offensive window (computed for its primary target). */
export function addWindowPositioning(
  windows: OffensiveWindow[],
  tracks: Map<string, PositionTrack>,
  units: UnitMetrics[],
  match: unknown,
  casts: Map<string, CastEvent[]>,
): OffensiveWindow[] {
  const m = match as { events?: unknown[] };
  const startMs = matchStartMs(Array.isArray(m.events) ? m.events : []) ?? 0;
  const anchors = collectAnchors(match);
  const players = units.filter((u) => u.kind === 'player');
  return windows.map((w) => {
    const pos = windowPositioning(w, tracks, players, anchors, casts, startMs);
    return pos ? { ...w, positioning: pos } : w;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/windowPositioning.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/spacing.ts test/windowPositioning.test.ts
git commit -m "feat: per-window positioning (threat/healer/spread + escape anchor)"
```

---

## Task 10: Wire into computeMatchMetrics

**Files:**
- Modify: `src/metrics/metrics.ts`
- Test: `test/metrics.test.ts`

- [ ] **Step 1: Write the failing test (append to `test/metrics.test.ts`)**

Use the existing real-fixture pattern in that file (it parses `test-data/fixtures/arena-sample.log` via `parseLogFile` and calls `computeMatchMetrics`). Add:

```ts
import { existsSync } from 'node:fs';
// (parseLogFile / computeMatchMetrics are already imported in this file; reuse them)

const FIXTURE = 'test-data/fixtures/arena-sample.log';
describe('computeMatchMetrics — positioning', () => {
  it.runIf(existsSync(FIXTURE))('populates positionTracks and distanceBands', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const mm = computeMatchMetrics(arenaMatches[0]);
    expect(mm.positionTracks.length).toBeGreaterThan(0);
    expect(mm.positionTracks.some((t) => t.samples.length > 0)).toBe(true);
    expect(mm.distanceBands.length).toBeGreaterThan(0);
    // every player carries a spacing summary
    const players = mm.teams.flatMap((t) => t.players.map((p) => p.player));
    expect(players.every((p) => p.spacing !== undefined)).toBe(true);
  });
});
```

If `test/metrics.test.ts` does not already import `parseLogFile`/`computeMatchMetrics`/`describe`/`it`/`expect`, add the imports (mirror `test/renderReport.test.ts` lines 5 and 7).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/metrics.test.ts`
Expected: FAIL — `mm.positionTracks` is `undefined` (or the property does not exist at runtime) because `computeMatchMetrics` does not yet populate it.

- [ ] **Step 3: Wire the computations into `src/metrics/metrics.ts`**

Add imports:

```ts
import { buildPositionTracks } from './positionTracks.js';
import { attachSpacing, computeDistanceBands, addWindowPositioning } from './spacing.js';
```

Replace the body of `computeMatchMetrics` with:

```ts
export function computeMatchMetrics(match: unknown): MatchMetrics {
  const m = match as { playerId?: unknown };
  const playerUnitId = typeof m.playerId === 'string' ? m.playerId : undefined;
  const auras = buildAuraState(match);
  const casts = collectCasts(match);
  const baseUnits = computeUnitMetrics(match, auras, casts);
  const tracks = buildPositionTracks(baseUnits, match);
  const units = attachSpacing(baseUnits, tracks);
  const focusTracks = computeFocusTracks(match);
  const windows = addWindowPositioning(computeOffensiveWindows(match, units, auras, casts), tracks, units, match, casts);
  return {
    teams: groupUnits(units, playerUnitId),
    timeline: buildTimeline(match),
    coordination: computeCoordination(match, HEALER_SPEC_IDS, focusTracks),
    focusTracks,
    offensiveWindows: windows,
    positionTracks: [...tracks.values()],
    distanceBands: computeDistanceBands(units, tracks),
    playerUnitId,
  };
}
```

(Note: `buildPositionTracks` uses `baseUnits` — its `.track` is the observed track, unchanged. `attachSpacing` returns a new array with `spacing`; downstream consumers use `units`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/metrics.test.ts`
Expected: PASS (the new positioning test, plus all pre-existing metrics tests).

- [ ] **Step 5: Run the full suite + tsc**

Run: `npx vitest run`
Expected: all pass.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/metrics/metrics.ts test/metrics.test.ts
git commit -m "feat: wire positionTracks/spacing/distanceBands/window-positioning into computeMatchMetrics"
```

---

## Task 11: Render + replay export

**Files:**
- Modify: `src/view/renderMetrics.ts`
- Modify: `src/cli/view.ts`
- Test: `test/renderReport.test.ts`

- [ ] **Step 1: Write the failing test (append a new `it` to the existing "renderReport metrics block" describe in `test/renderReport.test.ts`)**

First, enrich the existing inline fixture so there is positioning to render. In that fixture:
- give the `player` (P) a non-zero spacing: change its `spacing` to `{ meleeRangeSec: 7.5, isolatedSec: 3 }`;
- add one offensive window with positioning to the `offensiveWindows` array (replace `offensiveWindows: []` in that fixture with):

```ts
      offensiveWindows: [{
        attackingTeam: 'enemy', defendingTeam: 'friendly', startSec: 10, endSec: 20,
        openedBy: [{ spellId: 107574, spellName: 'Avatar', unitId: 'E1', startSec: 10, endSec: 20 }],
        teamDamageTaken: 5000, damageByTarget: [{ unitId: 'P', name: 'You', damage: 5000 }],
        mitigation: { available: [], used: [] }, counterPlay: { ccOnDefenders: [], threatImmuneAuras: [] },
        positioning: { primaryTargetId: 'P', threatDistanceStartYd: 5, threatDistanceMinYd: 3, nearestHealerYd: 12, teamSpreadYd: 18, escape: { anchorPlaced: true, anchorDistanceYd: 4, escapeAvailable: false } },
      }],
```

Then add the assertion:

```ts
  it('renders per-window positioning and per-unit spacing', () => {
    const html = renderReport([match({ metrics })], index());
    expect(html).toContain('threat');       // positioning column header
    expect(html).toContain('spread');       // team spread shown
    expect(html).toContain('melee');        // per-unit spacing in the move cell
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/renderReport.test.ts`
Expected: FAIL — the rendered HTML contains neither the positioning column nor the spacing text.

- [ ] **Step 3: Add per-unit spacing to the move cell in `src/view/renderMetrics.ts`**

In `unitRow`, change the move cell (currently `<td>${u.distanceMoved} (${u.timeStationarySec}s still)</td>`) to:

```ts
    `<td>${u.distanceMoved} (${u.timeStationarySec}s still)<br>melee ${u.spacing.meleeRangeSec}s · iso ${u.spacing.isolatedSec}s</td>` +
```

- [ ] **Step 4: Add a positioning column to the offensive-windows table in `src/view/renderMetrics.ts`**

In `offensiveWindowsBlock`, build a positioning cell per row and add the header. Replace the `.map((w) => { ... })` body so it includes a positioning string, and add the `<th>` to the header row.

Inside the `.map`, after the existing `const imm = ...;` line, add:

```ts
      const p = w.positioning;
      const posCell = p
        ? `threat ${p.threatDistanceStartYd ?? '—'}→${p.threatDistanceMinYd ?? '—'}y · heal ${p.nearestHealerYd ?? '—'}y · spread ${p.teamSpreadYd ?? '—'}y` +
          (p.escape ? ` · escape ${p.escape.anchorPlaced ? '✓' : '✗'}${p.escape.escapeAvailable ? '(rdy)' : ''}` : '')
        : '—';
```

Change the returned row string to append the positioning cell (add `<td>${posCell}</td>` before the closing `</tr>`):

```ts
      return `<tr><td>${w.startSec}-${w.endSec}s</td><td>${escapeHtml(TEAM_LABEL[w.attackingTeam] ?? w.attackingTeam)}</td>` +
        `<td>${openers}</td><td>${w.teamDamageTaken}</td><td>${used}/${avail}</td><td>${cc}${imm ? ` · immune:${imm}` : ''}</td><td>${posCell}</td></tr>`;
```

Update the table header (add a `positioning` column):

```ts
  return `<details><summary>offensive windows (${windows.length})</summary>
  <table><tr><th>t</th><th>attacker</th><th>opened by</th><th>dmg taken</th><th>mit CDs used/ready</th><th>counter</th><th>positioning</th></tr>${rows}</table></details>`;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/renderReport.test.ts`
Expected: PASS (all renderReport tests, including the new one).

- [ ] **Step 6: Add `positionTracks` + `distanceBands` to the replay JSON in `src/cli/view.ts`**

In the `--replay` block (around line 41), extend the written object. Replace the `writeFileSync(...)` line with:

```ts
      writeFileSync(join(replayDir, `match-${i}.json`), JSON.stringify({ playerUnitId: v.metrics.playerUnitId, timeline: v.metrics.timeline, tracks, focus, positionTracks: v.metrics.positionTracks, distanceBands: v.metrics.distanceBands }));
```

- [ ] **Step 7: Run the full suite + tsc**

Run: `npx vitest run`
Expected: all pass.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/view/renderMetrics.ts src/cli/view.ts test/renderReport.test.ts
git commit -m "feat: render per-window positioning + per-unit spacing; export positionTracks/distanceBands in replay JSON"
```

---

## Task 12: Final review gates

**Files:** none (review + fixes only)

- [ ] **Step 1: Run the full suite and type-check**

Run: `npx vitest run`
Expected: all tests pass.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run `/simplify`** on the branch diff (4 cleanup agents). Apply behavior-preserving fixes only; note any skips.

- [ ] **Step 3: Run `/code-review`** on the branch diff (high-effort). Fix confirmed/plausible findings; add a regression test for any real bug found. Re-run the suite after fixes.

- [ ] **Step 4: Sanity-check on a real log if available**

Run: `npm run view -- <a real 12.0.5 arena log>` (path from local config; e.g. a file under `D:\WoW_Arena_Coach\sample_data\logs`).
Expected: `output/report.html` renders the offensive-windows table with a populated `positioning` column on at least one window, and per-unit `melee`/`iso` figures. With `--replay`, `output/replay/match-*.json` contains `positionTracks` and `distanceBands`.

- [ ] **Step 5: Final commit (if review produced changes)**

```bash
git add -A
git commit -m "chore: address /simplify + /code-review findings for positioning subsystem"
```

---

## Notes for the implementer

- **NodeNext imports:** every local import ends in `.js` (e.g. `'./positionTracks.js'`), even though the file is `.ts`. Match the existing style.
- **TDD discipline:** write the test, watch it fail for the *expected* reason, then implement. Do not implement ahead of the test.
- **Do not modify** `src/metrics/perUnit.ts` (observed `track` stays observed-only) or `src/metrics/offensiveWindows.ts` (positioning is bolted on by `addWindowPositioning`). If you find yourself wanting to, stop and re-read the spec's "Data flow (non-invasive)" section.
- **Yards & coordinate space:** distances are raw `Math.hypot` of x/y — WoW world units are yards; no scaling. A single arena is one `uiMapID`, so coordinates are comparable within a match.
- **Limitation to leave in place (documented in spec):** a unit that is *only* ever a melee-swing target and never appears in `UnitMetrics` (never casts/dies/is interrupted) is skipped by inferred injection (`tracks.get(d)` is undefined). This is vanishingly rare for arena players; do not add special handling.
```
