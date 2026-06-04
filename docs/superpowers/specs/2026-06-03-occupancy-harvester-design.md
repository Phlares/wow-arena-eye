# Occupancy Harvester — Design Spec

**Status:** approved (litmus-validated 2026-06-03)
**Subsystem:** map-geometry enrichment (Phase 1 of historical-corpus ingestion)
**Depends on:** subsystem 3 (map geometry + LoS, PR #14, merged)

## Goal

Refine the inferred occupancy grids (`src/metadata/occupancy/<zoneId>.json`) by an
order of magnitude by ingesting **player position data from thousands of historical
combat logs** that the current pipeline cannot use, then regenerating all grids from
the combined live + historical sample.

## Problem

`build-occupancy.mjs` collects positions through `parseLogFile` →
`collectPositionsByZone`, which only sees **well-formed** arena matches. Older logs
(builds 11.0.7 / 11.1.7, `COMBAT_LOG_VERSION 22`) have a `COMBATANT_INFO` layout that
is **missing the `specId` field at parameter index 24**. Every field after it shifts
by one, so the vendored parser reads the wrong slot for equipment and throws inside
`parseEquippedItems`. The parser silently drops that event, never populates
`combatantMetadata`, and therefore marks the **entire match malformed** — so
`parseLogFile` returns **zero matches** on these files.

Litmus (2026-06-03) confirmed:

- The position/zone log format is otherwise **unchanged** across 11.x → 12.x.
- Harvested world coordinates land in the **same coordinate space** as the existing
  grids (Hook Point harvest `x 964–1056` vs committed grid `x 960–1059`, etc.), so the
  data merges directly.
- 5 historical files → 110 matches → **842,243 player positions** across 14 arenas.
- Full corpus: **~4,438 arena matches across all 15 currently-gridded arenas**
  (≈34M positions). Blade's Edge (1672) does **not** appear and is out of scope.

## Scope

**In scope (Phase 1):** occupancy/position extraction only — `(zoneId, player x, y)`.

**Out of scope:** full historical-metrics extraction (cooldowns, CC, LoS, etc.). The
historical logs reference spells and gameplay systems that no longer exist or behave
differently; feeding them into the current metrics would pollute intelligence more than
improve it. Fixing the `COMBATANT_INFO` shift to recover full matches is a possible
*future* phase, explicitly deferred. Blade's Edge (1672) is excluded (not present).

## Approach

Add a **version-tolerant, line-scanning position harvester** as an alternate ingestion
front-end for `build-occupancy`. It reuses the parser's **own** field extraction (the
`stringToLogLine` → `logLineToCombatEvent` pipeline stages) and the project's
`eventAccess` accessors — **no hand-rolled raw-field parsing** (which `eventAccess.ts`
explicitly forbids elsewhere). Because it consumes only position-bearing events
(`SPELL_DAMAGE`, `SPELL_CAST_SUCCESS`, …), the failing `COMBATANT_INFO` events drop
harmlessly (`logLineToCombatEvent` already catches per-event errors), and the
malformed-match gate is bypassed entirely.

This is **purely additive** — the existing well-formed-match parser path
(`parseLogFile`, metrics, render) is untouched, so nothing current changes behavior.

### Components

**`src/metrics/positionHarvest.ts`** — the harvester. One clear responsibility:
turn a stream of raw combat-log lines into per-zone player positions.

- `harvestPositions(lines: AsyncIterable<string> | Iterable<string>, into: Map<string, XY[]>): Promise<Map<string, XY[]>>`
  - Pipes each line through a fresh rxjs `Subject` → `stringToLogLine(tz)` →
    `logLineToCombatEvent('retail')`.
  - Tracks the active arena zone: an `ArenaMatchStart` event sets the current
    `zoneId`; an `ArenaMatchEnd` clears it. Positions are recorded **only while a
    zone is active**, so city/world positions between matches are excluded.
  - For each event with a source GUID starting `Player-` and a valid position
    (via `eventAccess.srcId` / `eventAccess.position`), append `{x, y}` to
    `into.get(zoneId)`.
  - Event-kind detection uses `constructor.name === 'ArenaMatchStart' | 'ArenaMatchEnd'`
    (not `instanceof` — under tsx the action classes can resolve to distinct module
    identities, which silently breaks `instanceof`; this was observed in the litmus).
  - Timezone: the historical timestamps carry an explicit UTC offset (`-4` / `-5`),
    so `parseCombatLogTimestamp` ignores the fallback tz; pass a fixed
    `'America/New_York'` for the rare offset-less line.
- `harvestFile(path: string, into: Map<string, XY[]>): Promise<Map<string, XY[]>>`
  — convenience wrapper that opens a `readline` stream over a file.

Rationale for a new module (not extending `eventAccess` or `parserClient`): the
harvester is a distinct ingestion mode with its own rxjs wiring; keeping it isolated
preserves the single-responsibility boundaries of `eventAccess` (field access) and
`parserClient` (well-formed-match ingestion).

**`scripts/build-occupancy.mjs`** — switch position collection to the harvester and
support multiple corpus directories.

- Replace the per-file `parseLogFile` + `collectPositionsByZone` loop with
  `harvestFile` over each `WoWCombatLog*.txt` in **each** corpus dir.
- `WAE_LOG_CORPUS` may now be a list of directories separated by the OS path
  delimiter (`;` on Windows, `:` on POSIX — `path.delimiter`). A single directory
  still works unchanged (backward compatible).
- Keep the existing `MIN_SAMPLES` gate, `buildOccluderGrid` params, `Z_AXIS_MAPS`
  tagging, and output path. Only the position **source** changes.
- `collectPositionsByZone` (the old match-based collector) is **removed** from the
  generator — the harvester supersedes it for grid building. It is referenced only by
  `test/buildOccupancy.test.ts` (the `collectPositionsByZone` case), which is removed
  with it; the `worldToCell` / `buildOccluderGrid` / flood-fill cases in that file stay.

**`scripts/build-occupancy.d.mts`** — update the type surface to match (drop
`collectPositionsByZone`; the harvester's types live with its `.ts` module).

**`scripts/view-occupancy.mjs`** — the occupancy viewer built during the litmus.
Commit it as-is (reads committed grids, renders a self-contained HTML heatmap).
Add an `npm run view-occupancy` script.

### Data flow

```
historical Logs dir ─┐
                     ├─► build-occupancy ─► harvestFile (per file)
live retail Logs dir ┘        │                  │
                              │           stringToLogLine → logLineToCombatEvent
                              │                  │
                              │           track zone (ArenaMatchStart/End) +
                              │           filter Player- src + valid position
                              ▼                  ▼
                     Map<zoneId, XY[]>  ◄────────┘
                              │
                     buildOccluderGrid (unchanged: void-ness, flood-fill, coverage)
                              ▼
                  src/metadata/occupancy/<zoneId>.json  (regenerated, richer)
```

## Error handling

- Per-file parse failures are caught and logged (`console.error('skip', file, …)`),
  matching the current generator; one bad file never aborts the run.
- Per-event parse failures are already swallowed by `logLineToCombatEvent`'s
  internal try/catch — the harvester sees only successfully-constructed events.
- A corpus directory that doesn't exist is reported and skipped, not fatal (so a
  machine missing the historical dir can still regenerate from the live corpus).
- `MIN_SAMPLES` still guards against thin coverage per zone.

## Testing

TDD throughout. Tests use small synthetic line arrays and a tiny committed fixture —
**no dependency on the private corpus** (paths come from env only).

1. **`test/positionHarvest.test.ts`**
   - A synthetic line array with `ARENA_MATCH_START,1825,…`, two `SPELL_DAMAGE`
     player events carrying advanced positions, and one event outside any match →
     only the in-match player positions are collected under zone `1825`.
   - A `Pet-`/non-`Player-` source is excluded.
   - Positions between `ARENA_MATCH_END` and the next `ARENA_MATCH_START` are excluded.
   - A malformed-`COMBATANT_INFO` line (the real 11.x shape) does **not** throw and
     does **not** prevent surrounding position collection — the regression guard for
     the whole feature.
   - Two matches in different zones accumulate into separate map keys.
2. **`scripts/` integration**: a Vitest test that runs `harvestFile` against the
   committed real fixture `test-data/fixtures/arena-sample.log` (12.0.5, zone 1825
   Hook Point) and asserts non-zero positions under zone `1825` with coordinates
   inside Hook Point's known world bounds (x ≈ 960–1060, y ≈ −375…−288). This proves
   the harvester agrees with the existing well-formed-match path on current logs.
3. Multi-corpus env parsing: `WAE_LOG_CORPUS` split on `path.delimiter` yields the
   expected directory list (unit-level).

Type-check with `npx tsc --noEmit`. Run tests with
`npx vitest run <file> --no-file-parallelism` (full `vitest run` oversubscribes
workers and hangs on this machine).

## Self-review notes

- *Placeholder scan:* none — all components, signatures, and tests are concrete.
- *Consistency:* the harvester reuses `XY` (already defined for the generator),
  `eventAccess.srcId/position`, and the vendor pipeline stages used in the litmus.
- *Scope:* single subsystem, one plan. Full-metrics historical extraction is
  explicitly deferred, not smuggled in.
- *Ambiguity:* "active zone" is defined precisely (between `ArenaMatchStart` and
  `ArenaMatchEnd`); the `constructor.name` vs `instanceof` hazard is called out so
  the implementer doesn't reintroduce the litmus bug.
