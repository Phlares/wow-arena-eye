# Map Geometry + Line of Sight Design (GO-analysis subsystem 3)

**Date:** 2026-06-03
**Status:** Approved (brainstorming) — ready for implementation plan

## Goal

Give GO analysis a **spatial occlusion layer**: infer per-arena occluder geometry
from where players have actually stood across hundreds of games, then expose a
**standalone line-of-sight (LoS) timeline** — "does unit A have LoS to unit B at
time T" — that piggybacks subsystem 2's position timeline, plus tracking of the
temporary, ability-created LoS disruptors. LoS is not just a per-window detail:
proactive LoS/range use is often what *delays* an offensive window (stalling for
defensives to come off cooldown), so it is a first-class timeline, and a key
input to the verdict-synthesis capstone.

This is **subsystem 3** of the GO-analysis north star (subsystem 1 = cooldown
model, done; subsystem 2 = positioning/spacing, done — PR #13). Per the user's
choice it is written as **one phased spec** covering all of subsystem 3.

## Hard constraints (why this approach)

- **No geometry, no Z, no LoS signal in the log.** WoW exposes no public arena
  collision/occluder geometry; the combat log carries 2D position + facing +
  `uiMapID` only (no height); and LoS failures are client-side cast failures
  (`SPELL_CAST_FAILED`) absent from the combat log — `SPELL_MISSED` has no
  "line of sight" miss type. So LoS cannot be read or validated from the log
  directly.
- **wowarenalogs has no reusable geometry.** Its replay renders unit sprites
  over a flat raster minimap PNG (`images.wowarenalogs.com/minimaps/{zoneId}.png`)
  plus the `zoneMetadata` world→image bounding-box transform. No vectors,
  navmesh, collision, raycast, or z anywhere. (We *do* reuse `zoneMetadata` for
  calibration and the minimap PNGs as a visual tracing/validation backdrop.)
- **Extracting real zone files is ban-risk and off-limits.** We never touch game
  files/memory. Geometry is *inferred* from the combat log we already ingest.

**Therefore: infer occluders from occupancy.** Over hundreds of games, players
traverse the walkable space; cells nobody stands in are non-walkable. The
*interior* negative space (enclosed by walkable cells) is exactly the
pillars/walls that matter for LoS; the *exterior* negative space is the
out-of-bounds rim, irrelevant to interior LoS. This sidesteps geometry sourcing
entirely and refreshes as more games are played.

## Approach decisions (settled in brainstorming)

- **Raster now, vectors later.** Ship the occupancy raster as the occluder map
  and run grid-raycast LoS now. Fitting clean flat/curved wall vectors from dense
  occupancy is the **3-III** refinement (deferred), which is also where true
  diagonal-wall precision comes from.
- **Soft, graded occupancy.** Each cell stores a continuous **void-ness** in
  `[0,1]` (`1 − normalized visit density`), not a hard blocked/clear bit. LoS
  integrates the void-mass a ray crosses and thresholds → a **confidence**
  (`clear` / `likely-blocked` / `blocked`), which softens the diagonal
  staircasing of a coarse grid and matches the project's honesty convention.
- **Diagonals:** accepted as coarse/staircased in the raster phase; true angular
  precision deferred to the vector-fit (3-III).
- **Z-maps stay approximate.** The 8 z-axis arenas (Mugambala, Robodrome, Cage of
  Carnage, Ruins of Lordaeron, Dalaran Sewers, Black Rook Hold, Tiger's Peak,
  Nokhudon) get occupancy LoS too, tagged `approximate` (no height). Slope/one-way
  edges + height-aware LoS are **3-III**.
- **Corpus:** the live retail Logs directory, via a git-ignored config path
  (`WAE_LOG_CORPUS`). The generated occluder grids are *derived, generic arena
  geometry* (not personal data) and are committed like `cooldowns.json`,
  refreshable as the season accumulates.

## Phases

### Phase 1 — Occupancy occluder generation (offline)

A generator `scripts/build-occupancy.mjs` (mirroring `import-cooldowns.mjs`):

1. Reads the corpus path from `WAE_LOG_CORPUS` (git-ignored config; never
   hardcoded), enumerates logs, parses each via the existing parser client.
2. Extracts **observed** player world-positions (`eventAccess.position`, the
   actor's X/Y) grouped by `zoneId`. **Observed only** — subsystem 2's *inferred*
   melee samples are excluded so attacker-position guesses don't bias the
   walkable map. Pets/NPCs excluded (players only) for a clean walkable signal.
3. Bins positions into a per-arena grid. Grid bounds come from the observed
   position extents (padded), cross-checked against `zoneMetadata` min/max where
   present. Cell size is per-arena, the **finest the data density supports**
   (target ~1–2 yd; coarser when a map is thinly played), recorded in the grid.
4. Computes per-cell **void-ness** = `1 − clamp(visits / saturationCount, 0, 1)`
   (a cell visited ≥ `saturationCount` times is fully walkable = void-ness 0; a
   never-visited cell = void-ness 1). `saturationCount` tunable.
5. **Interior vs exterior void:** flood-fill from the grid border through
   high-void cells; border-reachable void = out-of-bounds (zeroed out, not an
   occluder); enclosed void = **occluder** (pillars/walls). Light morphological
   close/open denoises speckle and fills pillar interiors. Min-occluder-area drop
   removes single-cell noise.
6. Emits a committed grid per arena: `src/metadata/occupancy/<zoneId>.json`
   (packed void-ness grid + bounds + cellSize + `sampleCount` + `coverage` +
   `isZAxisMap` flag). `coverage` = fraction of the walkable hull with ≥
   `saturationCount` visits — the confidence signal.

**Refresh:** re-run the generator as games accumulate. **Confidence gating:**
arenas below a coverage/sampleCount floor are marked low-confidence so the LoS
engine can return `unknown` rather than fabricate occluders from sparse data.

### Phase 2 — Static LoS engine (standalone timeline)

`src/metrics/lineOfSight.ts`:

- Loads the occluder grids (lazy, by `zoneId`).
- **Core:** `losBetween(grid, posA, posB) → { result: 'clear' | 'likely-blocked' | 'blocked' | 'unknown'; occlusion: number }`.
  Supercover-traverse the grid cells the segment A→B crosses (Amanatides–Woo),
  accumulating `occlusion = Σ (cell void-ness × path-length-in-cell) / segmentLength`.
  Threshold into `clear` (below `clearMax`), `likely-blocked` (mid), `blocked`
  (above `blockedMin`). `unknown` when the grid is missing or below the
  confidence floor.
- **Timeline query:** `losAt(zoneId, trackA, trackB, tSec)` — resolves both
  positions via subsystem 2's `resolvePosition` (same timeline, same gap/mobility
  semantics), then `losBetween`. Mirrors `distanceAt` exactly. `unknown` when
  either position is unresolved.
- **Aggregates:** per relevant pair, fraction of (resolvable) match time with
  clear LoS and longest contiguous blocked interval — surfaced as a first-class
  `lineOfSight` artifact on `MatchMetrics`.
- **Z-maps:** results carry an `approximate: true` tag (the grid's `isZAxisMap`).

### Phase 3 — Dynamic LoS disruptors

`src/metrics/losDisruptors.ts` scans events for the three ability-created
occluders, producing intervals `{ kind, casterId, team, pos?, radius?, startSec, endSec, modeled }`:

- **Smoke Bomb (modeled).** Cast position + radius define a sphere; the aura on
  units identifies who is inside. Rule (confirmed): the bomb is keyed to the
  **caster's team** — the **opposing team is LoS-blocked across the in/out
  boundary to *anyone*** (teammate or enemy), while the **caster's team sees
  through it** to anyone; all players move in/out freely. `losAt` consults active
  smoke spheres: a query whose endpoints straddle the membrane is `blocked` for
  the affected team, unaffected for the caster's team. `modeled: true`.
- **Ice Wall (flagged).** A temporary impassable + LoS-occluding wall that also
  gates LoS-dependent abilities (e.g. Demonic Gateway placement). Exact placement
  geometry/orientation isn't reliably in the log → recorded as a "potential LoS
  disruption" interval with caster + approximate position; `modeled: false`.
- **Deep Breath fire trail (flagged).** A path-dependent occluding trail; not
  geometrically modelable from the log → interval flag only; `modeled: false`.

**Intent:** beyond the smoke-bomb membrane, the disruptor layer's value is to
**flag intervals where a non-geometry-visible LoS disruption was potentially
present**, as a success/failure and *explanation* signal — e.g. why a player
interrupted Ice Wall, or pressed a teleport before offense, when no
straightforward reason was otherwise visible.

Disruptor ability IDs, radii, and durations are **curated** in a small table
(`src/metadata/` alongside the other curated metadata), verified against
wago.tools / wowhead at build time per the existing metadata-refresh convention
— not hardcoded from memory.

### Phase 4 — Wiring & GO-analysis signals

- **`MatchMetrics`** gains `lineOfSight` (per-pair LoS aggregates / timeline
  substrate) and `losDisruptors` (interval list).
- **`OffensiveWindow`** gains a `lineOfSight` annotation: target↔nearest-attacker
  LoS at window start, fraction of the window with clear LoS (did they break LoS
  during the go), and any disruptor active in/around the window.
- **Proactive-LoS substrate:** the standalone LoS timeline makes the pre-window
  lead-up queryable (go delayed by LoS/range to stall for defensives). This spec
  *exposes* that substrate; the verdict capstone interprets it.
- **Render:** a LoS cell in the offensive-windows table (clear/likely/blocked/
  approximate + disruptor flag). **Replay JSON** (`--replay`) gains the occluder
  grid reference, the LoS timeline, and the disruptor intervals (a future
  debug/replay view can overlay occluders on the minimap PNG for validation).

## Data model (types, `src/metrics/types.ts`)

```ts
interface OccluderGrid {
  zoneId: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  cellSize: number;          // yards
  cols: number; rows: number;
  voidness: number[];        // row-major [0,1]; 0 = walkable, 1 = enclosed void (occluder)
  sampleCount: number;       // positions aggregated
  coverage: number;          // [0,1] confidence
  isZAxisMap: boolean;
}

type LosResult = 'clear' | 'likely-blocked' | 'blocked' | 'unknown';
interface LosQuery { result: LosResult; occlusion: number; approximate: boolean; }

type DisruptorKind = 'smoke-bomb' | 'ice-wall' | 'deep-breath';
interface LosDisruptor {
  kind: DisruptorKind; casterId: string; team: Team;
  pos?: { x: number; y: number }; radius?: number;
  startSec: number; endSec: number; modeled: boolean;
}

interface WindowLineOfSight {
  primaryTargetId: string;
  result: LosResult;                 // target ↔ nearest attacker at window start
  clearFraction?: number;            // fraction of window with clear LoS
  approximate: boolean;              // z-map
  disruptorsActive: DisruptorKind[]; // disruptors overlapping the window
}
```

`MatchMetrics` gains `occluderGridRef?` / `lineOfSight` aggregates and
`losDisruptors: LosDisruptor[]`; `OffensiveWindow` gains `lineOfSight?:
WindowLineOfSight`.

## Data flow

```
build-occupancy.mjs (offline, corpus → committed src/metadata/occupancy/<zoneId>.json)
computeMatchMetrics:
  ... (subsystem 2 produces positionTracks) ...
  grid     = loadOccluderGrid(zoneId)                  // lineOfSight.ts
  disruptors = collectLosDisruptors(match)             // losDisruptors.ts
  losTimeline = computeLineOfSight(tracks, grid, disruptors)   // lineOfSight.ts
  windows  = addWindowLineOfSight(windows, tracks, grid, disruptors, ...)
  → MatchMetrics.lineOfSight / .losDisruptors; OffensiveWindow.lineOfSight
```

Non-invasive: `offensiveWindows.ts` / subsystem-2 modules are not modified;
LoS bolts on like `addWindowPositioning` did.

## Confidence & honesty

- `unknown` for arenas below the coverage floor (no fabricated geometry from
  sparse data).
- `approximate` for the 8 z-maps (no height).
- `likely-blocked` for mid-range integrated occlusion (graded, not brittle).
- Disruptors carry `modeled` (true only for smoke bomb); ice-wall/deep-breath are
  honest "potential disruption" flags.

Matches the undefined-when-unknowable convention of subsystems 1–2.

## Deferred (3-III / future)

- **Vector-fit** clean flat/curved wall geometry from dense occupancy (true
  diagonal precision; smaller data).
- **Z-axis** height model + slope/one-way edges for the 8 z-maps.
- **Precise ice-wall / deep-breath geometry** (vs the interim flags).
- **Friend-runs-the-rim** corpus supplement if occupancy coverage is thin on some
  arenas.

## Testing (TDD throughout)

- **Occupancy generator:** synthetic position cloud → walkable vs void
  classification; enclosed void → occluder, border-reachable void → ignored;
  void-ness gradient; denoise drops single-cell speckle; coverage/sampleCount
  populated.
- **LoS engine:** synthetic grid with a known central occluder → `blocked` for a
  ray through it, `clear` for a ray around it; integrated-occlusion thresholds
  (`likely-blocked` at a grazing ray); `unknown` with no grid / below confidence
  floor; supercover traversal correctness; `losAt` resolves via positionTracks.
- **Disruptors:** synthetic smoke-bomb cast + auras → membrane blocks
  affected-team in↔out, caster-team unaffected; ice-wall/deep-breath → flagged
  interval with `modeled:false`.
- **Wiring:** real fixture → `lineOfSight` + `losDisruptors` populated, window LoS
  annotated; render shows the LoS cell. Occluder-grid-overlaid-on-minimap
  validation is **manual/visual** (the log carries no LoS ground truth).

## Public/private & constraints

- `WAE_LOG_CORPUS` and all data locations via git-ignored config; no hardcoded
  paths. Committed occluder grids are derived generic arena geometry (not
  personal data), like `cooldowns.json` / `ccCategories.json`.
- Read-only ingestion of logs we already parse; **no game file/memory access**
  (ban-safe — the whole point of occupancy inference).

## Dependency / branch logistics

Depends on subsystem 2's `positionTracks` / `resolvePosition` / `distanceAt`,
which are on **PR #13 (open, not merged)**. Cleanest path: **merge PR #13 to
master first, then build subsystem 3 off master.** Until then this spec/plan can
land on its own branch, but implementation should rebase onto a master that
includes #13.

## Resolved decisions

- Occupancy-inferred occluders (no geometry sourcing / no zone-file extraction). ✅
- Raster now, **vector-fit deferred to 3-III** (also where true diagonals come from). ✅
- **Soft/graded void-ness** + integrated-occlusion LoS with a confidence result. ✅
- Z-maps: occupancy LoS tagged `approximate`; height/slopes deferred. ✅
- **LoS is a standalone timeline** (piggybacks positionTracks), not just a window
  field; it is also a go-*trigger* signal for the capstone. ✅
- Dynamic disruptors: **smoke bomb modeled** (membrane, caster-team-sees-through,
  affected-team in↔out blocked to anyone); **ice wall / deep breath flagged** as
  potential-disruption intervals. ✅
- Corpus = live retail Logs dir via `WAE_LOG_CORPUS`; committed grids; refreshable. ✅
- One phased spec for all of subsystem 3 (this document). ✅
