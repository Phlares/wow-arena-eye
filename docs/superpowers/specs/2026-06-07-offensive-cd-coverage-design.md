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

## Rollout

Changing the offensive set changes stored `attackerGoTracks` **and**
`offensiveWindows` (bands) → a **re-ingest** is required. Phaseable:
- **Phase 1:** dataset + `isOffensiveCd` union (fixes all aura-based burst CDs —
  the bulk). Re-ingest → most DPS lines populate.
- **Phase 2:** pet-summon cast path + trinkets (the no-aura cases).
