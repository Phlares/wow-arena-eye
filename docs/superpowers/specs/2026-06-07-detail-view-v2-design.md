# Detail View v2 — Design Spec

**Status:** design locked pending review (2026-06-07)
**Sub-project:** an upgrade batch over the timeline detail view (B, PR #21) and the comparative
scorecard (C1, PR #22), folding in direct user feedback after running them live.
**Depends on:** the metric battery (`src/metrics/`), the store (`src/store/`), the viewer
(`src/viewer/`, `web/`) — all on master (+ #22 once merged).

## Goal

Make the per-match detail view genuinely readable and analytical: a player roster, a redesigned
**per-attacker GO-window** visualization (class-colored tracks, your team vs theirs), polarity-aware
scorecard coloring, split kick lanes, a reassignable range lane, death→preceding-damage on hover,
and CC-metadata coverage fixes. Delivered as **three chunky phases** in one plan; each phase is a
self-contained, shippable PR.

## Phases

- **DV2-a — quick wins + scorecard polish** (mostly UI; data already present)
- **DV2-b — GO-window redesign** (per-attacker class-colored tracks; the analytical heart)
- **DV2-c — interactions + new data** (reassignable range, death-hover damage, CC metadata)

The **safety-opacity overlay** (the `(1+x)/(1+y)` mitigation-vs-offense band) is explicitly
**deferred** to a later increment (DV2-d) — DV2-b lays the per-attacker track substrate it needs.

---

## DV2-a — Quick wins + scorecard polish

### 1. Player roster
A roster strip at the top of the detail overlay: all combatants grouped by team (yours / enemy),
each as a **class-colored** chip showing name + spec label. Data is already in the persisted
`MatchMetrics.teams[].players[].player` (`name`, `spec`, `team`) — no new computation. Healer marked
(spec ∈ `HEALER_SPEC_IDS`).

### 2. Class color map (shared substrate)
New `src/metadata/classColors.ts`: the canonical WoW class→hex map, plus `classColorOfSpec(spec)`
(spec → className via `specs.json` → color). Mirrored to `web/` (small static map). Used by the
roster, the GO tracks (DV2-b), and any class-colored UI. Unknown spec → a neutral gray.

### 3. Kicks split into two lanes
The single "Kicks" lane becomes **two** lanes — **"Kicks landed"** (interrupt events where you are
the source) and **"Kicks taken"** (interrupt events where you are the target). The timeline already
carries `interrupt` events with `unitId` + `targetId` (PR #21), so this is a `LANES`-table change in
`Timeline.tsx`.

### 4. GO-window friendly/enemy coloring (interim, until DV2-b)
Until the per-attacker redesign lands, color the existing window bands by **`attackingTeam`**
(green = your offense, red = enemy offense) instead of the current handled/lethal (death-in-window)
rule. Small change; superseded by DV2-b but worth it immediately.

### 5. Range lane label
Label the range lane with what it measures: "Range to <unit name> (yd)". Default stays the
top-damage enemy (made selectable in DV2-c). A horizontal-line legend for the 8-yd melee reference.

### 5b. Global text scaling (~2×)
The viewer text is too small. Scale the whole UI up ~1.7–2× (root font-size bump + a proportional
audit of the few hard-coded px: timeline lane-label widths/offsets, table padding, control sizing).
Pure CSS; whole-app, not just the detail view.

### 6. Scorecard verdict polish (C1 follow-up)
- **`vs avg` shows the signed delta** (`value − mean`), formatted (`+0.3M/min`, `−2`), not the raw
  mean.
- **Color by good/bad (polarity-aware)**: the verdict cell is green for `better`, red for `worse`,
  neutral for `average`/`descriptive` — derived from polarity, so "fewer deaths" (a negative delta)
  reads green/good, not red. The signed-delta number itself is neutral-colored (the verdict carries
  the good/bad signal). Win/loss lean keeps its existing green/red.

---

## DV2-b — GO-window redesign (per-attacker class-colored tracks)

Replaces the single merged band with **per-attacker GO tracks**.

### 7. Per-attacker offensive windows (metrics)
New `OffensiveWindow`-adjacent output: **per-player offensive intervals** = the union of each
attacker's own offensive-cooldown-active aura intervals (`auraState.intervalsBy(playerId)` filtered
to `isOffensiveCd`, clamped to match end — the same primitives the team-merged
`computeOffensiveWindows` already uses). Emitted as `MatchMetrics.attackerGoTracks: { unitId, team,
spec, intervals: {startSec, endSec}[] }[]` for every **attacker** (a player whose spec ∉
`HEALER_SPEC_IDS`). Healers excluded (they don't "go"). Persisted in the detail blob.

### 8. Four-track layout (web)
Beneath the event lanes, a **GO-track band**: solid **class-colored** lines, one per attacker —
**enemy attackers on the top rows, your attackers on the bottom rows** (≤2 each for standard 3v3;
if a side has >2 attackers, show the top-2 by in-window damage and fold the rest with a "+N"
note). Each line is filled across that attacker's GO intervals (`attackerGoTracks`). Hovering a
segment shows the opening cooldowns (`openedBy`, joined from the team window) + the attacker name.

### 9. Whose-CDs alignment + which-enemy
Because tracks are now per-attacker and colored by the attacker's class, "whose GO" and "which
enemy (or both)" are read directly off the layout: two lit enemy tracks at once = both enemies
going; one = a solo go. The click-to-expand `WindowPanel` (still keyed off the team-merged windows
for severity/mitigation) gains a per-attacker damage breakdown from `damageByTarget`.

### Deferred to DV2-d (noted, not built): safety-opacity overlay
A full-width band tinted on a red→orange→yellow→blue→green scale by a **safety ratio**
`(1 + Σ your available defensive mitigation) / (1 + Σ their available offensive/counter-mitigation)`
sampled over time (the `1+x / 1+y` form avoids divide-by-zero). The mitigation/offense availability
series come from the cooldown model (`readyIntervals`/`cdUsage`). DV2-b's per-attacker substrate +
the existing per-window `mitigation.available` are the inputs; the time-sampled ratio band is its
own increment.

---

## DV2-c — Interactions + new data

### 10. Reassignable range target
The range lane gets a small selector: measure distance from **you** to any chosen unit — **any of
the other five players** (roster picker) or your **anchor** (Demon Circle position). All units'
`positionTracks` are already in the detail blob, so the series is recomputed **client-side** via a
ported `distanceAt` (or a tiny SPA-side distance helper over the stored samples). The **anchor**
option uses the Demon Circle cast position: `repositioning.ts` `ANCHOR_ABILITIES` (Demon Circle
48018 → return 48020); the detail endpoint exposes the player's anchor placements
(`{tSec, x, y}[]`) so "range to anchor" measures distance to the most-recent anchor.

### 11. Death → preceding damage (metrics + UI)
New per-death capture: for each `death` event, the **damage events in the preceding ~5 s**
(attacker, spell, amount, tSec), from the existing `DAMAGE_EVENTS` accessors. Emitted as
`MatchMetrics`/timeline `deathBlows: { victimId, tSec, recent: { srcName, spell, amount, tSec }[] }`
(cap the list, e.g. last 12 hits). The death lane's hover tooltip renders this "what killed me"
list. Window = 5 s (configurable const).

### 12. CC metadata coverage
Audit + expand the CC metadata so the CC lane is complete: add **Succubus Seduction (6358)** and
any other missing player CC (verify against the spec's CC roster). The generator
(`scripts/import-cc-categories.mjs`) is DB-derived (114 spells); gaps are filled in the curated
fallback (`spells.curated.json`). Verify **Fear (5782)** already emits (it's in the curated fallback)
and fix if not. A small fixture test asserts a known set (Fear, Seduction, Polymorph, Hex,
Hammer of Justice, …) all resolve via `ccInfo`.

### LoS lane — keep
No change beyond keeping the lane (it populates only when a real LoS disruptor occurred —
smoke bomb / ice wall / deep breath; usually empty, which is honest).

---

## Architecture (by layer)

- **`src/metadata/`** — `classColors.ts` (class→hex + `classColorOfSpec`); CC curated additions.
- **`src/metrics/`** — `attackerGoTracks` (per-attacker offensive intervals, DV2-b); `deathBlows`
  (per-death preceding damage, DV2-c); both added to `MatchMetrics` and the persisted blob → **a
  re-ingest is required** for DV2-b and DV2-c (DV2-a needs none).
- **`src/viewer/`** — detail endpoint exposes `attackerGoTracks`, `deathBlows`, and anchor
  positions; range series stays for the default but the SPA can recompute for a chosen target.
- **`web/src/`** — roster, class colors, split kick lanes, range label + target selector,
  GO-track band, death-hover tooltip; `ScorecardTable` verdict coloring + signed delta.

## Re-ingest

DV2-a: none. DV2-b + DV2-c: a one-time re-ingest each (new persisted `attackerGoTracks` /
`deathBlows`). Idempotent, as before.

## Error handling

- Missing/unknown spec → neutral class color; missing healer → roster shows none.
- A side with 0 or >2 attackers → render what's present (top-2 + "+N"); never assume exactly 2.
- No `positionTracks` for a chosen range target → the lane shows "no position data".
- A death with no preceding damage (e.g. a leave/forfeit) → empty hover list.
- Pre-v2 detail blobs (no `attackerGoTracks`/`deathBlows`) → the GO-track band / death hover show a
  "re-ingest for this view" hint, consistent with the existing detail empty-state.

## Testing (TDD throughout)

- **Metrics:** `attackerGoTracks` = per-attacker offensive intervals, healers excluded, clamped;
  `deathBlows` = the right preceding-damage window per death, capped, attacker/spell/amount correct.
- **Metadata:** `classColorOfSpec` maps specs→class colors; `ccInfo` resolves the expanded CC set
  (Seduction, Fear, …).
- **Store/viewer:** the new fields persist + serve in the detail payload; anchor positions exposed.
- **Web:** roster renders class-colored chips with specs; two kick lanes; GO-track band places
  per-attacker class-colored segments (enemy top / friendly bottom); range selector switches target
  and relabels; death hover lists preceding hits; `ScorecardTable` colors verdicts polarity-aware +
  shows signed deltas.

## Explicitly NOT in this batch (deferred)

- The **safety-opacity overlay** (`(1+x)/(1+y)` mitigation-vs-offense band) — DV2-d.
- **Spec/comp as spec ICONS** (instead of text labels) — needs vendored spec-icon assets; a later
  polish increment.
- C2 (trend charts), C3 (two-match diff), the GO verdict-synthesis capstone, the spellId→name table
  for cooldown labels.

## Self-review notes

- *Placeholders:* none — each item names its data source (existing field or new metric), the
  GO-window redesign is concrete (per-attacker offensive intervals + class colors + 4-track layout),
  and the deferred overlay's formula is recorded.
- *Consistency:* class colors are one shared map (roster + GO tracks); "attacker" = non-healer
  player everywhere; re-ingest required only for the two new persisted metrics.
- *Scope:* three shippable phases; the opacity overlay and the comparison/capstone work are
  explicitly out.
- *Ambiguity:* verdict coloring = polarity-aware good/bad (not literal sign); GO tracks = per
  attacker, class-colored, enemy-top/friendly-bottom; range target = any of the 6 units or the
  Demon Circle anchor — each made explicit.
