# Detail View v2 Implementation Plan (chunky, DV2-a → DV2-c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **Ship a PR at the end of each phase** (DV2-a / DV2-b / DV2-c) — each is self-contained.

**Goal:** Upgrade the per-match detail view: roster, per-attacker class-colored GO tracks, polarity-aware scorecard coloring, split kick lanes, reassignable range, death-hover damage, CC-metadata fixes.

**Architecture:** Two new metrics on `MatchMetrics` (`attackerGoTracks`, `deathBlows`) flow through the existing `match_detail` JSON blob → `/api/matches/:id/detail` automatically (re-ingest required for DV2-b/c). The rest is web + a shared class-color map.

**Tech Stack:** TS ESM (NodeNext), node:sqlite (`--experimental-sqlite`), Vitest (root + `web/` jsdom), React 18 + Vite.

**Spec:** `docs/superpowers/specs/2026-06-07-detail-view-v2-design.md`

**Branch:** off `master` after C1 (#22) merges → `feat/detail-view-v2`.

**Conventions:** SQLite root tests `NODE_OPTIONS=--experimental-sqlite npx vitest run <file> --no-file-parallelism`; web tests inside `web/`; never bare `npx vitest run` at root. Local imports end `.js`. Additive types. Commit per task; bodies end `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Confirmed primitives:**
- `offensiveWindows.ts` `offensiveContribs(unitId, auras)` = `auras.intervalsBy(unitId).filter(iv => isOffensiveCd(iv.spellId))`; matchEnd clamp = `Math.max(matchEndMs(events) ?? matchStart, matchStart + durationInSeconds*1000)`.
- `eventAccess.ts`: `eventType`, `srcId`, `destId`, `spellName`, `amount`, `eventTimeMs`, `matchStartMs`, `DAMAGE_EVENTS` regex; death = `UNIT_DIED` (victim = `destId`).
- `registry.ts` `HEALER_SPEC_IDS`; `specs.ts` `className(specId)`; `repositioning.ts` `ANCHOR_ABILITIES` (Demonic Circle 48018→return 48020) + `anchorInfo(spellId)`.
- Detail endpoint returns the full parsed `MatchMetrics` → new MatchMetrics fields appear in the web payload after a re-ingest with no store/view change.
- `round1` from `spacing.ts`.

---

# Phase DV2-a — Quick wins + scorecard polish (NO re-ingest)

### Task 1: Class-color map (shared)

**Files:** Create `src/metadata/classColors.ts`, `web/src/classColors.ts`. Test: `test/classColors.test.ts`

- [ ] **Step 1: failing test**

```ts
// test/classColors.test.ts
import { describe, it, expect } from 'vitest';
import { classColorOfSpec, CLASS_COLORS } from '../src/metadata/classColors.js';
describe('class colors', () => {
  it('maps a spec id to its class color', () => {
    expect(classColorOfSpec('265')).toBe(CLASS_COLORS['Warlock']);   // Affliction → Warlock
    expect(classColorOfSpec('250')).toBe(CLASS_COLORS['Death Knight']);
  });
  it('returns a neutral gray for an unknown spec', () => {
    expect(classColorOfSpec('999999')).toBe('#9aa2b1');
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `src/metadata/classColors.ts` (canonical WoW class hexes; keys MATCH `specs.json` spaced classNames — "Death Knight", "Demon Hunter"):

```ts
import { className } from './specs.js';
export const CLASS_COLORS: Record<string, string> = {
  'Death Knight': '#C41E3A', 'Demon Hunter': '#A330C9', 'Druid': '#FF7C0A', 'Evoker': '#33937F',
  'Hunter': '#AAD372', 'Mage': '#3FC7EB', 'Monk': '#00FF98', 'Paladin': '#F48CBA', 'Priest': '#FFFFFF',
  'Rogue': '#FFF468', 'Shaman': '#0070DD', 'Warlock': '#8788EE', 'Warrior': '#C69B6D',
};
const NEUTRAL = '#9aa2b1';
export function classColorOfSpec(specId: string | undefined): string {
  if (!specId) return NEUTRAL;
  return CLASS_COLORS[className(specId)] ?? NEUTRAL;
}
```

Mirror to `web/src/classColors.ts` — the same `CLASS_COLORS` map + a `classColorOfClassName(name)` helper (the web side already gets spec→className labels via the API's `classSpecTree`; for the detail view the roster carries spec, so also add a small spec→class map OR pass className from the server). SIMPLEST: have the detail endpoint/roster send the **className** per combatant so the web maps className→color without needing specs.json. (Decide in Task 2; if the roster gets specId only, the web needs a spec→class map — prefer sending className.)

- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(metadata): class color map + classColorOfSpec`.

### Task 2: Player roster strip

**Files:** Create `web/src/components/Roster.tsx`; modify `web/src/components/DetailView.tsx`, `web/src/api.ts` (MatchDetail metrics already has `teams`? — if not, ensure the detail payload exposes per-combatant `{name, spec, className, team, kind}`), `web/src/styles.css`. Test: `web/src/components/Roster.test.tsx`

NOTE: `MatchMetrics.teams[].players[].player` carries `name/spec/team/kind`. The web `MatchDetail.metrics` type currently omits `teams`. Add a permissive `teams` shape to the web type (or a flattened `combatants: {name, spec, className, team, isHealer}[]` the server derives). RECOMMEND: the detail endpoint adds a derived `roster: {name, className, specLabel, team, isHealer}[]` (using `className`/`specLabel`/`HEALER_SPEC_IDS` server-side) so the web stays thin. Add `roster` to the `/detail` response + web `MatchDetail`.

- [ ] **Step 1: failing test** — render `Roster` with a roster fixture (2 teams), assert class-colored chips with spec labels appear and the healer is marked.
- [ ] **Step 2–4:** Implement the server `roster` derivation in `buildRangeSeries`'s sibling (a `buildRoster(metrics)` in queries.ts) + add to the `/detail` json; `Roster.tsx` renders team groups with `style={{color: CLASS_COLORS[c.className] ?? neutral}}`; `DetailView` renders `<Roster roster={detail.roster} />` at the top.
- [ ] **Step 5:** Commit `feat(web): player roster strip (class-colored, specs, healer marked)`.

### Task 3: Split kicks into two lanes

**Files:** Modify `web/src/components/Timeline.tsx`, `web/src/components/Timeline.test.tsx`

- [ ] **Step 1:** Update the Timeline test: assert lanes **"Kicks landed"** and **"Kicks taken"** both render (replace the single "Kicks" assertion).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `Timeline.tsx` `LANES`, replace the single `kick` lane with two:

```ts
{ key: 'kickLanded', label: 'Kicks landed', pick: (e, p) => (e.kind === 'interrupt' && e.unitId === p ? 'kick' : null) },
{ key: 'kickTaken',  label: 'Kicks taken',  pick: (e, p) => (e.kind === 'interrupt' && e.targetId === p ? 'kicked' : null) },
```

- [ ] **Step 4:** Run → PASS. Web tsc.
- [ ] **Step 5:** Commit `feat(web): split kicks into landed/taken lanes`.

### Task 4: GO band color by attackingTeam (interim)

**Files:** Modify `web/src/components/Timeline.tsx`, `web/src/components/Timeline.test.tsx`

- [ ] **Step 1:** Update the band test: a window with `attackingTeam: 'enemy'` → class `enemy-go` (red); `attackingTeam: 'friendly'` → `friendly-go` (green). (Replace the lethal/handled assertions.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `Timeline.tsx`, change the band class from the death-in-window rule to `` `go-band ${w.attackingTeam === 'friendly' ? 'friendly-go' : 'enemy-go'}` ``. Update CSS (`.friendly-go` green tint, `.enemy-go` red tint). (`OffensiveWindow.attackingTeam` is on the web type already; add it if missing.)
- [ ] **Step 4:** Run → PASS. Web tsc. NOTE: this band is superseded by DV2-b's per-attacker tracks but ships now.
- [ ] **Step 5:** Commit `feat(web): GO bands colored by attacking team (friendly/enemy)`.

### Task 5: Range lane label

**Files:** Modify `web/src/components/RangeLane.tsx` (+ Timeline passes a `label`), test.

- [ ] **Steps:** Add a `label` prop (default "Range to primary threat (yd)"); render it as the lane name (replacing the static "Range (yd)"). Timeline passes the primary-threat name if available. Test asserts the label renders. Commit `feat(web): label the range lane with its target`.

### Task 6: Scorecard verdict coloring + signed delta

**Files:** Modify `web/src/components/ScorecardTable.tsx`, `web/src/components/ScorecardTable.test.tsx`

- [ ] **Step 1:** Update the test: a `better` metric's verdict cell has class `v-better`; the **vs-avg cell shows a signed delta** (e.g. value 1.6M, mean 1.5M → "+100.0k" or similar) and is neutral-colored; a `worse` metric → `v-worse`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `ScorecardTable.tsx`: the verdict-class map is already polarity-aware (verdict is `better`/`worse` from the server, which respects polarity) — keep `VCLASS`. Change the **vs-avg cell** from `fmtVal(m.mean)` to a **signed delta**: `m.value === null ? '' : signed(m.value - m.mean)` where `signed(d) = (d >= 0 ? '+' : '−') + fmtVal(Math.abs(d)) + unit`. Keep the delta cell neutral (the verdict cell carries good/bad color). (Confirm `average`→`v-avg` neutral, `descriptive`→`v-info`.)
- [ ] **Step 4:** Run → PASS. Web tsc + full web suite.
- [ ] **Step 5:** Commit `feat(web): scorecard verdict good/bad coloring + signed delta vs avg`.

### Task 6b: Global text scaling (~2×)

**Files:** Modify `web/src/styles.css`. (Pure visual — manual check via `npm run viewer`, no unit test.)

- [ ] The viewer text is too small. Scale the whole UI up ~1.7–2×. Cleanest robust approach:
  set `html { font-size: 175% }` (or bump `body` font-size) so `rem`/relative sizes grow, then
  **audit the hard-coded px** that must scale with it — chiefly the timeline lane-label column width
  and track offsets (`.tl-name`/`.tl-track` left, `.cmp-ctl`, table padding) — and bump those
  proportionally (or convert to `rem`). Verify the dense match table, the filter rail, the drawer,
  and the detail timeline still align at the new size.
- [ ] Commit `feat(web): scale up the UI text (~2x) for readability`.

### Task A-FINISH: Phase DV2-a gates + PR
- [ ] Root + web suites green; `tsc` both; `vite build`. (No re-ingest for DV2-a.)
- [ ] `/simplify` then `/code-review` over the phase diff; address findings.
- [ ] `finishing-a-development-branch` → push + open the **DV2-a PR**. (Continue on the same branch for DV2-b, or branch fresh after merge — your call at execution time.)

---

# Phase DV2-b — GO-window redesign (per-attacker class-colored tracks; RE-INGEST)

### Task 7: `attackerGoTracks` metric

**Files:** Create `src/metrics/attackerGoTracks.ts`; modify `src/metrics/types.ts` (MatchMetrics + a type), `src/metrics/metrics.ts` (wire into `computeMatchMetrics`). Test: `test/attackerGoTracks.test.ts`

- [ ] **Step 1: failing test** (fake match w/ offensive auras; healer excluded)

```ts
// test/attackerGoTracks.test.ts
import { describe, it, expect } from 'vitest';
import { computeAttackerGoTracks } from '../src/metrics/attackerGoTracks.js';
// build a fake match + AuraState stub exposing intervalsBy; use a real OFFENSIVE_SPELL_IDS id.
// Assert: a DPS (non-healer) has a track with its offensive interval (tSec-relative, clamped);
// a healer (spec ∈ HEALER_SPEC_IDS) is excluded.
```

(Implementer: use a real offensive spell id from `cooldowns.json` `offensiveSpellIds` so `isOffensiveCd` resolves; build a minimal `AuraState`-shaped stub `{ intervalsBy: (id) => ..., intervalsOn: ()=>[], activeOn: ()=>[] }`, and `units` with one DPS + one healer.)

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (mirrors `computeOffensiveWindows`'s clamp + `offensiveContribs`):

```ts
// src/metrics/attackerGoTracks.ts
import type { AuraState } from './auraState.js';
import { isOffensiveCd } from '../metadata/cooldowns.js';
import { HEALER_SPEC_IDS } from './registry.js';
import { matchStartMs, matchEndMs } from './eventAccess.js';
import { round1 } from './spacing.js';
import type { UnitMetrics, AttackerGoTrack } from './types.js';

export function computeAttackerGoTracks(match: unknown, units: UnitMetrics[], auras: AuraState): AttackerGoTrack[] {
  const m = match as { events?: unknown[]; durationInSeconds?: unknown };
  const events = Array.isArray(m.events) ? m.events : [];
  const matchStart = matchStartMs(events) ?? 0;
  const dur = typeof m.durationInSeconds === 'number' ? matchStart + m.durationInSeconds * 1000 : matchStart;
  const matchEnd = Math.max(matchEndMs(events) ?? matchStart, dur);
  const clampEnd = matchEnd > matchStart ? matchEnd : Number.MAX_SAFE_INTEGER;
  const attackers = units.filter((u) => u.kind === 'player' && (u.spec === undefined || !HEALER_SPEC_IDS.includes(String(u.spec))));
  return attackers.map((p) => ({
    unitId: p.unitId, name: p.name, team: p.team, spec: p.spec,
    intervals: auras.intervalsBy(p.unitId)
      .filter((iv) => isOffensiveCd(iv.spellId))
      .map((iv) => ({ startSec: round1((Math.max(iv.start, matchStart) - matchStart) / 1000), endSec: round1((Math.min(iv.end, clampEnd) - matchStart) / 1000) }))
      .filter((w) => w.endSec > w.startSec)
      .sort((a, b) => a.startSec - b.startSec),
  }));
}
```

In `types.ts`: `export interface AttackerGoTrack { unitId: string; name: string; team: Team; spec?: string; intervals: { startSec: number; endSec: number }[]; }` and add `attackerGoTracks: AttackerGoTrack[];` to `MatchMetrics`. In `metrics.ts` `computeMatchMetrics`, add `attackerGoTracks: computeAttackerGoTracks(match, units, auras)` (uses the same `auras`/`units` already built there).

- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit` (add `attackerGoTracks: []` to any bare `MatchMetrics` test fixture — e.g. `test/metricRows.test.ts`, `test/renderReport.test.ts`).
- [ ] **Step 5:** Commit `feat(metrics): per-attacker GO tracks (offensive-CD intervals, healers excluded)`.

### Task 8: Web GO-track band (four class-colored tracks)

**Files:** Create `web/src/components/GoTracks.tsx`; modify `web/src/components/Timeline.tsx` (render below event lanes), `web/src/api.ts` (MatchDetail metrics gains `attackerGoTracks`), `web/src/styles.css`. Test: `web/src/components/GoTracks.test.tsx`

- [ ] **Step 1: failing test** — fixture with 2 enemy + 2 friendly attackers (with className/spec), assert: 4 track rows; enemy tracks appear before friendly tracks (top vs bottom); each segment uses the attacker's class color (`style` background); a track with overlapping enemy segments at the same time = "both going" is visible (two lit enemy rows).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `GoTracks.tsx`: take `tracks: AttackerGoTrack[]` (with a `className` per track — have the server include className on each track, OR map spec→class on web; prefer server includes `className`), `matchEnd`. Order **enemy first, then friendly**; ≤2 per team (if >2, keep the 2 with the most total GO time, append a "+N" row label). Each track: a labeled row; segments as absolutely-positioned colored bars (`left/width` by pct, `background: CLASS_COLORS[className]`). Hover a segment → title with attacker name + the seconds. Render `<GoTracks tracks={detail.metrics.attackerGoTracks} matchEnd={matchEnd} />` in `Timeline` after the lanes (before/after RangeLane — pick a clear order). Add CSS.

NOTE: include `className` on each `AttackerGoTrack` server-side (derive via `className(spec)`) so the web colors without a spec→class map. Add `className?: string` to the type and set it in `computeAttackerGoTracks` (import `className`), OR derive in the detail endpoint. Decide and keep consistent.

- [ ] **Step 4:** Run → PASS. Web tsc.
- [ ] **Step 5:** Commit `feat(web): per-attacker GO tracks (class-colored, enemy top / friendly bottom)`.

### Task 9: WindowPanel per-attacker damage breakdown

**Files:** Modify `web/src/components/WindowPanel.tsx`, test.

- [ ] **Steps:** The panel already receives the window; render `damageByTarget` as a per-attacker list (name + `fmtNum(damage)`), so "which enemy / both" is explicit on click. Test asserts the breakdown renders. Commit `feat(web): GO-window panel shows per-attacker damage breakdown`.

### Task B-FINISH: re-ingest + gates + PR
- [ ] Full suites + tsc + build green.
- [ ] **Re-ingest** (new `attackerGoTracks` in the blob): `npm run ingest-db` (sidecar-off config for speed during dev).
- [ ] `npm run viewer` → a match's overlay shows 4 class-colored GO tracks (enemy top, yours bottom); both-enemy gos read as two lit top rows.
- [ ] `/simplify` + `/code-review`; address findings.
- [ ] Finish → **DV2-b PR** (notes the one-time re-ingest).

---

# Phase DV2-c — Interactions + new data (RE-INGEST)

### Task 10: `deathBlows` metric (per-death preceding damage)

**Files:** Create `src/metrics/deathBlows.ts`; modify `src/metrics/types.ts` (MatchMetrics), `src/metrics/metrics.ts`. Test: `test/deathBlows.test.ts`

- [ ] **Step 1: failing test** — a fake match: victim P2 takes 3 damage events at t-4s/t-2s/t-1s then UNIT_DIED; assert `deathBlows` for P2 lists those hits (srcName/spell/amount/tSec), excludes a hit 8s before, and caps the list.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement:

```ts
// src/metrics/deathBlows.ts
import { eventType, srcId, destId, spellName, amount, eventTimeMs, matchStartMs, DAMAGE_EVENTS } from './eventAccess.js';
import { round1 } from './spacing.js';
import type { DeathBlow } from './types.js';

const WINDOW_MS = 5000;
const MAX_HITS = 12;

export function computeDeathBlows(match: unknown, nameOf: (id: string) => string): DeathBlow[] {
  const m = match as { events?: unknown[] };
  const events = Array.isArray(m.events) ? m.events : [];
  const start = matchStartMs(events) ?? 0;
  const dmg: { dest: string; srcName: string; spell: string; amount: number; ms: number }[] = [];
  const deaths: { victim: string; ms: number }[] = [];
  for (const ev of events) {
    const t = eventType(ev); const ms = eventTimeMs(ev);
    if (ms === undefined) continue;
    if (DAMAGE_EVENTS.test(t)) { const d = destId(ev); if (d) dmg.push({ dest: d, srcName: nameOf(srcId(ev) ?? '?'), spell: spellName(ev), amount: amount(ev), ms }); }
    else if (t === 'UNIT_DIED') { const v = destId(ev); if (v) deaths.push({ victim: v, ms }); }
  }
  return deaths.map((d) => ({
    victimId: d.victim, tSec: round1((d.ms - start) / 1000),
    recent: dmg.filter((h) => h.dest === d.victim && h.ms <= d.ms && h.ms >= d.ms - WINDOW_MS)
      .sort((a, b) => a.ms - b.ms).slice(-MAX_HITS)
      .map((h) => ({ srcName: h.srcName, spell: h.spell, amount: Math.round(h.amount), tSec: round1((h.ms - start) / 1000) })),
  }));
}
```

`types.ts`: `export interface DeathBlow { victimId: string; tSec: number; recent: { srcName: string; spell: string; amount: number; tSec: number }[]; }` + `deathBlows: DeathBlow[];` on `MatchMetrics`. `metrics.ts`: `deathBlows: computeDeathBlows(match, nameOf)` (build/reuse a `nameOf` from `m.units`).

- [ ] **Step 4:** Run → PASS. tsc (add `deathBlows: []` to bare MatchMetrics fixtures).
- [ ] **Step 5:** Commit `feat(metrics): per-death preceding-damage (deathBlows)`.

### Task 11: Anchor positions in the detail payload

**Files:** Modify `src/viewer/queries.ts` (detail endpoint helper), `web/src/api.ts`. Test: extend `test/viewerDetail.test.ts`

- [ ] **Steps:** Add a `buildAnchors(metrics)` deriving, per player, their Demon Circle placements `{tSec, x, y}` from the cast events / `ANCHOR_ABILITIES`. (If anchor cast positions aren't readily in `MatchMetrics`, derive from `positionTracks` at the anchor-cast tSec, or capture in a small metric.) Expose `anchors: { unitId: string; placements: {tSec,x,y}[] }[]` in the `/detail` response. Web `MatchDetail` gains `anchors`. Test asserts the endpoint returns anchors. Commit `feat: expose Demon Circle anchor positions in the detail payload`.

NOTE: scope-check at execution — if anchor extraction is heavier than expected, the range-to-anchor option can ship in a follow-up; the range-to-any-player option (Task 12) does not depend on it.

### Task 12: Reassignable range target (web)

**Files:** Create `web/src/components/RangeLane.tsx` target selector + a `web/src/distance.ts` helper; modify `Timeline.tsx`. Test: `web/src/distance.test.ts` + RangeLane test.

- [ ] **Steps:** Port a tiny `distanceAt(trackA, trackB, tSec)` to `web/src/distance.ts` (2-D Euclidean over the stored `positionTracks` samples — nearest/interpolated sample; keep it simple, gaps → null). RangeLane gets a **target selector** (dropdown of the 6 players + "Demon Circle anchor"); on change, recompute the series client-side from `detail.metrics.positionTracks` (you ↔ target) and relabel. Test: the helper computes distance; the selector switches target and the line updates. Commit `feat(web): reassignable range target (any player or anchor)`.

### Task 13: Death-hover preceding damage (web)

**Files:** Modify `web/src/components/Timeline.tsx` (death lane markers), `web/src/api.ts` (MatchDetail `deathBlows`). Test: Timeline test.

- [ ] **Steps:** Death markers look up their `deathBlows` entry (match by victim + tSec) and render a hover tooltip listing `recent` hits (`srcName · spell · amount` at `tSec`). Test: hovering/finding a death marker shows the preceding-damage list. Commit `feat(web): death markers show preceding damage on hover`.

### Task 14: CC metadata coverage (Seduction + audit)

**Files:** Modify `src/metadata/spells.curated.json` (add missing CC); Test: `test/ccCoverage.test.ts`

- [ ] **Step 1: failing test** — assert `ccInfo` resolves a known CC roster: Fear (5782), **Seduction (6358)**, Polymorph (118), Hex (51514), Hammer of Justice (853), Cyclone (33786), … (a curated list of common player CC). Each returns a category.
- [ ] **Step 2:** Run → FAIL (6358 unresolved).
- [ ] **Step 3:** Add the missing entries to `spells.curated.json` (`"6358": { "name": "Seduction", "tags": ["cc"], "ccCategory": "disorient" }` + any others the test surfaces). Verify the DB-primary path / curated-fallback in `ccInfo` picks them up.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `fix(metadata): add Succubus Seduction + missing CC to the curated set`.

### Task C-FINISH: re-ingest + gates + PR
- [ ] Full suites + tsc + build green.
- [ ] **Re-ingest** (new `deathBlows` + anchors in the blob).
- [ ] `npm run viewer` → reassignable range target works (player + anchor); death hover shows what killed you; CC lane now includes Seductions.
- [ ] `/simplify` + `/code-review`; address findings.
- [ ] Finish → **DV2-c PR** (notes the one-time re-ingest).

---

## Deferred (eventual)

- **Spec/comp shown as spec ICONS** instead of text labels (roster, comp filter, table comp
  columns) — needs sourcing a spec→icon asset set (WoW spec icons via the vendored DB / wago);
  a dedicated polish increment once the icon assets are vendored. Touches the roster (Task 2) and
  the comp/label rendering across the SPA.
- The **safety-opacity overlay** (DV2-d, the `(1+x)/(1+y)` mitigation-vs-offense band).

## Self-Review (plan vs spec)

- **Coverage:** DV2-a = Tasks 1–6 (class colors, roster, kick split, GO-band color, range label, verdict coloring); DV2-b = 7–9 (attackerGoTracks metric, GO-track band, window per-attacker breakdown); DV2-c = 10–14 (deathBlows, anchors, reassignable range, death hover, CC metadata). The deferred safety-opacity overlay (DV2-d) is out, as specced.
- **Type consistency:** `AttackerGoTrack`/`attackerGoTracks` (T7) consumed by `GoTracks` (T8); `DeathBlow`/`deathBlows` (T10) consumed by the death hover (T13); `CLASS_COLORS`/`classColorOfSpec` (T1) used by roster (T2) + GO tracks (T8). The new MatchMetrics fields flow through the existing detail blob — no store/view change, but a re-ingest for DV2-b and DV2-c.
- **Flagged soft spots (called out in-task):** roster/GO-track coloring needs className on the wire (decide: server-derived `className` per combatant/track) — keep consistent; anchor extraction may be heavier than expected (T11 NOTE: range-to-player ships independently); bare `MatchMetrics` test fixtures need the two new `[]` fields (T7/T10 steps).
- **No placeholders** except the two execution-time decisions explicitly flagged (className-on-wire shape; anchor-extraction depth), each with a recommended default.
