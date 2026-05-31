# Coordination & Targeting Rebuild — Design

**Date:** 2026-05-31
**Status:** Approved design; build this cycle.
**Builds on:** Phase 6 coordination (PR #6). Replaces its `swaps` (per-attacker direct-cast target-change count) and `focusFireWindows` (non-overlapping 3s multi-attacker windows) — both acknowledged as noisy proxies. Also closes the deferred `absorbDone=0` attribution gap.

---

## 1. What this is and why

The current coordination metrics count the wrong things. `swaps` counts every
direct-cast target change per attacker, so a single Malefic Rapture — which fires
one `SPELL_DAMAGE` per DoT'd target — reads as a flurry of target changes; real
games surface 150+ "swaps," which is not believable. `focusFireWindows` counts
raw 3-second multi-attacker windows, which inflates with match length and
aggression rather than measuring coordination.

This cycle replaces both with a **damage-weighted, rolling-window targeting
engine**. The core idea (user's): a player's target is *whoever they are dealing
the most damage to over a recent window* — not which spell last bounced where.
From that single notion we derive saner, coaching-relevant metrics:

- **swaps** = how often a player *re-aligns* their dominant target (debounced),
- **time-on-target** = how long each player stays committed to a target,
- **team alignment** = how much of the match teammates share a dominant target
  (replacing the raw focus-fire-window count),
- and a retained **per-player dominant-target track** (run-length-encoded over
  time) that is the substrate for later enemy-playstyle analysis (focus-target
  preference, coordinated burst during offensive cooldowns, intentional split
  strategies).

Separately, this cycle fixes **`absorbDone`**, which is currently hard-zeroed
because `SPELL_ABSORBED.srcId` is the *attacker*, not the shield caster.

This is metric computation, not a UI. The report changes only as a lean way to
validate the new numbers.

## 2. The targeting engine — `src/metrics/targeting.ts` (new)

A pure function that turns the match's damage events into a per-attacker
time series of dominant targets.

```ts
interface FocusOpts { windowMs?: number; stepMs?: number; dwellMs?: number; }
// defaults: windowMs 5000, stepMs 500, dwellMs 1000

interface FocusSegment { target: string; targetName: string; fromSec: number; toSec: number; }
interface AttackerTrack {
  attacker: string;       // owning player's unitId
  attackerName: string;
  team: Team;
  ticks: (string | null)[];   // smoothed dominant target unitId per tick (null = not engaged)
  segments: FocusSegment[];    // run-length encoding of `ticks` (the retained track)
}
interface FocusTracks { stepMs: number; tickCount: number; startMs: number; tracks: AttackerTrack[]; }

export function computeFocusTracks(match: unknown, opts?: FocusOpts): FocusTracks;
```

These three constants are **tuning knobs, not data** — defaulted in-code and
overridable via `opts` so we can re-tune during validation without code
spelunking. (This does not violate the no-hardcoded-*data*-paths rule; they are
algorithm parameters.)

### 2.1 Build damage buckets (attacker → target)

Iterate `match.events`. Keep an event when:
- `eventType` matches the damage allowlist `^(SPELL_DAMAGE|SPELL_PERIODIC_DAMAGE|RANGE_DAMAGE|SWING_DAMAGE|SWING_DAMAGE_LANDED)$` (the same explicit allowlist Phase 6 settled on — *all* damage, including DoT ticks and swings, because the metric is about damage volume over the window, not cast cadence),
- the source resolves to a **player attacker** (see pet-rolling below) on some team,
- the destination is on a *different* team than the attacker (enemy; includes neutral enemy summons, matching the Phase 5 damage guard).

For each kept event record `{ attacker, target, ms, amount }` where `amount` is `eventAccess.amount(e)` (already absolute-valued). Events without a usable timestamp are skipped.

**Pet rolling:** the attacker is always the *player*. If the source unit has an `ownerId` that points to a player unit, attribute to the owner; otherwise the source must itself be a player unit (`kind === 'player'`) or the event is ignored. This matches the combined-totals philosophy (your Felhunter's pressure is your pressure).

### 2.2 Tick grid + trailing-window dominant target

- `startMs` = earliest kept-damage timestamp; `endMs` = latest. `tickCount = floor((endMs - startMs) / stepMs) + 1`. Tick `i` sits at `startMs + i*stepMs`.
- For each attacker independently, sort their hits by `ms` and sweep the ticks with a sliding window over `[tick.ms - windowMs, tick.ms]`: advance a `hi` pointer to include hits at or before the tick, advance a `lo` pointer to drop hits older than the window, maintaining a `Map<target, runningDamage>`. This is ~O(hits + ticks) per attacker, not O(ticks×hits).
- **Dominant target at a tick** = the target with the most damage in the window. **Tie-break is hysteresis:** if the current window's leader does not *strictly* exceed the attacker's previous-tick dominant target's damage, keep the previous dominant target. This is what prevents equal-spread damage (e.g. Malefic Rapture across three DoT'd targets) from registering as churn — a challenger must actually out-damage the incumbent to take over. If there is no damage in the window, dominant = `null`.

### 2.3 Debounce (flicker removal)

Smooth each attacker's raw dominant-target tick array by **holding the previous
stable target through any run shorter than `dwellMs`** (`dwellTicks =
round(dwellMs / stepMs)`). A momentary blip that lasts fewer than `dwellTicks`
ticks is replaced by the surrounding stable target and therefore cannot create a
swap. The smoothed array is what every downstream metric uses and what
`segments` encodes.

### 2.4 Run-length encoding → `segments`

Collapse consecutive equal entries of the smoothed `ticks` into
`FocusSegment{ target, targetName, fromSec, toSec }` (seconds relative to
`startMs`; `null` runs are omitted, leaving gaps where the player was not
engaged). This compact per-player track is retained on the match output as the
analysis substrate and also exported into the replay JSON.

## 3. Derived metrics — `src/metrics/coordination.ts` (rewritten to consume the engine)

`computeCoordination(match, healerSpecIds)` keeps its signature and still returns
one summary per team, but now calls `computeFocusTracks` once and derives:

- **swaps** (redefined): per attacker, count transitions in the smoothed `ticks` between two *distinct non-null* targets. Engage (`null→A`) and disengage (`A→null`) do **not** count. Team `swaps` = sum over the team's attackers.
- **attackerFocus[]** (new, per attacker): `{ attacker, attackerName, swaps, topTarget?, topTargetSec, engagedSec }` where `topTarget` is the target with the most ticks (×`stepMs` → seconds), `engagedSec` = non-null ticks × step. This is the per-player validation/coaching view.
- **alignmentFraction** + **alignedTimeSec** (new, replace `focusFireWindows`): for each tick, count it "aligned" if ≥2 of the team's attackers share the same non-null dominant target. `alignedTimeSec` = aligned ticks × step; `alignmentFraction` = aligned ticks ÷ *contested* ticks (ticks where ≥2 of the team's attackers each have any non-null dominant target). If there are never ≥2 simultaneously-engaged attackers, `alignmentFraction = 0`, `alignedTimeSec = 0`.
- **Kept unchanged:** `targetPriority` (per-target damage-taken, descending), `topFocusTarget` (top of `targetPriority`), `healerPressureDamage` (summed damage to enemy units whose spec is in `healerSpecIds`). These are computed from the same damage buckets.

### 3.1 `CoordinationSummary` shape (in `types.ts`)

```ts
interface AttackerFocus {
  attacker: string; attackerName: string;
  swaps: number;
  topTarget?: string; topTargetSec: number;
  engagedSec: number;
}
interface CoordinationSummary {
  targetPriority: { name: string; damageTaken: number }[];
  topFocusTarget?: string;
  healerPressureDamage: number;
  swaps: number;                 // REDEFINED: debounced dominant-target re-aligns (team sum)
  attackerFocus: AttackerFocus[]; // NEW
  alignmentFraction: number;      // NEW (0..1)
  alignedTimeSec: number;         // NEW
  // focusFireWindows: REMOVED
}
```

The per-player **dominant-target tracks** are surfaced on `MatchMetrics` as
`MatchMetrics.focusTracks: FocusTracks` so later analysis and the replay export
can consume them. The RLE `segments` must be retained on the match output, not
discarded after computing the per-team summaries.

## 4. absorbDone fix — `eventAccess.ts` + `perUnit.ts`

- Add `absorbInfo(ev): { shieldOwnerId: string; amount: number } | undefined` to `eventAccess`. `SPELL_ABSORBED` carries the *absorbing caster* (shield owner) in fields distinct from `srcId` (which is the attacker). **The exact field positions are discovered by a TDD test against the real fixture** (the same method used for every other accessor — write a test asserting the shield owner on a known absorbed event, run it to see the real shape, implement). Returns `undefined` when the fields are absent.
- In `perUnit`, credit `absorbDone` to `shieldOwnerId` (not the attacker). Undefined → no contribution; never throws. `absorbDone` stops being hard-zeroed.

## 5. Report integration — `src/view/renderMetrics.ts` (lean, validation-only)

Per-team coordination line becomes:
`swaps N · alignment XX% (Ns) · top target <name> · healer pressure <n>`
plus a collapsed `<details>` listing `attackerFocus` rows
(`player · swaps · top target (Ns) · engaged Ns`). HTML-escaped, no styling.
`focusFireWindows` is removed from the rendering.

## 6. File structure

```
src/metrics/
  targeting.ts     # NEW: computeFocusTracks (engine) — buckets, sliding window, hysteresis, debounce, RLE
  coordination.ts  # REWRITTEN: consume engine → swaps/attackerFocus/alignment + kept targetPriority/healerPressure
  types.ts         # MODIFIED: CoordinationSummary + AttackerFocus + FocusTracks/AttackerTrack/FocusSegment; MatchMetrics gains focusTracks
  eventAccess.ts   # MODIFIED: add absorbInfo(ev)
  perUnit.ts       # MODIFIED: absorbDone credited to shield owner
  metrics.ts       # MODIFIED: call computeFocusTracks, thread focusTracks onto MatchMetrics
src/view/renderMetrics.ts  # MODIFIED: new coordination line + attackerFocus details; drop focusFireWindows
src/cli/view.ts            # MODIFIED (if needed): include focusTracks segments in --replay JSON export
test/
  targeting.test.ts        # engine: dominant/hysteresis/debounce/RLE/alignment timing (synthetic)
  coordination.test.ts     # MODIFIED: swaps/attackerFocus/alignment from tracks; targetPriority/healerPressure unchanged
  eventAccess.test.ts      # MODIFIED: absorbInfo discovered on fixture (TDD)
  perUnit.test.ts          # MODIFIED: absorbDone credited to shield owner
  fixture golden           # MODIFIED: your team swaps is small (sanity vs old 747); alignmentFraction in [0,1]
```

`targeting.ts` (the engine) is separate from `coordination.ts` (the summary) so
each has one responsibility and the engine is independently testable — and so
the retained tracks have a clean home for the future enemy-playstyle analyses.

## 7. Error handling

- No damage events / zero attackers → `tickCount 0`, empty `tracks`; every summary field empty/zero; report renders.
- Missing timestamps → event skipped (never contributes a hit).
- Missing `ownerId`/`type` → non-player, non-owned source ignored (not attributed).
- Tie with no previous dominant (first tick) → pick the strict leader; if all-zero, `null`.
- `absorbInfo` undefined → no absorb contribution; never throws.
- `stepMs`/`windowMs`/`dwellMs` are positive; `dwellTicks ≥ 1`.

## 8. Testing

- **targeting (engine), synthetic matches:**
  - A heavily for 6s then B for 6s → exactly **1 swap**; `topTargetSec`≈6 each; two `segments`.
  - A run with a single-tick blip on C mid-run → **0 extra swaps** (debounce), C absent from `segments`.
  - One tick where damage is split equally across A/B/C while incumbent is A → dominant stays **A** (hysteresis), **0 swaps**.
  - Two attackers both dominant on A over a 3s overlap → `alignedTimeSec`≈3, `alignmentFraction` correct against contested ticks.
  - RLE: `segments` reconstruct the smoothed `ticks` exactly.
- **coordination:** swaps = sum of per-attacker transitions; `attackerFocus` topTarget/engaged correct; `targetPriority`/`healerPressureDamage` unchanged from the same buckets.
- **eventAccess:** `absorbInfo` returns the shield owner + amount on a known absorbed event in the fixture (discovered via TDD).
- **perUnit:** an absorbed event credits `absorbDone` to the shield owner, not the attacker.
- **fixture golden:** re-assert on real data — your team's `swaps` is a small, believable number (explicit sanity bound against the old 747), `alignmentFraction ∈ [0,1]`, `attackerFocus` non-empty, your dominant-target `segments` non-empty.

## 9. Out of scope (future, enabled by the retained tracks)

The retained per-player dominant-target tracks make these *later* analyses
possible without re-deriving from raw events; none are built this cycle:

- enemy focus-target preference (who they prioritise across matches),
- coordinated burst detection (alignment coinciding with offensive-cooldown casts),
- intentional split-strategy detection (sustained *low* alignment by design),
- swap-timing correlation with deaths / defensive usage.

The hysteresis tie-break and debounce parameters (`windowMs`/`stepMs`/`dwellMs`)
are exposed on `FocusOpts` precisely so these analyses can re-run the engine at
different sensitivities without code changes.
