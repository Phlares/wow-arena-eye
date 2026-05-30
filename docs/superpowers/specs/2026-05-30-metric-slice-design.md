# First Metric Slice — Design

**Date:** 2026-05-30
**Status:** Approved design, pre-implementation
**Depends on:** Plan 1 (ingest) + debug readout (report). Seeds Plan 4 (metric battery).

---

## 1. What this is

The first real behavioral-metric extraction. For each parsed match, compute a
starter set of **player-attributed** metrics from the parsed event stream and
surface them in the existing `output/report.html`, so the user can ground-truth
extracted gameplay against games they remember. Affliction-3v3 in mind, but this
slice is largely spec-agnostic.

This deliberately covers only metrics that need **no spell-metadata table** —
spell *names* are already present in events, and purge-vs-cleanse is derivable
from the BUFF/DEBUFF tag. It establishes the **feature registry** that the full
metric battery (Plan 4) will grow inside.

## 2. Scope — the first metric set

All player metrics attribute to **the recording player + their pets** (e.g. the
Felhunter, since a warlock's interrupt comes from the pet). Derived from
`match.events`.

**Disruption (outgoing):**
- `interruptsLanded` (count) + `interruptsLandedBySpell` — what was kicked, by spell name.
- `dispels` + `dispelsByRemoved`; split into `purges` (removed aura was a BUFF) and `cleanses` (DEBUFF).
- `spellsteals`.

**Disruption (incoming):**
- `interruptsSuffered` + `interruptsSufferedBySpell` — what of yours got kicked.
- `buffsLostToPurgeOrSteal`.

**Tempo:**
- `casts` (SPELL_CAST_SUCCESS by player), `castsPerMin` (vs `durationInSeconds`, null if unknown), `topCasts` (top-N by count).

**Outcome context:**
- `deaths` + `deathTimesSec` (seconds into match); plus match-level `allyDeaths` / `enemyDeaths`.

**Compact per-combatant tally** (context, not player-only): `{ name, interrupts, dispels, casts, deaths }` for every unit — so the user can see e.g. whether the enemy healer was the kick target.

## 3. Components (pure + testable; the Plan 4 backbone)

- **`src/metrics/playerUnits.ts`** — `resolvePlayerUnits(match): Set<string>`. The
  player GUID is `match.playerId` (the parser's recording-player). Pets are
  resolved by owner linkage: GUIDs summoned by the player (SPELL_SUMMON source =
  player) and/or units whose owner GUID is the player. *The exact owner/summon
  field is confirmed against the parser's built `.d.ts`/event shape during impl —
  this is the one real plumbing nuance (warlock interrupts come from the pet).*
- **`src/metrics/registry.ts`** — the feature registry. Each metric is
  `{ id: string; label: string; category: 'disruption-out' | 'disruption-in' | 'tempo' | 'outcome'; }`
  and the registry maps to compute functions. Adding a metric later (Plan 4) is
  one isolated entry. For this slice the registry is exercised by
  `computeMatchMetrics`; it does not need a plugin loader.
- **`src/metrics/metrics.ts`** — pure compute functions over `match.events` and
  the resolved player-unit set, returning the typed shapes in §4. Event field
  access (source/dest unit id, spellId/spellName, the "extra spell" on
  interrupt/dispel/steal, the BUFF/DEBUFF tag) is read from the parser's action
  types; exact field names confirmed against the built `.d.ts` during impl
  (defensive access where the type is `unknown`).
- **`computeMatchMetrics(match): MatchMetrics`** — orchestrator: resolves player
  units, runs the metric functions, assembles `MatchMetrics`.

## 4. Data shapes

```ts
interface SpellTally { spellName: string; count: number; }

interface PlayerMetrics {
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

interface CombatantTally { name: string; interrupts: number; dispels: number; casts: number; deaths: number; }

interface MatchMetrics {
  player: PlayerMetrics;
  allyDeaths: number;
  enemyDeaths: number;
  perCombatant: CombatantTally[];
}
```

## 5. Integration with the report

- `ParsedMatchView` gains an optional `metrics?: MatchMetrics` field.
- The `view` CLI populates it: `view.metrics = computeMatchMetrics(rawMatch)`
  alongside the existing `projectMatch(rawMatch, kind)`. (Metrics live outside
  `projectMatch` so that function stays a pure structural projection.)
- `renderReport` gains a **"Metrics (you)"** block per match when `metrics` is
  present: the player headline numbers, the by-spell tallies, the death timeline,
  and the compact per-combatant table. `renderReport` stays a pure function.

## 6. Explicitly deferred (next slice — needs a spell-metadata table or aura-state tracking)

Attempted/**wasted kicks** (needs the player's interrupt spell IDs), **defensives
used + timing**, **deaths-while-CC'd**, CC chains, positioning, damage/healing
attribution + exclusion rules, coordination. The spell-metadata source decision
(reuse the old SimC export vs rebuild lean for Midnight) is the gate for that
slice.

## 7. Error handling

- `match.playerId` missing/unresolved → player-unit set falls back to empty;
  player metrics compute as zeros (not a crash). The report still renders.
- Zero events / zero casts → zero metrics; `castsPerMin` is `null` when
  `durationInSeconds` is missing or 0.
- Unknown event field shapes → defensive access yields 0/empty rather than
  throwing (debug-tool philosophy, consistent with `projectMatch`).
- A unit with no name → tally uses its GUID as the label.

## 8. Testing

- **`metrics.test.ts`** — pure unit tests with small hand-built synthetic
  `events` arrays: an interrupt by the player (asserts count + what-was-kicked),
  a dispel of a BUFF (purge) vs a DEBUFF (cleanse), cast counting + castsPerMin,
  death-time computation, and the incoming-interrupt (suffered) path.
- **`playerUnits.test.ts`** — synthetic match: player GUID + a summoned pet →
  set contains both; no pet → just the player.
- **Golden** (on the staged fixture, `it.runIf` present): `computeMatchMetrics`
  on the real 12.0.5 arena match — assert `player.casts > 0`, `perCombatant`
  non-empty, `deaths`/`allyDeaths`/`enemyDeaths` are numbers, and the structure
  is well-formed. (Exact values are eyeballed in the generated report, not
  hard-asserted, since the fixture's specifics aren't hand-counted.)

## 9. File structure

```
src/metrics/playerUnits.ts     # resolvePlayerUnits(match) -> Set<string>
src/metrics/registry.ts        # metric registry (ids/labels/categories)
src/metrics/metrics.ts         # pure compute fns + computeMatchMetrics + shapes
src/view/renderReport.ts       # MODIFIED: render the metrics block (pure)
src/cli/view.ts                # MODIFIED: populate view.metrics
test/metrics.test.ts
test/playerUnits.test.ts
```

## 10. Reuse / altitude notes

- Metrics read `match.events` (the authoritative ordered stream) and attribute by
  source/dest unit id — uniform and transparent for a first slice; the parser's
  per-unit buckets are an optimization to consider in Plan 4 if needed.
- The registry is intentionally the seam Plan 4 grows inside; keep metric
  functions pure and independently testable so the battery scales without a
  rewrite.
- Pet→owner attribution is solved once here and reused by every later metric that
  must include pet actions.
