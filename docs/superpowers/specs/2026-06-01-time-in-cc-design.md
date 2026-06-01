# Time-in-CC — Design (Cycle 1 of 2)

**Date:** 2026-06-01
**Status:** Approved design; build this cycle.
**Builds on:** PR #7 (coordination/targeting rebuild), now merged to master. Branch `feat/time-in-cc` off master.

---

## 1. What this is and why

The "suffered" side of the battery currently records CC only as a **count**
(`ccTaken`, `ccTakenByCategory[].count`); the `durationSec` field exists but is
hard-stubbed to `0`. A count doesn't tell you how long you were actually locked
out — the coaching-relevant signal is **time controlled**. This cycle fills that
in, driven by the actual spell DB rather than our ~29-spell curated CC set.

It produces a three-bucket time model that aggregates to a single total:

- **Cast-denial** — time you can't cast: `silence` auras **+ interrupt lockouts**.
- **Hard CC** — time you can't act at all: `stun ∪ incapacitate ∪ disorient`
  (polymorph resolves to incapacitate, fear to disorient per the DB).
- **Roots** — time you can't move: `root`.
- **Total controlled** — the *union* of all three (overlapping CCs counted once).

`disarm` is tracked in the per-category breakdown but excluded from the
three-bucket total (weapon-denial, not can't-act); `knockback`/`taunt` are
excluded entirely (instantaneous / PvE).

This is metric computation, not UI. The report changes only to surface the new
durations and to clarify two cryptic labels.

**Immunity / wasted-effort tracking (immuned CC, damage/healing into immune) is
explicitly Cycle 2 and NOT built here** (see §9).

## 2. Components

### 2.1 Spell-category data from the DB (`src/metadata/`)

The vendored wowarenalogs ships `vendor/wowarenalogs/packages/shared/src/data/spellClassMap.json`,
whose `diminishingReturns` section is generated from the wago.tools DB2
`SpellCategories.DiminishType` table. It has all 8 DR categories
(`root`, `taunt`, `stun`, `knockback`, `incapacitate`, `disorient`, `silence`,
`disarm`), each a list of `{ spellId: string, name: string, specIds: string[] }`.

- **Add a one-time import script** `scripts/import-cc-categories.mjs` that reads
  that file's `diminishingReturns` section and writes
  `src/metadata/ccCategories.json` of shape
  `Record<string /*spellId*/, { drCategory: DrCategory; name: string }>`. The
  script logs how many spells it imported per category. It is run manually (not
  at build time); the generated JSON is committed.
- **`ccCategories.json` becomes the primary CC source.** `ccInfo(id)` in
  `src/metadata/spells.ts` consults `ccCategories.json` first, then falls back to
  the existing curated table (so any curated CC the DB lacks still resolves).
  `ccInfo` returns `{ category: DrCategory }` (the `dr` field collapses — see
  §2.3; the DR *category* and the DR-progression *level* were always the same
  thing here, and level isn't tracked this cycle).
- The wago.tools CSV path (`/db2/SpellCategories/csv?build=…` joined with
  `SpellName`) is documented in the script header as the refresh source if the
  vendored snapshot ages out.

### 2.2 Interrupt lockout durations (curated)

Interrupts are not auras — the log emits a `SPELL_INTERRUPT` instant, not a
duration. School-lockout durations are well-known per interrupt spell and there
are only ~18 of them. Add a `lockoutSec` field to interrupt entries in
`src/metadata/spells.curated.json` (e.g. Counterspell 6, Spell Lock 6, Mind
Freeze 3, Pummel 4, Kick 4, Skull Bash 4, Wind Shear 3, Solar Beam 4, etc.), and
expose `interruptLockoutSec(id: number): number` from `spells.ts` (returns the
curated value, or a documented default of `4` when the interrupt is known but its
lockout isn't curated). Seed the spells the fixture actually contains plus the
common arena interrupts; the table grows over time like the rest of the curated
metadata.

### 2.3 `DrCategory` realignment (`src/metrics/types.ts`)

Realign `DrCategory` to the DB's actual 8-value set:
`'stun' | 'incapacitate' | 'disorient' | 'silence' | 'root' | 'disarm' | 'taunt' | 'knockback'`.
This **drops `'fear'`** (the DB folds fear into disorient/incapacitate) and
**adds `'taunt'`**. `CcTakenEntry { category: DrCategory; count: number; durationSec: number }`
is unchanged in shape. This is a small type change that ripples through
`ccTakenByCategory` producers/consumers (perUnit, renderMetrics). Any existing
entry in `spells.curated.json` that used `ccCategory: "fear"` must be remapped to
`disorient` (or `incapacitate`) as part of this change, and `SpellMeta`'s now-unused
`drCategory` field is removed in favor of the single `ccCategory`/DB category;
`tsc` enforces both.

### 2.4 `auraState` extension (`src/metrics/auraState.ts`)

- Treat `SPELL_AURA_BROKEN` and `SPELL_AURA_BROKEN_SPELL` as aura-close events,
  identical to `SPELL_AURA_REMOVED`: set the open interval's `end = ms` and close
  it. This captures CC broken early by damage (a real early end the current
  apply→removed-only model — and even wowarenalogs — misses).
- Expose the raw intervals: add `intervalsOn(unitId: string): { spellId: number; name: string; start: number; end: number }[]`
  to the `AuraState` interface, returning that unit's closed intervals (open auras
  already get `end = Number.MAX_SAFE_INTEGER`, so a never-removed CC is bounded by
  the caller against match end). `activeOn` is unchanged.

### 2.5 CC-duration computation (`src/metrics/ccTime.ts`, new)

A pure module that turns a unit's aura intervals + suffered-interrupt windows
into bucketed durations.

```ts
interface CcDurations {
  timeControlledSec: number;   // union of cast-denial ∪ hard-CC ∪ root
  castDenialSec: number;       // union of silence auras + interrupt-lockout windows
  hardCcSec: number;           // union of stun ∪ incapacitate ∪ disorient
  rootSec: number;             // union of root
  byCategory: { category: DrCategory; durationSec: number }[]; // per-DR-category union (incl. disarm)
}

interface Window { start: number; end: number; }

// merge overlapping [start,end) windows, return summed length in seconds
export function unionSeconds(windows: Window[]): number;

export function computeCcDurations(
  intervals: { spellId: number; name: string; start: number; end: number }[],
  interruptWindows: Window[],   // [interruptMs, interruptMs + lockoutSec*1000] per suffered interrupt
  matchEndMs: number,           // clamp for open-ended auras
): CcDurations;
```

- Each CC aura interval is classified by `ccInfo(spellId).category → bucket`
  (silence→cast-denial, stun/incap/disorient→hard-CC, root→roots; disarm→byCategory
  only). Intervals whose `end` is `MAX_SAFE_INTEGER` are clamped to `matchEndMs`.
- Each bucket's windows are **union-merged** (`unionSeconds`) so simultaneous CCs
  don't double-count. `castDenialSec` unions silence intervals together with the
  `interruptWindows`. `timeControlledSec` unions the cast-denial + hard-CC + root
  windows all together (a stun overlapping a root is one controlled span).
- `byCategory` reports each DR category's own union duration (including disarm,
  taunt, knockback if present — for completeness), independent of the buckets.
- Durations rounded to 0.1s at the edge.

### 2.6 `perUnit` integration (`src/metrics/perUnit.ts`)

- Capture each **suffered interrupt's timestamp and interrupting-spell id**: the
  `interruptsSuffered` accumulator becomes `{ name: string; ms: number; spellId: number }[]`
  (today it stores names only). `spellId(ev)` on a `SPELL_INTERRUPT` is the
  interrupting spell; `interruptLockoutSec(spellId)` gives the window length.
- In the result-assembly loop, build the unit's `interruptWindows` from those,
  call `computeCcDurations(auras.intervalsOn(id), interruptWindows, matchEndMs)`,
  and populate the new fields. `matchEndMs` = last event timestamp (derive once,
  alongside the existing `startMs`).
- Populate `ccTakenByCategory[].durationSec` from `CcDurations.byCategory`
  (joining on category; categories with a count but no measured duration get `0`).

### 2.7 Report rendering (`src/view/renderMetrics.ts`)

Lean, validation-only:

- Replace the bare `ccTaken` count cell with `Ns (cast-denial/hard/root)` — i.e.
  `timeControlledSec` then the three bucket seconds — keeping the count available
  in a tooltip-free compact form like `3 / 8.4s`.
- Relabel the cryptic `def(u/burst)` column header to `defensives (used / into burst)`.

## 3. New `UnitMetrics` fields (`types.ts`)

Add: `timeControlledSec: number`, `castDenialSec: number`, `hardCcSec: number`,
`rootSec: number`. Fill the existing `ccTakenByCategory[].durationSec`. CC is a
suffered, per-unit concept and is **not** added to `CombinedTotals`.

## 4. Data flow

`buildAuraState(match)` (now BROKEN-aware, exposes `intervalsOn`) →
`computeUnitMetrics` captures interrupt ms+spellId and, per unit, calls
`computeCcDurations(intervalsOn(id), interruptWindows, matchEndMs)` →
`UnitMetrics` carries the four bucket fields + filled `ccTakenByCategory` →
`renderMetrics` surfaces them.

## 5. Error handling

- Missing `ccCategories.json` entry and no curated fallback → spell isn't CC →
  contributes no duration (never throws).
- Aura applied but never removed/broken → `end = MAX_SAFE_INTEGER`, clamped to
  `matchEndMs`; if `matchEndMs` is unknown (no timestamps), the interval
  contributes 0.
- `SPELL_AURA_BROKEN` with no matching open aura → ignored (no negative window).
- Interrupt with unknown `lockoutSec` → default 4s (documented).
- Empty intervals / no interrupts → all duration fields `0`; report renders.
- `unionSeconds([])` → 0; windows with `end <= start` contribute 0.

## 6. Components / file structure

```
scripts/import-cc-categories.mjs   # NEW: spellClassMap.json → src/metadata/ccCategories.json
src/metadata/ccCategories.json     # NEW (generated, committed): spellId → {drCategory, name}
src/metadata/spells.curated.json   # MODIFIED: add lockoutSec to interrupt entries
src/metadata/spells.ts             # MODIFIED: ccInfo consults ccCategories.json; add interruptLockoutSec
src/metrics/types.ts               # MODIFIED: realign DrCategory; add 4 UnitMetrics fields
src/metrics/auraState.ts           # MODIFIED: BROKEN events close auras; expose intervalsOn
src/metrics/ccTime.ts              # NEW: unionSeconds + computeCcDurations
src/metrics/perUnit.ts             # MODIFIED: capture interrupt ms+spellId; compute cc durations
src/view/renderMetrics.ts          # MODIFIED: CC time cell + defensives label
test/
  importCcCategories.test.ts       # known spellId → expected drCategory from generated table
  ccTime.test.ts                   # unionSeconds + computeCcDurations (overlap, buckets, clamp, interrupt window)
  auraState.test.ts                # MODIFIED: BROKEN closes an aura; intervalsOn returns intervals
  perUnit.test.ts                  # MODIFIED: a silence + a stun → correct bucket durations; interrupt lockout
  metrics.test.ts                  # MODIFIED golden: player timeControlledSec >= 0; buckets <= total
  spells.test.ts                   # MODIFIED: ccInfo resolves a DB-imported spell; interruptLockoutSec
```

## 7. Testing

- **unionSeconds:** disjoint windows sum; overlapping windows merge (e.g.
  `[0,3]∪[2,5] = 5s`); touching windows `[0,2]∪[2,4] = 4s`; empty → 0.
- **computeCcDurations:** a 3s silence + a 2s stun overlapping by 1s →
  `castDenialSec 3`, `hardCcSec 2`, `timeControlledSec 4` (union). A root
  concurrent with a stun → `rootSec` and `hardCcSec` each counted, total = union.
  Open-ended aura clamped to `matchEndMs`. An interrupt window adds to
  `castDenialSec`. `disarm` shows in `byCategory` but not in the three buckets/total.
- **auraState:** `SPELL_AURA_BROKEN` sets the interval end to the break time (not
  match end); `intervalsOn` returns the unit's intervals with correct start/end.
- **import script:** generated `ccCategories.json` maps a known id (e.g. `408`
  Kidney Shot → `stun`, a known polymorph → `incapacitate`, a known silence →
  `silence`).
- **perUnit:** synthetic match — player takes a silence and a stun → `castDenialSec`
  / `hardCcSec` / `timeControlledSec` correct; a suffered interrupt with a curated
  lockout adds the expected cast-denial seconds; `ccTakenByCategory[].durationSec`
  populated.
- **fixture golden:** your `timeControlledSec >= 0`,
  `castDenialSec + hardCcSec + rootSec >= timeControlledSec` (sum ≥ union),
  `ccTakenByCategory` durations populated and ≥ 0.

## 8. Reuse / altitude notes

- `unionSeconds` is the one new primitive; everything else composes existing
  pieces (`auraState`, `ccInfo`, the curated table).
- Driving categories from the DB snapshot (`ccCategories.json`) replaces partial
  hand-curation and is the same generator seam a future spell-metadata refresh
  will use.
- Early-break handling lives in `auraState` (the right layer — it owns aura
  interval truth), not bolted onto the duration math.

## 9. Out of scope — Cycle 2 (immune / wasted-effort)

Documented, not built here:

- **Immuned CC attempts** — CC casts that were immuned (by an immunity buff or
  DR-immune), counted per category, attributed to the *source* (wasted effort).
  Requires discovering how "immune" appears in the parsed log (`SPELL_MISS`
  `missType=IMMUNE` vs full-absorb) via the same TDD-discovery method used for
  `absorbInfo`.
- **Damage / healing into immune** — amount of damage/healing spent on an immune
  target, attributed to the source.
- These build directly on this cycle's category table and `intervalsOn`.

DR-progression multipliers (50%/25%/immune effective-duration) remain out of scope
for both cycles; the DB gives categories, not applied-level math, and the combat
log already reflects the post-DR duration in the aura interval itself.
