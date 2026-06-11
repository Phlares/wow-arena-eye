# Positioning / Spacing Design (GO-analysis subsystem 2)

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — ready for implementation plan

## Goal

Build the **spatial foundation** of GO analysis: a queryable, timeline-aligned
record of where every player is at every moment, plus the generic distance
primitive that answers "how far is unit A from unit B at time T." Summaries and
per-window spatial fields are *derived* from this; the raw, moment-level data is
retained so downstream inference can reconstruct any spatial cut (distance
bands, closest/furthest during a go, isolation timelines) without re-running the
pipeline.

This is **subsystem 2** of the three-layer GO-analysis north star:

1. **Cooldown model** — non-spatial backbone. *Done (PR #12, merged).*
2. **Positioning / spacing** — this spec. Geometry-free, 2D distance foundation.
3. **Map geometry + line of sight** — per-arena occluder geometry, z-axis,
   height-gated range/LoS. Later; reads this subsystem's distance primitive.

## Boundary: what this subsystem is and is NOT

The combat log's advanced position is **2D only**: X, Y, facing, and a
`uiMapID`. **There is no Z coordinate** (confirmed in
`vendor/wowarenalogs/packages/parser/src/actions/CombatAdvancedAction.ts` — the
raw params expose positionX at offset+12, positionY at offset+13, `uiMapID` at
offset+14, facing at offset+15; no height field exists).

Therefore:

- This subsystem operates entirely in the **2D plane** and measures distance in
  **yards** (WoW world units are yards; melee ≈ 5 yd, max cast/heal range ≈ 40 yd).
- **Height-gated range and line-of-sight are NOT derivable here.** They need map
  geometry / height data and belong to subsystem 3. The `uiMapID` the parser
  currently discards (param offset+14) is the hook subsystem 3 will need; this
  spec only documents it, it does not consume it.
- Ability-range gating (was a cast in range?) is intentionally deferred: range
  without z/LoS is misleading (a target can be in 2D range yet height- or
  LoS-blocked). The distance primitive is the exact seam those later features
  read.

## North star (context, not this subsystem)

The destination is **GO analysis**: for every enemy offensive window, was it
lethal or handled, and *what determined that* — their offense, our
available-vs-used mitigation, their counter-play, and the **spatial layer**
(distance to the threat / escape / teammates, eventually line of sight). The
cooldown model already emits the central `OffensiveWindow` record with a
reserved `positioning` slot; this subsystem fills it and adds the standalone
position artifacts the verdict-synthesis capstone will consume.

## Components

### A. Position-track store for all players (`src/metrics/positionTracks.ts`)

The **primary artifact**, not a summary. A mobility-aware, optionally
gap-filled, per-player position time series for *every* unit in the arena,
surfaced on `MatchMetrics.positionTracks`. Same `t0 = matchStart` as the spell
timeline, so any timeline moment cross-references to where everyone was
("timeline and position line up").

#### A.1 Sample sources

> **AMENDED 2026-06-10 (position-sample attribution fix):** this section's premise was
> wrong — the advanced-log block describes the **infoGUID** unit (parser field
> `advancedActorId`), which is the DEST on `_DAMAGE`/`_HEAL`/`_DAMAGE_LANDED` events, not
> the source. Samples are now attributed by `eventAccess.advancedUnitId(ev)`, which gives
> passive targets exact samples from every hit/heal they receive; the inferred melee
> gap-filling below was removed along with `Sample.inferred` / `PositionQuery.inferred`.
> The original text is retained for the design history.

1. **Observed samples** — the actor (source) position carried on ~41% of events
   (`eventAccess.position(ev)`), exactly as `perUnit` already collects them.
2. **Inferred samples (passive-target gap-filling)** — `position(ev)` is the
   *actor's* position, so a passive/CC'd target (the kill target during a go)
   emits no samples of its own. A melee swing on them
   (`SWING_DAMAGE` / `SWING_DAMAGE_LANDED` where the unit is `destId`)
   constrains them to ≈ the attacker's position. We inject an **inferred sample**
   for the target at the attacker's actor position at that timestamp, tagged
   `inferred: true`. Heals are excluded (40 yd = a weak constraint). Inferred
   samples are **never** merged silently with observed ones — the tag survives
   into the retained artifact so inference can weight them.

`Sample` gains an optional `inferred?: boolean` (absent / false = observed).

#### A.2 Mobility-aware interpolation

Positions only update on cast/done events, so between samples we interpolate —
**except across a teleport**, which is a discontinuous jump that linear
interpolation would smear into a fake glide.

- A curated `MOBILITY_ABILITIES` set (in `src/metadata/repositioning.ts`) lists
  blink/teleport/step/leap abilities. Seed: Demonic Circle: Teleport (48020),
  Shadowstep (36554), Blink (1953), Heroic Leap (6544), Disengage (781).
  Extensible like the other metadata tables.
- When a unit casts a mobility ability at `Tc`, its track **splits at a break**:
  - the **pre-segment** (samples with `tSec ≤ Tc`) is valid for interpolation up
    to `Tc − PRE_CAST_VALID_SEC` (0.5 s);
  - the **post-segment** begins at the next observed sample (the landing);
  - the **transit gap** `(Tc − 0.5s, firstPostSample)` is genuinely unknown.

A `PositionTrack` retains `{ unitId, samples: Sample[], breaks: number[] }`
(`breaks` = mobility-cast timestamps in epoch ms) so the segmentation is
reconstructable downstream, not baked away.

#### A.3 The distance primitive

```ts
interface PositionQuery {
  position?: Sample;     // resolved (lerped, mobility/gap-aware) or undefined if unknowable
  inferred: boolean;     // true when `position` derives from an inferred sample
  lastKnown: Sample[];   // up to 3 most recent REAL samples with tSec ≤ T (timestamps included)
}

// resolve one unit's position at T, honest about uncertainty
resolvePosition(track: PositionTrack, tSec: number): PositionQuery

// convenience: just the resolved Sample (or undefined)
positionAt(track: PositionTrack, tSec: number): Sample | undefined

// 2D Euclidean distance in yards; undefined if either side unresolved
distanceAt(a: PositionTrack, b: PositionTrack, tSec: number): number | undefined
```

Rules inside `resolvePosition`:

- **Max-gap guard:** return `position: undefined` unless a real sample exists
  within `MAX_GAP_SEC` (3 s) of `tSec` — refuse to interpolate across long idle
  gaps (positions land on only ~41% of events).
- **Mobility segmentation:** never lerp across a break; transit gap →
  `position: undefined`.
- **Honest unknown:** when `position` is `undefined`, still populate `lastKnown`
  with the 3 most recent real samples (each with its `tSec`). No pre-baked
  assumption is substituted for the missing value.

`distanceAt` uses `resolvePosition(...).position` for both units; if either is
`undefined`, distance is `undefined`. Bands and summaries skip those ticks.

### B. Per-player spacing summary (`src/metrics/spacing.ts` → `UnitMetrics.spacing`)

Lean, derived, never the only data:

```ts
interface SpacingSummary {
  meleeRangeSec: number;  // time within MELEE_YD (8) of any enemy player
  isolatedSec: number;    // time nearest ally player is beyond HEAL_RANGE_YD (40)
}
```

Sampled at a fixed cadence (`STEP_MS = 500`) across the match, time-weighted by
the step, skipping ticks where the unit's own position is unresolved.
`MELEE_YD = 8` (effective melee incl. hitbox/reach), `HEAL_RANGE_YD = 40`
(max cast/heal range) — named constants, documented as tunable.

### C. Distance bands (`src/metrics/spacing.ts` → `MatchMetrics.distanceBands`)

Pairwise, whole-match, the cuts called out as high-value for reconstruction:

```ts
interface DistanceBandRow {
  aId: string; bId: string;
  b0_5: number; b5_25: number; b25_40: number; b40plus: number; // fractions, sum ≈ 1
  sampledSec: number;  // resolved-tick coverage (honesty about gaps)
}
```

One row per unordered player pair. At each `STEP_MS` tick, `distanceAt(a, b, t)`;
if resolved, classify into a band and accumulate the step. Fractions are over
`sampledSec` (resolved ticks only), so unresolved time never inflates a band.
Per-window and closest/furthest/avg-during-a-go cuts are **not** precomputed —
they are reconstructable from `positionTracks` + the primitive on demand.

### D. Per-window positioning (`src/metrics/spacing.ts` → `OffensiveWindow.positioning?`)

Fills the slot the cooldown model reserved. Computed for the window's **primary
target** = `damageByTarget[0].unitId` (already sorted desc by the offensive-window
builder). All fields optional — `undefined` when positions are unresolvable.

```ts
interface WindowPositioning {
  primaryTargetId: string;
  threatDistanceStartYd?: number; // primary target → nearest attacking-team player at window start
  threatDistanceMinYd?: number;   // min of that distance across the window (did they create/lose distance)
  nearestHealerYd?: number;       // primary target → their healer (registry HEALER_SPEC_IDS), peel/heal reach
  teamSpreadYd?: number;          // max pairwise distance among defending players at window start (clump vs spread)
  escape?: {
    anchorPlaced: boolean;        // an anchor (e.g. Demon Circle) existed for the target at window start
    anchorDistanceYd?: number;    // primary target → anchor position
    escapeAvailable: boolean;     // anchorPlaced AND the return ability is off cooldown at window start
  };
}
```

- **threatDistanceMin** is sampled at `STEP_MS` across `[start, end]`, taking the
  min of (primary target → nearest attacking-team player); start value is the
  same query at window start.
- **Escape anchors** come from a curated `ANCHOR_ABILITIES` table in
  `src/metadata/repositioning.ts`. Seed (warlock, the user's spec):
  `48018 Summon Demonic Circle → returnSpellId 48020 (Teleport), returnCooldownMs 30000`.
  A `collectAnchors(match)` pass records each placement `{ unitId, x, y, ms }`
  from the *cast* event's actor position; the active anchor for a target at the
  window is its latest placement before `window.start`. `escapeAvailable` =
  `anchorPlaced && isAvailable(returnCasts, returnCooldownMs, 1, window.start)`
  (reusing `cooldownTimeline.isAvailable`). Table-driven and general; only Demon
  Circle is seeded now (teleports/steps/gateway extend the same table later).

### Data flow (non-invasive)

`metrics.ts` orchestration, additions only:

```
const casts = collectCasts(match);
const units = computeUnitMetrics(match, auras, casts);          // observed track unchanged
const tracks = buildPositionTracks(units, match);               // positionTracks.ts: observed + inferred + breaks
const unitsWithSpacing = attachSpacing(units, tracks);          // spacing.ts: SpacingSummary per unit
const windows = addWindowPositioning(                            // spacing.ts: WindowPositioning per window
  computeOffensiveWindows(match, unitsWithSpacing, auras, casts),
  tracks, units, match, casts,
);
// MatchMetrics gains: positionTracks (PositionTrack[]), distanceBands (DistanceBandRow[])
```

- `computeUnitMetrics` is **not** modified to build spacing (cross-unit) or to
  consume inferred samples — `UnitMetrics.track` stays observed-only so
  `distanceMoved` / `timeStationarySec` / HP-burst math are not inflated by
  inferred melee positions. The enriched store is a separate, purpose-built
  artifact.
- `offensiveWindows.ts` is **not** modified; positioning is bolted on by
  `addWindowPositioning`, keeping spatial logic in `spacing.ts`.

### Render (`src/view/renderMetrics.ts`)

- **Offensive-windows table:** add a positioning cell — threat start→min,
  nearest healer, team spread, and an escape indicator (anchor ✓/✗, available).
- **Per-unit row:** add `meleeRangeSec` / `isolatedSec`.
- **Bands and full positionTracks stay in data, not the table** (too wide);
  available via the `--replay` JSON export for downstream tooling.

## Types summary (`src/metrics/types.ts`)

- `Sample` gains `inferred?: boolean`.
- New: `PositionTrack`, `PositionQuery`, `SpacingSummary`, `WindowPositioning`,
  `DistanceBandRow`.
- `UnitMetrics` gains `spacing: SpacingSummary`.
- `OffensiveWindow` gains `positioning?: WindowPositioning`.
- `MatchMetrics` gains `positionTracks: PositionTrack[]` and
  `distanceBands: DistanceBandRow[]`.

## Constants (named, documented, tunable)

| Constant | Value | Meaning |
|---|---|---|
| `MAX_GAP_SEC` | 3 | refuse interpolation with no real sample within this of T |
| `PRE_CAST_VALID_SEC` | 0.5 | pre-mobility-cast interpolation cutoff before a teleport |
| `STEP_MS` | 500 | sampling cadence for summaries / bands / window min |
| `MELEE_YD` | 8 | "in melee range" (incl. hitbox/reach) |
| `HEAL_RANGE_YD` | 40 | max cast/heal range; isolation threshold |
| `LAST_KNOWN_N` | 3 | recent real samples returned on an unresolved query |

## Testing (TDD throughout)

- **Primitive:** synthetic tracks — `distanceAt` correct in yards; max-gap guard
  returns `undefined`; `resolvePosition` populates `lastKnown` (≤3, with
  timestamps) on an unresolved query.
- **Mobility:** a mobility cast between two distant samples → no lerp across the
  break; pre valid to `Tc−0.5`; transit gap `undefined`; post-segment resolves
  from the landing sample.
- **Inferred gap-filling:** a `SWING_DAMAGE` on a sample-less target injects an
  inferred sample at the attacker's position, tagged `inferred: true`, and the
  observed track is unchanged.
- **Player spacing:** synthetic two-unit scenario → `meleeRangeSec` /
  `isolatedSec` match hand-computed time.
- **Distance bands:** known track pair → band fractions sum to 1 over
  `sampledSec`; unresolved ticks excluded.
- **Window positioning:** synthetic window + tracks + a placed anchor → exact
  `threatDistanceStartYd` / `threatDistanceMinYd` / `nearestHealerYd` /
  `teamSpreadYd` / `escape` fields; `escapeAvailable` flips with the return
  ability's cooldown.
- **Integration:** real fixture yields populated `positionTracks`,
  `distanceBands`, and `positioning` on at least one window; observed/inferred
  samples are distinguishable.

## Public/private & constraints

- No hardcoded data paths; curated tables (`repositioning.ts`) are factual
  reference data, committed like `spells.curated.json` / `cooldowns.json`.
- Read-only ingestion; no game memory/file access.
- Inferred data always tagged; observed and inferred never silently mixed.

## Resolved decisions

- **2D only; z-axis / LoS / range-gating deferred to subsystem 3.** ✅
- **Keystone = generic distance-between-any-two-units-at-any-moment primitive;
  summaries are derived, raw retained.** ✅
- **Mobility-aware interpolation** (split at mobility cast, valid to `Tc−0.5s`,
  transit `undefined`). ✅
- **Honest unknown:** unresolved query → `undefined` + last 3 known positions
  with timestamps; no pre-baked guess. ✅
- **Passive-target gap-filling** from melee-interaction constraints, tagged
  inferred. ✅
- **Distance bands** (0–5 / 5–25 / 25–40 / 40+ yd) precomputed pairwise now;
  other cuts reconstructable from `positionTracks`. ✅
- **Escape** = anchor distance + return-ability availability (Demon Circle
  seeded, table-driven). ✅
