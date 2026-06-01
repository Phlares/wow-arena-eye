# Cooldown Model Design

**Date:** 2026-06-01
**Status:** Approved (brainstorming) — ready for implementation plan

## Goal

Build the non-spatial backbone of "GO analysis": a cooldown model that tracks
every player's major offensive and defensive cooldowns, detects enemy offensive
windows ("gos"), measures their severity, and records — per window — what
mitigation was *available* versus *used* on the defending side, plus the
enemy's counter-play. The central artifact is an **offensive-window record**
that later subsystems (positioning, line-of-sight) bolt additional fields onto.

## North star (context, not this subsystem)

The destination is **GO analysis**: for every enemy offensive window, was it
lethal or handled, and *what determined that* — their offense, our
available-vs-used mitigation, their counter-play (CC on our helpers, going while
CC-immune), and the spatial layer (range to escape/teammates, line of sight).

That synthesis spans three subsystems plus the CC/immune work already on master:

1. **Cooldown model** — this spec. The non-spatial backbone.
2. **Positioning (spacing)** — distance to allies/enemies/escape, geometry-free. Later.
3. **Map geometry + line of sight** — occluder geometry per arena, cover/kiting. Later.

A final "was this GO handled well?" verdict is a capstone once all layers exist.

## Scope

### Delivers now

1. **Inventory + durations** — categorize tracked spells into enemy *offensive*
   CDs, personal *damage-reduction* defensives, *external* defensives, *healing*
   CDs, *trinket*, *immunity*. (CC / interrupt / DR / immune already on master.)
2. **Availability timeline** — per player per CD, derive ready / on-CD intervals
   from casts + durations (charges supported). Answers "was X up at time T," and
   exposes ready-interval durations (hold/idle time) as first-class output.
3. **Offensive-window detection** — a window = interval where ≥1 enemy offensive
   CD is *active*; overlapping ones merge; the window names its contributors.
   **Symmetric**: windows detected in both directions (their gos against us and
   our gos against them).
4. **Severity** — defending-team damage taken during the window, and per target.
5. **Mitigation ledger per window** — for the defending team, per category, what
   was *available* vs *used*, **attributed per player** (captures teammate
   "trades"). Plus enemy counter-play: CC landed on our players during the
   window, and whether the primary threat was CC-immune / full-DR.

This also **retires the opaque `defensivesUsed`/`defensivesIntoBurst` (`used/burst`)
column**: defensives become "used vs available, and into which window."

### Deferred (the window record reserves slots for these)

- **Positioning** — range to escape (e.g. demon circle), to teammates, to the
  threat → subsystem 2.
- **Line of sight / cover** — occluder geometry, the gateway-block aura and other
  spatial-mitigation flags → subsystem 3.
- **Verdict synthesis** — the final "handled well?" judgment → capstone.
- **Offensive throughput** — how long offensive buttons/cooldowns were *held*
  without pressing, timing vs raw maximum throughput. These are descriptive data
  points for downstream training models ("vs comp X as comp Y, pressing ability A
  before time T → +winrate"). The availability engine (§2) is designed so this is
  a *read* off existing ready-interval durations, not a re-architecture. Not built
  here.
- **Talent-based CDR** — base cooldown is used as an approximation now;
  `COMBATANT_INFO` talents are a later refinement.

## Components

### 1. Data sourcing & inventory

Source of truth is the **MiniCC addon's `Rules.lua`** (maintained, spec-aware
enemy-cooldown database). It is keyed `BySpec` (33 spec blocks) with a `ByClass`
fallback for cross-spec spells, 122 spell entries total. Each rule carries:

- `SpellId` (canonical spell ID)
- `Cooldown` (seconds)
- `BuffDuration` (seconds) — the active-window duration
- classification flags: `BigDefensive`, `ExternalDefensive`, `Important`
- talent gates: `RequiresTalent`, `ExcludeIfTalent`, `RequiresEvidence`,
  `CanCancelEarly`, `MinDuration`

**Generator:** a script mirroring the existing `import-cc-categories.mjs` parses
`Rules.lua` into a committed `src/metadata/cooldowns.json`:

```jsonc
{
  "generatedAt": "...",
  "source": "MiniCC Rules.lua",
  "bySpec": {
    "265": [ { "spellId": 113858, "name": "Dark Soul: Misery",
               "cooldownSec": 120, "buffDurationSec": 20,
               "bigDefensive": false, "externalDefensive": false,
               "important": true,
               "talentGates": { "requiresTalent": null, "excludeIfTalent": null } } ]
  },
  "byClass": { "WARLOCK": [ /* ... */ ] }
}
```

The generator reads MiniCC from a **configurable path** (git-ignored config,
never hardcoded) — consistent with the project's public/private separation. The
generated `cooldowns.json` is factual reference data and is committed, like
`ccCategories.json`.

**Spec join is direct:** the parser's `CombatUnitSpec` is a string enum of the
same spec IDs MiniCC keys on (`Warlock_Affliction = '265'`, `Mage_Frost = '64'`),
so `unit.spec` → `bySpec['265']` is a clean lookup; `byClass[classToken]` is the
cross-spec fallback.

**Offensive overlay (the one curated judgment):** MiniCC has no explicit
"offensive" flag — `Important` is a catch-all. A small curated overlay
(`src/metadata/cooldowns.curated.json`) marks which entries are **go-defining
offensive CDs** (the burst CDs that open a window) and may correct/augment any
MiniCC values. This is the only hand-maintained piece and the set is well-known.

**Categories** resolved per spell:

| Category        | Source                                                |
|-----------------|-------------------------------------------------------|
| `offensive`     | curated overlay (go-openers)                          |
| `defensive`     | `BigDefensive && !ExternalDefensive`                  |
| `external`      | `ExternalDefensive`                                   |
| `healing`       | curated overlay (large healing CDs)                   |
| `trinket`       | curated overlay / known trinket IDs                   |
| `immunity`      | existing immunity tagging on master                   |

A loader module `src/metadata/cooldowns.ts` exposes:
`cdInfo(spellId, specId?) → { name, cooldownSec, buffDurationSec, categories[] } | undefined`
(spec-specific first, class fallback, curated overlay applied last).

### 2. Availability engine (`src/metrics/cooldowns.ts`)

- Accumulate **timestamped casts** per `(unitId, spellId)`. Today only cast
  *counts* are tallied; add a timestamped cast list in the per-unit accumulator.
- From casts + `cooldownSec` (+ charges where applicable), compute each tracked
  CD's **ready / on-CD intervals** across the match.
- Public API:
  - `isAvailable(unitId, spellId, tMs) → boolean`
  - `readyIntervals(unitId, spellId) → { startMs, endMs }[]` (exposes hold/idle
    durations for the deferred throughput work)
- **Charges:** maintain a charge count; a CD with charges remaining is available.
- **Limitations (documented):** talent CDR ignored (base cooldown approximation);
  CD-reset effects not modeled (curated note where it matters); a CD never cast
  in the match has no observed evidence — treated as available throughout unless
  curated otherwise.

### 3. Offensive-window detection (`src/metrics/offensiveWindows.ts`)

- A window opens while ≥1 enemy **offensive** CD (per the overlay) is *active*.
- **Active interval** comes from the observed buff aura in `auraState` (reusing
  existing machinery — a clipped/cancelled buff correctly shortens the window),
  validated against `buffDurationSec`, with `buffDurationSec` as the fallback
  when no aura is observed.
- Overlapping enemy offensive CDs **merge** into one window; the window lists all
  contributing CDs with their individual active intervals.
- **Symmetric:** detect windows in both directions (attacking team = the team
  whose offensive CDs opened it; defending team = the other).

### 4. The offensive-window record (central artifact)

```ts
type MitigationCategory =
  | 'defensive' | 'external' | 'healing' | 'trinket'
  | 'immunity' | 'cc-control' | 'interrupt';

interface CdRef {
  spellId: number;
  name: string;
  unitId: string;      // the player who holds/pressed it
  startMs: number;     // active-interval start (for openedBy)
  endMs: number;
}

interface MitigationItem {
  unitId: string;      // attributed per player (captures teammate trades)
  category: MitigationCategory;
  spellId: number;
  name: string;
  // present in `used`; for `available` it is the readiness at window start
  usedAtSec?: number;
}

interface WindowCounterPlay {
  ccOnDefenders: { unitId: string; name: string; spell: string; sec: number }[];
  threatCcImmune: boolean;   // primary threat had full-DR / immunity in-window
}

interface OffensiveWindow {
  attackingTeam: Team;
  defendingTeam: Team;
  startSec: number;
  endSec: number;
  openedBy: CdRef[];                 // enemy offensive CDs + active intervals
  teamDamageTaken: number;           // defending-team damage during window
  damageByTarget: { unitId: string; name: string; damage: number }[];
  mitigation: {
    available: MitigationItem[];     // ready (maybe unused) per player/category
    used: MitigationItem[];          // cast in [startMs - 1000, endMs]
  };
  counterPlay: WindowCounterPlay;
  // reserved for later subsystems (omitted until built):
  // positioning?: ...   // subsystem 2
  // lineOfSight?: ...    // subsystem 3
}
```

"Used" = cast within `[windowStart − 1s, windowEnd]` (the pre-emptive lead
captures defensives pressed in anticipation). Counter-play is derived from the
CC-done and immune/DR data already on master.

### 5. Output & rendering

- `MatchMetrics.offensiveWindows: OffensiveWindow[]` — full data under the hood
  (like `focusTracks`).
- Per-unit **availability summary** replacing the `used/burst` column:
  defensives shown as "used vs available, and into which window."
- A windows section in the rendered report: one summary row per window
  (time, attacking team, opening CDs, severity, mitigation used/available count),
  with detail available underneath.

## Testing (TDD throughout)

- **Inventory/loader:** `cdInfo` resolves spec-specific before class fallback;
  curated overlay applied last; offensive overlay marks expected go-openers.
- **MiniCC parse smoke:** generator yields sane counts (≈122 entries, 33 specs)
  and required fields present.
- **Availability engine:** synthetic cast sequences — single cast, charges,
  back-to-back, never-cast; `isAvailable` and `readyIntervals` correct.
- **Window detection:** `auraState` fixtures — single CD, overlapping merge,
  clipped buff shortens window, no-aura fallback to `buffDurationSec`, symmetry.
- **Mitigation ledger:** real match fixture — available-vs-used attributed per
  player; counter-play (CC on defenders, threat CC-immune) populated.

## Public/private & constraints

- No hardcoded data paths. MiniCC path and all data locations come from
  git-ignored config.
- Generated `cooldowns.json` (factual reference data) is committed; bulky/private
  fixtures are not.
- Read-only ingestion of the addon's Lua data; no game memory/file access.

## Resolved decisions

- **Scope:** all 6 players, offensive + defensive. ✅
- **Durations source:** MiniCC `Rules.lua` (cooldown + buff duration + category +
  spec), not Wago/simc. ✅
- **Burst window = enemy offensive CDs active, severity measured by team damage
  taken during them.** ✅
- **Window trigger inventory:** seeded from MiniCC; offensive go-openers marked by
  a small curated overlay. ✅
- **Symmetry:** both teams' windows. ✅
- **Central artifact:** the offensive-window record above, with reserved
  positioning / line-of-sight slots. ✅
