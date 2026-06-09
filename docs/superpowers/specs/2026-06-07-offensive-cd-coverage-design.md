# Offensive-CD Coverage (GO-track fidelity) — Design

**Date:** 2026-06-07
**Status:** approved-in-concept (diagnosis + decisions via session Q&A), pending spec review

## Problem (confirmed with data)

GO tracks (`attackerGoTracks`) and GO bands (`offensiveWindows`) both gate on
`isOffensiveCd(spellId)`, which checks **only a 16-ID "highlight" set** imported
from MiniCC (a *defensive*-awareness addon). Most DPS specs have **no** tracked
burst, so their per-attacker GO line is empty even during obvious bursts.

Evidence (match `ea8b4f49`, 3v3):

| Player | Spec | Damage | GO intervals | Why |
|---|---|---|---|---|
| Phluglishph (you) | Affliction | 7.6M | 0 | ramp spec, no burst aura |
| Morvx | Assassination | 4.7M | 0 | Deathmark/Shadow Blades not in set |
| Voidchaos | Destruction | 2.7M | 0 | no qualifying CD in set |
| Thankjake | Marksmanship | 4.6M | 4 ✓ | Trueshot (288613) is in the set |

The detection **mechanism** is sound: `auras.intervalsBy(unitId)` returns every
aura the unit *applied* (keyed by `srcId`) — self-buffs **and** target-debuffs
(e.g. a rogue's Deathmark). So expanding the ID set fixes every spec whose burst
applies an aura. Only **pet-summon** burst (no aura) needs a separate path.

`cooldowns.json bySpec` is all defensive (MiniCC's domain) — zero offensive
entries — so there is nothing to re-import; offensive coverage must be **built**.

## Decisions (session Q&A)

- **Coverage:** all specs, comprehensive.
- **What qualifies as a "go" CD:** offensive cooldown **≥ 30s** (1-min and 3-min
  CDs are the definite markers).
- **Pet-summons** (Summon Darkglare / Infernal / Demonic Tyrant / Army / Feral
  Spirit / Fire Elemental, etc.) count as go markers — a fixed window from the
  summon cast (no aura to read).
- **On-use damage trinkets** count (their on-use buff is an aura → already caught
  by the existing path once the buff ID is in the set).
- **Ramp specs** with no qualifying CD stay blank (the team GO **bands** still
  render from teammates' CDs). Affliction is the canonical case.

## Approach

### 1. Offensive-CD dataset (data-driven base + curated supplement)

A new `src/metadata/offensiveCooldowns.json`, the **union** of three sources:

1. **Vendor-extracted** — a generator (`scripts/import-offensive-cds.mjs`) pulls
   every `SpellTag.Offensive` entry from
   `vendor/wowarenalogs/packages/parser/src/classMetadata.ts` (56 distinct IDs).
   Re-runnable, like `import-cc-categories.mjs`.
2. **MiniCC 16** — the existing `offensiveSpellIds` (already current).
3. **Curated supplement** (`offensiveCooldowns.curated.json`) — current-retail
   (12.0.5) burst CDs the vendor data misses, hand-verified per spec, each with
   `{ name, cooldownSec, kind: 'buff' | 'debuff' | 'pet-summon', windowSec? }`.
   `kind: 'pet-summon'` entries carry an explicit `windowSec` (no aura to bound
   the window). Examples the vendor set lacks: Recklessness (1719), Deathmark
   (360194), Pillar of Frost (51271), Metamorphosis (191427), Dark Soul: Misery
   (113860) / Instability (113858), Summon Darkglare (205180), Summon Infernal
   (1122), Summon Demonic Tyrant (265187), Apocalypse, Coordinated Assault,
   Dragonrage (375087, already in MiniCC), Convoke, Feral Spirit, Fire Elemental.

`isOffensiveCd` consults the union (a `Set` built once at module load), replacing
the 16-only check. `OFFENSIVE_SPELL_IDS` stays for back-compat but is folded in.

The `≥30s` rule is the **curation criterion** for the supplement; the vendor
Offensive tag already encodes "major offensive CD", so the union approximates
"offensive CDs ≥30s" without needing a per-spell cooldown duration at detection
time (durations live in the curated rows for the window default + documentation).

### 2. Pet-summon go path (new, cast-based)

Pet-summons have no self-aura, so `intervalsBy` misses them. In
`computeAttackerGoTracks`, after the aura intervals, append **cast-derived**
intervals: for each of the player's `casts` whose `spellId` is a `pet-summon`
offensive CD, emit `[castSec, castSec + windowSec]` (clamped). This reuses the
already-collected `casts` map (no new scan). Buff/debuff CDs keep using the aura
interval (true active duration). De-dup/merge overlapping intervals per player.

### 3. Trinkets

On-use damage trinkets apply a buff aura; once their buff IDs are in the curated
set (`kind: 'buff'`), the existing aura path catches them — no new mechanism.
A small starter set of common PvP on-use trinket buffs; expandable.

## Out of scope (this increment)

- DoT-pressure "go" derivation for Affliction (the experimental option) — ramp
  specs stay blank for now, by decision.
- Per-spell cooldown-availability gating (whether the CD was *up*) — the GO track
  shows when it was *used*, which is the ask.

## Testing

- Generator parse test (vendor → IDs), like the cc-categories import test.
- `isOffensiveCd` resolves a roster of current burst CDs across specs
  (Recklessness, Deathmark, Pillar, Meta, Dark Soul, Trueshot, Combustion…) — a
  coverage test mirroring `ccCoverage.test.ts`.
- `computeAttackerGoTracks` emits a pet-summon window from a Darkglare cast (no
  aura) and still excludes healers; buff/debuff CDs unchanged.

## Additional detail-view scope (session add-ons)

These ship alongside the coverage work (decisions captured via session Q&A).

### B. GO-track hover shows the ability used
Each GO segment currently hovers as "Name GO · a–b s" with no ability. Carry the
spell name onto each interval: `AttackerGoTrack.intervals[]` gains `spell?: string`
(from `iv.name`; pet-summon path uses the summon's cast name). `GoTracks.tsx`
renders it in the segment `title` ("Recklessness · 12–24s"). No merge — each
offensive aura/summon is its own segment, so one spell per segment.

### C. Range track rework (revised 2026-06-09, user direction)
The cramped 60px lane becomes a **spacious dedicated track** built on a new
**reusable time-series chart primitive**:

- **`TimeSeriesChart` primitive** (`web/src/components/TimeSeriesChart.tsx`):
  generic over-time graph — multiple superimposable series (null-break
  segmentation preserved), **dotted horizontal threshold lines** with labels,
  and a **hover tooltip** that snaps to the nearest data timestamp **at or
  before** the cursor and shows `t` plus each visible series' value. This
  primitive will later render DPS-over-time and other over-time metrics
  (wowarenalogs-style), so nothing range-specific lives in it.
- **`RangeTrack`** (replaces `RangeLane`): tall (~220px) with dotted cut-off
  lines at **8 / 10 / 20 / 30 / 40 yd**, each labeled. The single-target
  dropdown becomes a **multi-select** (toggle chips, one per player target +
  the Demon Circle anchor); selected paths are **superimposed**, each in the
  target's class color — so kiting can be read at a glance (e.g. range to my
  healer falling while range to enemy melee grows). Default selection = the
  primary threat. Hover shows the timestamp + every selected series' range so
  event sequences are reconstructible.

### C2. Vendor false-positive pruning (found live, 2026-06-08)
The vendor `SpellTag.Offensive` set violates the ≥30s-burst criterion for some
ids — Shadowstep (36554) floods the rogue GO track with mobility segments;
also Premeditation, Shadowy Duel, legacy Cold Blood / Presence of Mind ids,
arena-unusable Bloodlust/Heroism, and healing/tank variants (Avenging Wrath
(Holy) 31842, Ascendance (Restoration) 114052, Incarnation: Guardian 102558,
Metamorphosis (Vengeance) 187827). Fix: a curated **denylist**
(`offensiveCds.deny.json`, id → reason) subtracted from the union — the vendor
data has no cooldown durations to gate on, so an explicit list is the simplest
honest filter.

### D. Settings tab (persistent, read-only)
A permanent viewer tab listing **what the analysis considers**: offensive CDs
(id, name, cooldownSec, kind), CC (id, name, DR category), and defensive/external
CDs — grouped by category. Sourced from the metadata via a new read-only
`GET /api/metadata` endpoint (offensive set + CC categories + cooldown registry).
Read-only for now; editing/persisting a user override set is future.

### E. GO-band safety coloring (defender-perspective, both bands)
Replace the binary green/red tint with a **favorability ratio** from the
recording player's perspective:

```
relevant(team)  = (we are DEFENDING this go) ? defensives-available
                : (we are ATTACKING this go) ? offense-available
our_favor       = (1 + our_relevant) / (1 + their_relevant)   // (1+x)/(1+y), no div-by-0
```

- Enemy go (we defend): `our_favor = (1 + our defensives up) / (1 + their offense up)`.
- Our go (we attack): `our_favor = (1 + our offense up) / (1 + their defensives up)`.

High `our_favor` → **green** (favored), low → **red** (RED·Orange·Yellow·Blue·GREEN
scale). The window already carries the **defenders' available mitigation**
(`mitigation.available`); add `attackerOffenseAvailableCount` per window
(attacking team's offensive CDs not on cooldown at window start, via the existing
`isAvailable` machinery + the new offensive dataset's `cooldownSec`). The band's
`title`/click panel shows the ratio inputs so the color is legible.

## Rollout

Changing the offensive set changes stored `attackerGoTracks` **and**
`offensiveWindows` (bands) → a **re-ingest** is required. Phaseable:
- **Phase 1:** offensive dataset + `isOffensiveCd` union + GO-hover ability name
  (B). Re-ingest → most DPS lines populate with named segments.
- **Phase 2:** pet-summon cast path + trinkets (the no-aura cases).
- **Phase 3:** range lane 3× + gridlines (C); GO-band safety coloring (E,
  needs `attackerOffenseAvailableCount`). Re-ingest for E.
- **Phase 4:** Settings tab (D) — `/api/metadata` + read-only web tab (no re-ingest).
