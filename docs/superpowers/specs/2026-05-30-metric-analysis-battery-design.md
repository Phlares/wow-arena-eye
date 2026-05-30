# Metric & Analysis Battery — Phased Design

**Date:** 2026-05-30
**Status:** Approved design; Phases 1–3 to build this cycle, 4–6 deferred-but-documented.
**Builds on:** the first metric slice (PR #3). Supersedes its `player`(merged)+`perCombatant` model.

---

## 1. What this is

The design for the project's full per-match analysis layer — the behavioral
metrics that answer "what did each player do, and how." It is **phased**: this
document specifies all phases so the model and the report grow coherently, but
only **Phases 1–3 are built this cycle**; 4–6 are documented at design level and
deferred behind their data dependencies (chiefly a spell-metadata table).

Everything is computed from the parsed `match.events` + `match.units` (the
wowarenalogs parser output). Each phase adds metrics behind the existing
**feature registry** so the battery scales without rewrites.

## 2. Phased roadmap

| Phase | Adds | Data needed | Status |
|---|---|---|---|
| **1. Per-player + pet→owner grouping** | per-unit attribution (casts/interrupts/dispels/steals/deaths) by source; team split; pets nested under owners; combined player+pets totals | events + `unit.type`/`reaction`/`ownerId` | **build now** |
| **2. Spell-use & casting timeline** | match-level ordered timeline of casts/interrupts/dispels/steals/deaths (per-unit labelled) | events + timestamps | **build now** |
| **3. Movement & positioning** | per-unit distance moved, time-stationary, position-sample count | advanced-log `positionX/Y/facing` | **build now** |
| 4. "Suffered" + defensives | interrupts/CC taken, deaths-while-CC'd, defensives used + timing | + **spell-metadata table** (CC list, defensive list) + aura-state tracking | deferred |
| 5. Damage/healing attribution | per-unit damage/healing done, DPS/HPS, absorbs, exclusion rules (friendly-fire, ally totems, enemy summons) | parser damage/heal buckets + exclusion logic | deferred |
| 6. Coordination & targeting | focus-fire windows, target-priority, healer pressure, swap timing | synthesizes 1–5 | deferred |
| **X. Spell-metadata table** (cross-cutting) | classify spells: interrupts, CC (+category/DR), defensives, amplification | source: reuse old `simc_arena_spells.json` (War-Within-era) vs rebuild lean for Midnight — **decided when Phase 4 starts** | gate for 4 & 6 |

---

## 3. Build-now design (Phases 1–3)

### 3.1 Per-unit attribution (Phase 1 base)

For **every acting unit**, compute metrics attributed **by source** (the actor):
- `casts` (SPELL_CAST_SUCCESS where `srcId === unit`) + `topCasts` (top-N by count). *This unit's own casts only* — so the Felhunter's "Shadowbite" lands on the Felhunter, not the player.
- `interruptsLanded` + `interruptsLandedBySpell` (SPELL_INTERRUPT by unit; `extraSpellName` = what was kicked).
- `dispels`, split `purges` (BUFF removed) / `cleanses` (DEBUFF removed), each with a by-spell tally (`purgesBySpell`, `cleansesBySpell`) — "the spells they purged/cleansed by count".
- `spellsteals` + `spellstealsBySpell`.
- `deaths` + `deathTimesSec` (UNIT_DIED where `destId === unit`; seconds into match).

`kind` from `unit.type` (1→`player`, 3→`primary-pet`, 4→`temp-pet`, else→`other`).
`team` from `unit.reaction` (Friendly→`friendly`, Hostile→`enemy`, else→`neutral`).
`spec` (players) and `ownerId` (`unit.ownerId`) carried on each unit.

### 3.2 Pet→owner grouping + combined totals + teams (Phase 1)

- Group each pet (`kind` ∈ primary/temp) under its owner player by `pet.ownerId === player.unitId`.
- Pets whose owner is not a known player unit → a per-team `unownedPets` bucket (never silently dropped).
- For each player, compute `combined = player's own + all their pets` (sum the counts and merge the by-spell tallies) for casts/interrupts/dispels/purges/cleanses/steals/deaths. **This is the coaching-relevant total** (e.g., your Felhunter's Spell Lock counts as your interrupt), with the player/pet split still visible underneath.
- Group player-groups by `team` (friendly/enemy/neutral).

### 3.3 Spell-use & casting timeline (Phase 2)

- Build a **match-level** ordered array of `TimelineEvent` (sorted by time): one entry per cast / interrupt / dispel / steal / death, each labelled with `tSec` (seconds into match), the acting unit's id+name, a `kind`, and the spell (and `extra` = what was kicked/removed).
- `tSec` = `(eventTimeMs − matchStartMs) / 1000`, where `matchStartMs` is the first event's timestamp.
- Foundation for later sequence analysis (cast rotations, CC chains). This phase just produces the ordered, labelled stream and renders it.

### 3.4 Movement & positioning (Phase 3)

- Add a `position(ev): { x: number; y: number; facing?: number } | undefined` accessor to `eventAccess` (reads the advanced-log positional fields; exact field names discovered via a TDD test on the real fixture, same approach as the other accessors).
- Per unit, build a position track from its sourced events that carry a position, ordered by time. Compute:
  - `distanceMoved` = sum of Euclidean distance between consecutive samples.
  - `positionSamples` = count of samples.
  - `timeStationarySec` ≈ summed time between consecutive samples whose move < ε (default 0.5 world-units).
- These are **approximate** (sample rate = how often the unit acted) — useful for relative comparison and debugging, explicitly labelled as such. Movement fields live on `UnitMetrics` (per-unit; not summed into `combined`).

---

## 4. Data shapes (build-now)

```ts
type UnitKind = 'player' | 'primary-pet' | 'temp-pet' | 'other';
type Team = 'friendly' | 'enemy' | 'neutral';

interface SpellTally { spellName: string; count: number; }

interface UnitMetrics {
  unitId: string;
  name: string;
  kind: UnitKind;
  team: Team;
  spec?: string;
  ownerId?: string;
  // Phase 1 (by source)
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
  // Phase 3
  distanceMoved: number;
  positionSamples: number;
  timeStationarySec: number;
}

interface CombinedTotals {
  casts: number;
  interruptsLanded: number;
  interruptsLandedBySpell: SpellTally[];
  dispels: number;
  purges: number;
  cleanses: number;
  spellsteals: number;
  deaths: number;
}

interface PlayerGroup { player: UnitMetrics; pets: UnitMetrics[]; combined: CombinedTotals; }
interface TeamGroup { team: Team; players: PlayerGroup[]; unownedPets: UnitMetrics[]; }

type TimelineKind = 'cast' | 'interrupt' | 'dispel' | 'steal' | 'death';
interface TimelineEvent { tSec: number; unitId: string; unitName: string; kind: TimelineKind; spell?: string; extra?: string; }

interface MatchMetrics {
  teams: TeamGroup[];
  timeline: TimelineEvent[];
  playerUnitId?: string;
}
```

## 5. Components / file structure (build-now)

```
src/metrics/
  eventAccess.ts     # MODIFIED: add position(ev) accessor (Phase 3)
  perUnit.ts         # computeUnitMetrics: per-unit attribution (Phase 1 base + movement Phase 3)
  grouping.ts        # group pets→owners, players→teams, combined totals (Phase 1)
  timeline.ts        # buildTimeline(match) (Phase 2)
  metrics.ts         # computeMatchMetrics orchestrator -> MatchMetrics; exports the shapes
  registry.ts        # MODIFIED: extend metric defs
  playerUnits.ts     # REMOVED (superseded by per-unit + grouping)
src/view/renderReport.ts  # MODIFIED: team→player-group block + timeline section + movement columns
src/cli/view.ts           # unchanged (calls computeMatchMetrics)
test/  perUnit / grouping / timeline / movement(eventAccess.position) / renderReport tests
```

Splitting by phase-responsibility (`perUnit`/`grouping`/`timeline`) keeps each
file focused and is the seam the deferred phases plug into.

## 6. Report integration

The metrics block becomes, per match:
- **Two team sections** (Your team / Enemy team). Each lists **player groups**: a combined headline per player (incl. pets) — casts, interrupts (+kicked), dispels (purge/cleanse + by-spell), spellsteals, deaths, distance/time-stationary — expandable to the player-only line + each pet line. Your row highlighted via `playerUnitId`.
- **A collapsed timeline** (`<details>`): chronological table (tSec · unit · action · spell) for the match.

Pure `renderReport`; native `<details>`; HTML-escaped; no styling fuss.

## 7. Error handling

- Missing `unit.type`/`reaction`/`ownerId` → `other`/`neutral`/no-owner; never throws.
- A pet whose `ownerId` matches no player unit → `unownedPets`.
- `position(ev)` returns `undefined` when absent → that event contributes no sample; a unit with 0 samples reports `distanceMoved 0`, `timeStationarySec 0`.
- Missing timestamps → timeline entry omitted / `tSec` from best-available; movement skips the sample. Real logs always timestamp.
- Empty match / zero units → empty `teams`/`timeline`; report renders.

## 8. Testing

- **perUnit:** synthetic multi-unit match — player casts exclude pet casts; pet's interrupt on the pet's row; purge vs cleanse by-spell; deaths by dest.
- **grouping:** pet nested under owner by `ownerId`; `combined = player + pets` sums + merged tallies; orphan pet → `unownedPets`; team split by reaction.
- **timeline:** events sorted by `tSec`, correct kind/spell/extra, unit labels.
- **movement:** `position` accessor discovered on the real fixture (TDD); distance = sum of deltas on a synthetic track; stationary detection with ε.
- **fixture golden:** re-assert on the new shape — your combined interrupts ≥ 1 (via Felhunter), purges grouped, timeline non-empty, your unit has position samples.

## 9. Deferred phases (documented; not built this cycle)

- **Phase 4 — Suffered + defensives:** interrupts/CC taken per unit; deaths-while-CC'd (needs aura-state tracking at time of death); defensives used + whether timed into incoming burst. **Gated on the spell-metadata table** (which spell IDs are CC — with DR category — and which are defensives). Extends `UnitMetrics` with `suffered*`/`defensives*`.
- **Phase 5 — Damage/healing attribution:** per-unit damage/healing done, DPS/HPS, absorbs; exclusion rules (friendly-fire, ally totems, include enemy summons) — parity with the old build's validated attribution. Reuses the parser's per-unit damage/heal buckets.
- **Phase 6 — Coordination & targeting:** focus-fire windows (multiple allies on one target in a time window), target-priority (healer vs DPS), swap timing — synthesizes phases 1–5.
- **Phase X — Spell-metadata table (cross-cutting gate):** classify spells (interrupt / CC+category / defensive / amplification). Decision deferred to Phase 4 start: reuse old repo's `simc_arena_spells.json` (E: old repo, War-Within-era — needs Midnight refresh) vs rebuild a lean Midnight-current table. Likely a small curated JSON keyed by spellId, loaded once.

## 10. Reuse / altitude notes

- `resolvePlayerUnits` is removed; the grouping layer (keyed on `unit.ownerId`) does its job correctly with the player/pet split preserved.
- Per-phase modules (`perUnit`/`grouping`/`timeline`/movement-in-`eventAccess`) keep files focused and give the deferred phases clean seams to extend `UnitMetrics`/`MatchMetrics`.
- The feature registry grows per phase; metric functions stay pure and independently testable so the battery scales without a rewrite.
- Movement/timeline are approximate-by-construction (sample rate, event grammar) — labelled as such in the report so they aren't mistaken for exact telemetry.
