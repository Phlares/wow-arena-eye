# Metric Battery — Phases 4–6 + Position/HP Time-Series + Spell-Metadata

**Date:** 2026-05-30
**Status:** Approved design, pre-implementation. Large batch (user favors chunky specs).
**Builds on:** Phases 1–3 (per-unit model, PR #4) + the review-pass hardening (PR #5).

---

## 1. What this is

Completes the analytical battery on top of the per-unit model: a retained
**position/HP time-series**, a **spell-metadata table**, and Phases **4
(suffered + defensives)**, **5 (damage/healing attribution)**, **6
(coordination/targeting)**.

Two standing principles from the user, applied throughout:
- **The report is NOT a UI** — it exists to *validate data inputs/outputs*. New
  data gets **lean, functional report surfacing** (enough to eyeball/verify),
  not polished display. The full position track is NOT inlined.
- **Metadata starts curated** (a small hand-authored JSON in the final shape),
  with a documented **living-source refresh path** (DRList-1.0 + BigDebuffs +
  OmniBar, validated against wago.tools) — built later, not this cycle.

Everything is computed from `match.events` + `match.units` (the wowarenalogs
parser output) behind the existing per-unit/registry seams.

## 2. A. Position/HP time-series

Extend the per-unit pass to **retain** the ordered samples it currently
discards (Phase 3 keeps only aggregates).

- `Sample = { tSec: number; x: number; y: number; facing?: number; hpPct?: number }`, captured from advanced events (`advancedActorPositionX/Y`, `advancedActorFacing`, `advancedActorCurrentHp/MaxHp`). Raw world coords (X-negation is a render concern, noted for the future replay).
- `UnitMetrics` gains `track: Sample[]` (sorted by `tSec`). Aggregates (`distanceMoved`/`positionSamples`/`timeStationarySec`) stay, derived from the track.
- New helper `sampleAt(track, tSec): Sample | undefined` — binary-search the bracketing samples, **lerp position, step-hold hpPct** (from wowarenalogs' replay approach). Reused by Phase 4 (HP/position at death/burst) and the future replay.
- **Size handling:** the track is large (hundreds of samples/unit). It is **not** inlined in the HTML report. Instead the `view` CLI writes a compact **replay-data JSON** per match to `output/replay/<matchId>.json` (git-ignored) for the future replay UI to consume. The report shows only the existing movement aggregates.

## 3. B. Spell-metadata table

`src/metadata/spells.ts` + `src/metadata/spells.curated.json` — a hand-curated
seed in the final record shape, loaded once.

```ts
type SpellTag = 'interrupt' | 'cc' | 'defensive' | 'immunity' | 'offensive';
type DrCategory = 'stun' | 'incapacitate' | 'disorient' | 'silence' | 'root' | 'knockback' | 'fear' | 'disarm';
interface SpellMeta { name: string; tags: SpellTag[]; ccCategory?: DrCategory; drCategory?: DrCategory; priority?: number; }
// JSON: { [spellId: string]: SpellMeta }
```
Helpers: `spellMeta(id): SpellMeta | undefined`, `isInterrupt(id)`, `ccInfo(id): {category, dr} | undefined`, `isDefensive(id)`. Lookups also accept spell **name** as a fallback (events carry both id and name; some matching is by name).

**Seed scope (this cycle):** the stable arena set — interrupts (Kick 1766, Counterspell 2139, Pummel 6552, Mind Freeze 47528, Wind Shear 57994, Spell Lock 19647, Skull Bash 106839, Rebuke 96231, Disrupt 183752, Solar Beam, Silence, …); common CC with DR category (Polymorph→incapacitate, Fear→fear, Cyclone→disorient(cyclone), Hex→incapacitate, Hammer of Justice→stun, Kidney Shot 408→stun, Cheap Shot→stun, Blind→disorient, Sap→incapacitate, stuns/incaps/silences/roots); common defensives (Ice Block, Divine Shield, Cloak of Shadows, Dispersion, Unending Resolve, Dark Pact, Barkskin, …). The seed is explicitly **partial and grows**.

**Living-source refresh path (documented; built later — NOT this cycle):** a build-time generator that parses **DRList-1.0** `Spells.lua` (MIT, `github.com/wardz/DRList-1.0`, spellID→DR category — authoritative for DR), **BigDebuffs** `Spells/Standard.lua` (CC/defensive/immunity/interrupt + priority tiers; retail file is a temporary Midnight stub — fall back to OmniBar/Mists until repopulated), and **OmniBar** `OmniBar_Mainline.lua` (interrupts + lockouts), then validates IDs/names against **wago.tools** CSV (`https://wago.tools/db2/SpellName/csv?build=<current>`, build list at `/api/builds`) and emits `spells.generated.json`. Parse Lua via `wasmoon`/regex. Refresh per minor patch; spellIDs are stable within a patch (new IDs added at major patches, old IDs rarely repurposed).

## 4. Cross-cutting: aura-state tracker

`src/metrics/auraState.ts` — replays `SPELL_AURA_APPLIED` / `SPELL_AURA_REMOVED`
(/`_DOSE`/`_REFRESH`) to maintain, per unit, the set of currently-active auras,
and answers `aurasActiveOn(unitId, tSec): {spellId, name, since}[]`. The
primitive behind deaths-while-CC'd and CC-uptime. Built as a pre-pass producing
a queryable structure (interval list per unit per aura).

## 5. Phase 4 — Suffered + defensives (per unit)

Extends `UnitMetrics`:
- **Suffered** (by dest): `interruptsSuffered` (+ what got kicked), `ccTaken` (count + by DR category + total `ccDurationSec`) — a CC is an aura whose spell `ccInfo()` is defined, applied with the unit as dest.
- **deathsWhileCcd**: at each death (`UNIT_DIED` dest=unit), query the aura-state tracker at that `tSec`; if a CC aura was active, increment + record which.
- **Defensives**: `defensivesUsed` (count + by spell) — `SPELL_CAST_SUCCESS` by the unit where `isDefensive(spell)`; plus `defensivesIntoBurst` — a defensive cast is "into burst" if, in the window [t−2s, t+1s], the unit's `hpPct` (via `sampleAt`) dropped sharply OR incoming damage spiked (using the unit's incoming damage in that window). Approximate; the coaching signal for good/late defensive timing.

## 6. Phase 5 — Damage/healing attribution + exclusions (per unit, + combined)

- New `amount(ev): number` accessor (the damage/heal amount field; discovered via TDD like the others — likely `amount`/`effectiveAmount`, plus absorbed/overkill fields).
- Per unit: `damageDone`, `healingDone`, `absorbDone`, `dps`/`hps` (vs `durationInSeconds`). Sum over `SPELL_DAMAGE`/`SPELL_PERIODIC_DAMAGE`/`SWING_DAMAGE`(_LANDED)` and `SPELL_HEAL`/`SPELL_PERIODIC_HEAL` by source.
- **Exclusion rules** (parity with old build): exclude **friendly-fire** (source and dest on the same team) and **ally totem/guardian self/own-team** damage; **include** damage to enemy summons. Implemented team-aware using `unit.team` of source vs dest.
- `CombinedTotals` gains `damageDone`/`healingDone` (player + pets) — the meaningful per-player throughput.

## 7. Phase 6 — Coordination/targeting (per team)

`src/metrics/coordination.ts` consuming Phase 5 damage events:
- **Target priority**: per enemy target, total damage taken from the team (who the team focused) + the player's own target distribution.
- **Focus-fire windows**: count windows where ≥2 of a team's members damage the same enemy within W seconds (default 3s) — a coordination proxy.
- **Healer pressure**: damage + CC directed at enemy healers (healer identified by spec/role from `unit.spec`).
- **Swap timing**: changes in the team's primary target over time (from the focus stream).
- Output a per-team `CoordinationSummary { targetPriority[], focusFireWindows, healerPressure, swaps }`. `MatchMetrics` gains `coordination: { friendly, enemy }` (or per-`TeamGroup`).

## 8. Data shapes (additions)

`UnitMetrics` += `track: Sample[]`, `interruptsSuffered`, `interruptsSufferedBySpell`, `ccTaken`, `ccTakenByCategory`, `ccDurationSec`, `deathsWhileCcd`, `deathsWhileCcdBySpell`, `defensivesUsed`, `defensivesUsedBySpell`, `defensivesIntoBurst`, `damageDone`, `healingDone`, `absorbDone`, `dps`, `hps`.
`CombinedTotals` += `damageDone`, `healingDone`.
`MatchMetrics` += `coordination?: { team: Team; summary: CoordinationSummary }[]`.
New: `Sample`, `SpellMeta`/`SpellTag`/`DrCategory`, `CoordinationSummary`.

## 9. File structure (build-now)

```
src/metadata/spells.ts + spells.curated.json   # metadata table + loader + helpers
src/metrics/sampleAt.ts                          # track lerp/step-hold lookup (+ Sample type in types.ts)
src/metrics/auraState.ts                         # aura interval tracker
src/metrics/perUnit.ts        # MODIFIED: retain track; suffered/cc/deaths-while-cc/defensives; damage/healing+exclusions
src/metrics/coordination.ts                      # Phase 6
src/metrics/metrics.ts        # MODIFIED: orchestrate + attach coordination
src/metrics/eventAccess.ts    # MODIFIED: add amount(ev)
src/metrics/types.ts          # MODIFIED: the new shapes
src/view/renderMetrics.ts     # NEW: metrics rendering extracted from renderReport (deferred /simplify note, well-timed)
src/view/renderReport.ts      # MODIFIED: delegate to renderMetrics; LEAN validation rows for new metrics
src/cli/view.ts               # MODIFIED: write output/replay/<matchId>.json
```
Extracting `renderMetrics.ts` now (the deferred /simplify finding) keeps the
growing render code focused as Phases 4–6 add rows.

## 10. Report surfacing (LEAN — validation, not UI)

Per the user: the report validates data, it is not a UI. So additions are
minimal/functional:
- Per-player rows gain compact columns: dmg/heal (DPS/HPS), CC taken, deaths-while-CC'd, defensives (used/into-burst). Combined headline gains dmg/heal.
- A small per-team **coordination** line (focus-fire windows, top focused target, healer pressure).
- Position track is NOT shown — only the existing movement aggregates; the track goes to the replay JSON.
Keep it terse; the goal is to eyeball that the numbers are right.

## 11. Error handling

- Missing metadata for a spell → treated as untagged (not interrupt/cc/defensive); never throws. Seed is partial by design.
- `amount`/position/HP fields absent → contribute 0 / no sample.
- Aura applied without a matching removed (still active at match end) → treated as active through match end.
- Exclusion: unknown team (`neutral`) damage is counted as-is (not excluded) and flagged in aggregate.
- Empty/zero cases render cleanly; replay JSON for a match with no positions is written with empty tracks.

## 12. Testing

Per-module synthetic unit tests: `sampleAt` (lerp/step-hold/bracket edges), `auraState` (active-at-T, still-active-at-end), Phase 4 (cc-taken by category, deaths-while-CC'd via aura-state, defensive-into-burst with a synthetic HP drop), Phase 5 (damage/heal sums, friendly-fire & totem exclusion, enemy-summon inclusion, DPS), Phase 6 (focus-fire window detection, target priority, healer pressure), metadata helpers. **Fixture golden re-assertions**: your damage/healing > 0, ccTaken plausible, deaths-while-CC'd computed, a coordination summary present, replay JSON written and non-empty.

## 13. Deferred (documented; NOT this cycle)

- **Replay UI** — its own visual spec, informed by the wowarenalogs research: `zoneMetadata` (arena id → background image + world bounds `minX/minY/maxX/maxY`), world→pixel transform (negate X, ~5px/yard), pixi/canvas, lerp playback off the replay JSON, timeline scrubber, "jump to first blood". The replay JSON this cycle produces is its input.
- **Metadata generator** — the DRList/BigDebuffs/OmniBar + wago.tools build-time generator (§3). This cycle ships the curated seed; the generator refreshes/expands it.
- **DR tracking** (diminishing-returns state over a match) — the metadata carries DR categories; modeling DR application/decay is a later refinement.

## 14. Scope / plan note

This is large (≈14–16 tasks). The plan stages it: types/Sample → sampleAt → spell-metadata table → auraState → Phase 4 → amount accessor + Phase 5 → Phase 6 → renderMetrics extraction + lean report → replay-JSON export + golden. Each stage is independently testable; several validate against the real fixture. The build proceeds subagent-driven with per-task review + the /simplify and /code-review gates at the end.
