# Offensive-CD Coverage + Detail Polish — Implementation Plan

> **For agentic workers:** TDD per task; commit per task; bodies end
> `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Root SQLite tests:
> `NODE_OPTIONS=--experimental-sqlite npx vitest run <file> --no-file-parallelism`. Web tests inside `web/`.
> Local imports end `.js`. **Ship a PR + re-ingest at the end of each phase.**

**Goal:** Make GO tracks/bands reflect real burst by expanding offensive-CD coverage to all specs;
add GO-segment ability hover, taller/gridded range lane, a read-only Settings tab, and meaningful
GO-band safety coloring.

**Spec:** `docs/superpowers/specs/2026-06-07-offensive-cd-coverage-design.md`

**Branch:** `feat/offensive-cd-coverage` off `feat/detail-view-v2` (stacked on #23).

---

# Phase 1 — Offensive dataset + isOffensiveCd union + GO-hover ability (RE-INGEST)

### Task 1: Vendor offensive-CD generator
**Files:** Create `scripts/import-offensive-cds.mjs`, `src/metadata/offensiveCds.json`. Test: `test/importOffensiveCds.test.ts`
- [ ] Test: a `parseOffensive(src)` pulls `{spellId,name}` for every `tags:[...Offensive...]` entry from a classMetadata.ts snippet; returns ≥1.
- [ ] Implement parser (regex `spellId:\s*'(\d+)',\s*name:\s*'([^']*)',\s*tags:\s*\[([^\]]*)\]` filter `/Offensive/`), dedup by id, write `{ source, ids:[{id,name}] }`. Run it against the real vendor file to emit `offensiveCds.json` (~56 ids).
- [ ] Commit `feat(metadata): generate vendor offensive-CD set from classMetadata`.

### Task 2: Curated current-retail supplement
**Files:** Create `src/metadata/offensiveCds.curated.json`. Test: extend `test/ccCoverage.test.ts` sibling `test/offensiveCoverage.test.ts`
- [ ] Test (`offensiveCoverage.test.ts`): `isOffensiveCd(id)` is true for a roster of current burst CDs across specs — Recklessness(1719), Deathmark(360194), Pillar of Frost(51271), Metamorphosis(191427), Dark Soul: Misery(113860), Dark Soul: Instability(113858), Trueshot(288613), Combustion(190319), Avenging Wrath(31884), Celestial Alignment(194223), Ascendance(114050), Void Eruption(228260), Storm Earth and Fire(137639), Dragonrage(375087).
- [ ] Run → FAIL for the uncovered ones.
- [ ] Author `offensiveCds.curated.json`: each `{ "<id>": { "name", "cooldownSec", "kind": "buff|debuff|pet-summon", "windowSec"? } }` for current-retail burst CDs ≥30s the vendor set misses (per-spec, hand-verified). Include pet-summons with `windowSec` (Darkglare 205180/20, Infernal 1122/30, Demonic Tyrant 265187/15, Army 42650/30, Feral Spirit 51533/15, Fire Elemental 198067/30) — used in Phase 2.
- [ ] Commit `feat(metadata): curated current-retail offensive-CD supplement`.

### Task 3: isOffensiveCd consults the union
**Files:** Modify `src/metadata/cooldowns.ts`. Test: `test/offensiveCoverage.test.ts` (Task 2) now passes.
- [ ] In cooldowns.ts: build `OFFENSIVE_SET = new Set([...DATA.offensiveSpellIds, ...offensiveCds.json ids, ...keys(curated)])` at load; `isOffensiveCd(id) = OFFENSIVE_SET.has(id)`. Export a `offensiveCdMeta(id)` returning the curated row (name/cooldownSec/kind/windowSec) or undefined (used by Phase 2/3).
- [ ] Run → PASS. tsc.
- [ ] Commit `feat(metadata): isOffensiveCd consults vendor+MiniCC+curated union`.

### Task 4: GO segment carries ability name
**Files:** Modify `src/metrics/types.ts` (`AttackerGoTrack.intervals[]` gains `spell?`), `src/metrics/attackerGoTracks.ts`, `src/viewer/queries.ts` (buildGoTracks passthrough), `web/src/api.ts` (GoTrack interval `spell?`), `web/src/components/GoTracks.tsx` (title). Tests: `test/attackerGoTracks.test.ts`, `web/src/components/GoTracks.test.tsx`.
- [ ] Root test: an offensive interval emits `spell` = the aura name. Web test: segment `title` includes the spell.
- [ ] Implement: map keeps `spell: iv.name`; web title `${name} · ${spell} · a–b s`.
- [ ] PASS both; tsc both.
- [ ] Commit `feat: GO segments carry + hover the ability used`.

### Task P1-FINISH
- [ ] Full root + web suites, tsc both, vite build.
- [ ] **Re-ingest** → most DPS GO lines populate, hover shows the ability.
- [ ] `/simplify` + `/code-review` (Phase-1 diff); address.
- [ ] Push branch; open PR.

---

# Phase 1.5 — Vendor false-positive pruning (RE-INGEST) — added 2026-06-09

### Task 4b: Offensive denylist
**Files:** Create `src/metadata/offensiveCds.deny.json`; modify `src/metadata/cooldowns.ts`. Test: `test/offensiveCoverage.test.ts`.
- [ ] Test: `isOffensiveCd(36554)` (Shadowstep) is **false**; Deathmark/Trueshot still true; every denied id has a reason string.
- [ ] Author denylist (mobility/utility/legacy + healing/tank variants, see spec C2); subtract from `OFFENSIVE_SPELL_IDS` at load.
- [ ] PASS; tsc; re-ingest; commit `fix(metadata): denylist vendor offensive false-positives (Shadowstep et al.)`.

# Phase 2 — Pet-summon cast path + trinkets (RE-INGEST)

### Task 5: Pet-summon go intervals (cast-based)
**Files:** Modify `src/metrics/attackerGoTracks.ts` (take `casts`), `src/metrics/metrics.ts` (pass casts). Test: `test/attackerGoTracks.test.ts`.
- [ ] Test: a player with a Summon Darkglare(205180) cast (no aura) gets a `[castSec, castSec+windowSec]` interval labeled with the summon name; healer still excluded; buff/debuff unchanged.
- [ ] Implement: after aura intervals, for each `casts.get(unitId)` whose `offensiveCdMeta(spellId)?.kind==='pet-summon'`, push `{startSec, endSec: startSec+windowSec, spell:name}` (clamped); merge/sort.
- [ ] PASS; tsc.
- [ ] Commit `feat(metrics): pet-summon GO segments (cast-based, no aura)`.

### Task 6: On-use trinket buffs
**Files:** add common PvP on-use damage-trinket buff ids (`kind:'buff'`) to `offensiveCds.curated.json`. Test: extend offensiveCoverage.
- [ ] Test: a known on-use trinket buff id resolves `isOffensiveCd`.
- [ ] Add ids; commit `feat(metadata): on-use damage trinkets as offensive CDs`.

### Task P2-FINISH: suites + re-ingest + /simplify + /code-review + push.

---

# Phase 3 — Range polish + GO-band safety coloring (RE-INGEST for E)

### Task 7a: TimeSeriesChart primitive (revised 2026-06-09 — see spec C)
**Files:** Create `web/src/components/TimeSeriesChart.tsx`. Test: `TimeSeriesChart.test.tsx`.
- [ ] Test: renders N superimposed series (null-break segmentation); dotted threshold lines (`stroke-dasharray`) with labels; mousemove → tooltip shows nearest-at-or-before timestamp + each series' value; mouseleave hides it.
- [ ] Implement generic `{ series: {id,label,color,points:{tSec,v|null}[]}[], thresholds: {value,label}[], matchEnd, yMax, height, unit }`. Nothing range-specific (reused later for DPS-over-time).
- [ ] PASS; tsc; commit `feat(web): TimeSeriesChart primitive (thresholds + multi-series + hover readout)`.

### Task 7b: RangeTrack multi-select rework (replaces RangeLane)
**Files:** Create `web/src/components/RangeTrack.tsx`; modify `Timeline.tsx`, `web/src/styles.css`; delete `RangeLane.tsx`. Test: `RangeTrack.test.tsx`.
- [ ] Test: chips per target (+anchor); default = primary threat; toggling adds/removes a superimposed class-colored path; dotted cut-offs at 8/10/20/30/40 yd labeled; tall (~220).
- [ ] Implement on top of TimeSeriesChart; remove RangeLane.
- [ ] PASS; tsc; commit `feat(web): RangeTrack — spacious multi-select superimposed range chart`.

### Task 8: attackerOffenseAvailableCount per window
**Files:** `src/metrics/types.ts` (OffensiveWindow gains `attackerOffenseAvailableCount: number`), `src/metrics/offensiveWindows.ts`. Test: `test/offensiveWindows.test.ts`.
- [ ] Test: a window where the attacking team has an offensive CD off-cooldown at start counts it; on-cooldown excluded.
- [ ] Implement: for attackers (players on `w.team`), count `offensiveCdMeta`-known offensive CDs `isAvailable(castMs, cooldownMs, charges, w.start)` at window start. Reuse `castMsByUnitSpell` + `isAvailable`. cooldownMs from `offensiveCdMeta.cooldownSec*1000`.
- [ ] PASS; tsc; commit `feat(metrics): per-window attacking-team offense-available count`.

### Task 9: Safety coloring (web)
**Files:** `web/src/api.ts` (OffensiveWindow `attackerOffenseAvailableCount`), `web/src/components/Timeline.tsx` (band class/style), `web/src/components/WindowPanel.tsx` (show ratio inputs), `web/src/styles.css`. Test: `Timeline.test.tsx`.
- [ ] Test: an enemy go where our defensives>>their offense → band gets the "safe" class/style; reverse → "danger".
- [ ] Implement: `ourRelevant = ours ? attackerOffenseAvailableCount : defendersDefAvailable`; `theirRelevant = ours ? defendersDefAvailable : attackerOffenseAvailableCount`; `favor=(1+ourRelevant)/(1+theirRelevant)`; map favor→color via 5-stop scale (red·orange·yellow·blue·green) as the band background; keep GO N label. `defendersDefAvailable = mitigation.available.length`. WindowPanel shows "Favor x/y".
- [ ] PASS; tsc; commit `feat(web): GO-band safety coloring (favorability ratio)`.

### Task P3-FINISH: suites + re-ingest (for Task 8) + /simplify + /code-review + push.

---

# Phase 4 — Settings tab (read-only; NO re-ingest)

### Task 10: /api/metadata endpoint
**Files:** `src/viewer/server.ts`, `src/viewer/queries.ts` (`buildMetadataView()`), `src/viewer/types.ts`. Test: `test/viewerServerMetadata.test.ts`.
- [ ] Test: `GET /api/metadata` returns `{ offensive:[{id,name,cooldownSec?,kind?}], cc:[{id,name,category}], cooldowns:[...] }`.
- [ ] Implement `buildMetadataView()` from the metadata modules; wire the route before `/:id`.
- [ ] PASS; tsc; commit `feat(viewer): /api/metadata read-only tracked-spell view`.

### Task 11: Settings tab (web)
**Files:** `web/src/components/Settings.tsx`, `web/src/App.tsx` (tab), `web/src/api.ts` (`fetchMetadata`), `web/src/styles.css`. Test: `web/src/components/Settings.test.tsx`.
- [ ] Test: Settings renders grouped tables (offensive/CC) from a metadata fixture; a known spell name appears.
- [ ] Implement a persistent tab ("Settings") switching the main view to a read-only grouped list.
- [ ] PASS; tsc; commit `feat(web): read-only Settings tab listing tracked spells`.

### Task P4-FINISH: suites + builds + /simplify + /code-review + push. Final PR notes the re-ingests.

---

## Self-review
- Coverage: A=Tasks 1–3,5,6; B=Task 4; C=Task 7; D=Tasks 10–11; E=Tasks 8–9. Ramp specs blank by decision (no task). 
- Re-ingests: end of Phase 1, 2, 3 (offensive set + new window field change stored blobs); Phase 4 none.
- Type flow: `offensiveCdMeta` (Task 3) consumed by Tasks 5/8; `AttackerGoTrack.intervals[].spell` (Task 4) by GoTracks; `attackerOffenseAvailableCount` (Task 8) by Task 9.
