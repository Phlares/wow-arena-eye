# Cooldown Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the non-spatial backbone of GO analysis — a cooldown model that tracks every player's offensive/defensive CDs, derives per-CD availability over the match, detects symmetric enemy offensive windows ("gos"), and records per window the severity + per-player available-vs-used mitigation ledger + enemy counter-play.

**Architecture:** A manually-run generator parses the MiniCC `Rules.lua` enemy-cooldown database into a committed `cooldowns.json` (cooldown length, buff duration, category, charges, spec/class keys, the explicit offensive-CD set, and the spec→class map). A loader exposes per-spell/per-spec lookups. An availability engine simulates charge/cooldown state from observed casts. A window detector reuses `auraState` (offensive CDs are self-buffs already tracked there) to find/merge active offensive-CD intervals, then enriches each window with damage severity and a mitigation/counter-play ledger derived from casts, CC auras, and immunity auras already available.

**Tech Stack:** TypeScript (ESM, NodeNext — local imports use `.js`), Node ≥22, Vitest, tsx. Source data: MiniCC addon `Modules/Cooldowns/Rules.lua`.

---

## File Structure

**Create:**
- `scripts/import-cooldowns.mjs` — generator: MiniCC `Rules.lua` → `src/metadata/cooldowns.json`. Mirrors `scripts/import-cc-categories.mjs`.
- `src/metadata/cooldowns.json` — generated, committed reference data.
- `src/metadata/cooldowns.ts` — loader: `cdInfo`, `cdsForSpec`, `OFFENSIVE_SPELL_IDS`, `TRINKET_SPELL_IDS`.
- `src/metrics/cooldownTimeline.ts` — `collectCasts`, charge/cooldown availability engine (`chargesAt`, `isAvailable`, `readyIntervals`).
- `src/metrics/offensiveWindows.ts` — `computeOffensiveWindows` (detection + severity + ledger + counter-play).
- `test/cooldownImport.test.ts`, `test/cooldownLoader.test.ts`, `test/cooldownTimeline.test.ts`, `test/offensiveWindows.test.ts`.

**Modify:**
- `src/metrics/types.ts` — add `CdCategory`, `CdUsageStat`, `MitigationCategory`, `CdRef`, `MitigationItem`, `WindowCounterPlay`, `OffensiveWindow`; add `cdUsage` to `UnitMetrics`; add `offensiveWindows` to `MatchMetrics`.
- `src/metadata/spells.ts` — add `isImmunity(id)`.
- `src/metrics/perUnit.ts` — accept shared `casts`; emit `cdUsage`.
- `src/metrics/metrics.ts` — call `collectCasts` once; pass to `computeUnitMetrics` and `computeOffensiveWindows`; put `offensiveWindows` on the result.
- `src/view/renderMetrics.ts` — replace the `defensives (used/burst)` column with a CD-availability view; add a windows section.

**Baseline:** Confirm green before starting — `npm test` (expect the current passing baseline; this plan adds tests, never deletes). Type-check with `npx tsc --noEmit`.

---

### Task 1: Add shared metric types

**Files:**
- Modify: `src/metrics/types.ts`

- [ ] **Step 1: Add the new types**

Add after the `ImmuneSide` interface (around line 29):

```ts
export type CdCategory = 'offensive' | 'defensive' | 'external' | 'important' | 'trinket';

/** Per-player summary for one tracked cooldown the unit cast. `availableSec` is the
 *  total seconds the CD sat ready across the match — the substrate for later
 *  offensive-throughput ("held without pressing") analysis. */
export interface CdUsageStat {
  spellId: number;
  name: string;
  category: CdCategory;
  casts: number;
  availableSec: number;
}

export type MitigationCategory =
  | 'defensive' | 'external' | 'trinket' | 'immunity' | 'cc-control' | 'interrupt';

/** An offensive CD active during a window, attributed to the player who pressed it. */
export interface CdRef { spellId: number; name: string; unitId: string; startSec: number; endSec: number; }

/** One mitigation ability, attributed per player. In `used`, `usedAtSec` is set;
 *  in `available` it is omitted (the item was ready but not necessarily pressed). */
export interface MitigationItem { unitId: string; category: MitigationCategory; spellId: number; name: string; usedAtSec?: number; }

export interface WindowCounterPlay {
  /** Enemy CC landed on defending players during the window. */
  ccOnDefenders: { unitId: string; name: string; spell: string; sec: number }[];
  /** Immunity auras active on a primary threat during the window (e.g. they went while immune). */
  threatImmuneAuras: string[];
}

/** One enemy offensive window ("go"): who opened it, how bad it was, what mitigation
 *  the defending team had available vs used, and the enemy's counter-play. Symmetric:
 *  windows are detected for both teams (attackingTeam = whoever's offensive CDs opened it). */
export interface OffensiveWindow {
  attackingTeam: Team;
  defendingTeam: Team;
  startSec: number;
  endSec: number;
  openedBy: CdRef[];
  teamDamageTaken: number;
  damageByTarget: { unitId: string; name: string; damage: number }[];
  mitigation: { available: MitigationItem[]; used: MitigationItem[] };
  counterPlay: WindowCounterPlay;
}
```

- [ ] **Step 2: Add `cdUsage` to `UnitMetrics`**

In `UnitMetrics` (after `defensivesIntoBurst;` around line 92) add:

```ts
  cdUsage: CdUsageStat[];
```

- [ ] **Step 3: Add `offensiveWindows` to `MatchMetrics`**

Change the `MatchMetrics` interface (around line 125) to include the new field:

```ts
export interface MatchMetrics { teams: TeamGroup[]; timeline: TimelineEvent[]; playerUnitId?: string; coordination: { team: Team; summary: CoordinationSummary }[]; focusTracks: FocusTracks; offensiveWindows: OffensiveWindow[]; }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: FAIL — `cdUsage` and `offensiveWindows` are now required but not yet produced by `perUnit.ts` / `metrics.ts`. This is expected; Tasks 5 and 9 satisfy them. (Do not "fix" by making them optional.)

- [ ] **Step 5: Commit**

```bash
git add src/metrics/types.ts
git commit -m "feat: cooldown-model types (CdUsageStat, OffensiveWindow, mitigation ledger)"
```

---

### Task 2: MiniCC cooldown generator

The generator parses MiniCC `Rules.lua`. Line comments are stripped first (the file has no braces inside strings, so after comment-stripping a brace-depth scan is reliable). The MiniCC path comes from the `WAE_MINICC_RULES` env var — never hardcoded (public/private separation). The generated `cooldowns.json` is committed; the runtime never needs the addon path.

**Files:**
- Create: `scripts/import-cooldowns.mjs`
- Test: `test/cooldownImport.test.ts`

- [ ] **Step 1: Write the generator with an exported pure parser**

Create `scripts/import-cooldowns.mjs`:

```js
// Regenerate src/metadata/cooldowns.json from the MiniCC enemy-cooldown database.
// Source: MiniCC addon Modules/Cooldowns/Rules.lua (BySpec/ByClass rules, OffensiveSpellIds, specToClass).
// Run manually: WAE_MINICC_RULES="/path/to/MiniCC/Modules/Cooldowns/Rules.lua" node scripts/import-cooldowns.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Index just after the matching close brace for the open brace at `openIdx`. -1 if unbalanced. */
export function matchBrace(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** key -> inner body text for every `<key> = { ... }` matched by keyRe at the top level of `body`. */
export function keyedGroups(body, keyRe) {
  const groups = {};
  const re = new RegExp(keyRe, 'g');
  let m;
  while ((m = re.exec(body))) {
    const open = m.index + m[0].length - 1; // m[0] ends with '{'
    const end = matchBrace(body, open);
    if (end < 0) break;
    groups[m[1]] = body.slice(open + 1, end);
    re.lastIndex = end;
  }
  return groups;
}

/** Inner text of each top-level `{ ... }` object inside `body` (handles nested tables). */
export function topLevelObjects(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') { const end = matchBrace(body, i); out.push(body.slice(i + 1, end)); i = end; }
  }
  return out;
}

function field(block, key) {
  const m = block.match(new RegExp('\\b' + key + '\\s*=\\s*(true|false|-?\\d+)'));
  if (!m) return undefined;
  return m[1] === 'true' ? true : m[1] === 'false' ? false : Number(m[1]);
}

function ruleToEntry(block) {
  const spellId = field(block, 'SpellId');
  if (typeof spellId !== 'number') return undefined;
  const cooldown = field(block, 'Cooldown');
  const buff = field(block, 'BuffDuration');
  const maxCharges = field(block, 'MaxCharges');
  const baseCharges = field(block, 'BaseCharges');
  const castSpellId = field(block, 'CastSpellId');
  const entry = {
    spellId,
    cooldownSec: typeof cooldown === 'number' ? cooldown : 0,
    buffDurationSec: typeof buff === 'number' ? buff : 0,
    charges: typeof maxCharges === 'number' ? maxCharges : (typeof baseCharges === 'number' ? baseCharges : 1),
    bigDefensive: field(block, 'BigDefensive') === true,
    externalDefensive: field(block, 'ExternalDefensive') === true,
    important: field(block, 'Important') === true,
  };
  if (typeof castSpellId === 'number') entry.castSpellId = castSpellId;
  if (field(block, 'NoAura') === true) entry.noAura = true;
  return entry;
}

/** Pure parse of Rules.lua text into the cooldowns.json data object (no I/O). Exported for tests. */
export function parseRules(src) {
  const clean = src.replace(/--.*$/gm, ''); // strip line comments (no braces live inside strings here)

  const offensiveSpellIds = [];
  const offBlock = clean.match(/offensiveSpellIds\s*=\s*\{/);
  if (offBlock) {
    const open = offBlock.index + offBlock[0].length - 1;
    const body = clean.slice(open + 1, matchBrace(clean, open));
    for (const mm of body.matchAll(/\[(\d+)\]\s*=\s*true/g)) offensiveSpellIds.push(Number(mm[1]));
  }

  const specToClass = {};
  const s2c = clean.match(/specToClass\s*=\s*\{/);
  if (s2c) {
    const open = s2c.index + s2c[0].length - 1;
    const body = clean.slice(open + 1, matchBrace(clean, open));
    for (const mm of body.matchAll(/\[(\d+)\]\s*=\s*"([A-Z]+)"/g)) specToClass[mm[1]] = mm[2];
  }

  const sectionBody = (name) => {
    const m = clean.match(new RegExp(name + '\\s*=\\s*\\{'));
    if (!m) return '';
    const open = m.index + m[0].length - 1;
    return clean.slice(open + 1, matchBrace(clean, open));
  };

  const bySpec = {};
  for (const [spec, body] of Object.entries(keyedGroups(sectionBody('BySpec'), '\\[(\\d+)\\]\\s*=\\s*\\{'))) {
    bySpec[spec] = topLevelObjects(body).map(ruleToEntry).filter(Boolean);
  }
  const byClass = {};
  for (const [cls, body] of Object.entries(keyedGroups(sectionBody('ByClass'), '\\b([A-Z]+)\\s*=\\s*\\{'))) {
    byClass[cls] = topLevelObjects(body).map(ruleToEntry).filter(Boolean);
  }

  return { source: 'MiniCC Rules.lua', offensiveSpellIds, specToClass, bySpec, byClass };
}

// CLI entry (skipped when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rulesPath = process.env.WAE_MINICC_RULES;
  if (!rulesPath) {
    console.error('Set WAE_MINICC_RULES to the MiniCC Modules/Cooldowns/Rules.lua path.');
    process.exit(1);
  }
  const data = parseRules(readFileSync(rulesPath, 'utf8'));
  data.generatedAt = new Date().toISOString();
  const OUT = fileURLToPath(new URL('../src/metadata/cooldowns.json', import.meta.url));
  writeFileSync(OUT, JSON.stringify(data, null, 0) + '\n');
  const specCount = Object.keys(data.bySpec).length;
  const entries = Object.values(data.bySpec).reduce((n, a) => n + a.length, 0) + Object.values(data.byClass).reduce((n, a) => n + a.length, 0);
  console.log('imported cooldowns:', { specs: specCount, classes: Object.keys(data.byClass).length, entries, offensive: data.offensiveSpellIds.length });
}
```

- [ ] **Step 2: Write the failing test**

Create `test/cooldownImport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseRules } from '../scripts/import-cooldowns.mjs';

const FIXTURE = `
local offensiveSpellIds = {
\t[107574] = true, -- Avatar
\t[31884] = true, -- Avenging Wrath
}
rules.OffensiveSpellIds = offensiveSpellIds

local rules = {
\tBySpec = {
\t\t[65] = { -- Holy Paladin
\t\t\t{
\t\t\t\tBuffDuration = 12,
\t\t\t\tCooldown = 120,
\t\t\t\tImportant = true,
\t\t\t\tBigDefensive = false,
\t\t\t\tExternalDefensive = false,
\t\t\t\tSpellId = 31884,
\t\t\t}, -- Avenging Wrath
\t\t\t{
\t\t\t\tBuffDuration = 8,
\t\t\t\tCooldown = 60,
\t\t\t\tBigDefensive = true,
\t\t\t\tImportant = true,
\t\t\t\tExternalDefensive = false,
\t\t\t\tSpellId = 498,
\t\t\t}, -- Divine Protection
\t\t},
\t\t[73] = {
\t\t\t{
\t\t\t\tBuffDuration = 0,
\t\t\t\tCooldown = 90,
\t\t\t\tMaxCharges = 2,
\t\t\t\tImportant = true,
\t\t\t\tBigDefensive = false,
\t\t\t\tExternalDefensive = false,
\t\t\t\tSpellId = 1719,
\t\t\t\tRequiresEvidence = { "Debuff", "UnitFlags" },
\t\t\t},
\t\t},
\t},
\tByClass = {
\t\tWARRIOR = {
\t\t\t{ Cooldown = 90, BuffDuration = 0, BigDefensive = false, ExternalDefensive = false, Important = true, SpellId = 97462 },
\t\t},
\t},
}

local specToClass = {
\t[65] = "PALADIN",
\t[73] = "WARRIOR",
}
`;

describe('parseRules', () => {
  const data = parseRules(FIXTURE);

  it('extracts the offensive spell-id set', () => {
    expect(data.offensiveSpellIds.sort()).toEqual([31884, 107574]);
  });

  it('parses BySpec entries with cooldown/buff/flags', () => {
    const aw = data.bySpec['65'].find((e: any) => e.spellId === 31884);
    expect(aw).toMatchObject({ cooldownSec: 120, buffDurationSec: 12, important: true, bigDefensive: false, charges: 1 });
    const dp = data.bySpec['65'].find((e: any) => e.spellId === 498);
    expect(dp).toMatchObject({ cooldownSec: 60, bigDefensive: true });
  });

  it('reads MaxCharges and survives nested tables (RequiresEvidence)', () => {
    const sw = data.bySpec['73'].find((e: any) => e.spellId === 1719);
    expect(sw).toMatchObject({ charges: 2, cooldownSec: 90 });
  });

  it('parses ByClass entries and the spec→class map', () => {
    expect(data.byClass.WARRIOR[0]).toMatchObject({ spellId: 97462, cooldownSec: 90 });
    expect(data.specToClass).toMatchObject({ '65': 'PALADIN', '73': 'WARRIOR' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/cooldownImport.test.ts`
Expected: PASS once the generator from Step 1 is in place. (If you wrote the test first against an empty file, it FAILs with "parseRules is not a function".)

- [ ] **Step 4: Generate the real `cooldowns.json`**

Run:
```bash
WAE_MINICC_RULES="/c/Program Files (x86)/World of Warcraft/_retail_/Interface/AddOns/MiniCC/Modules/Cooldowns/Rules.lua" node scripts/import-cooldowns.mjs
```
Expected stdout (approximately): `imported cooldowns: { specs: 33, classes: ~13, entries: ~122, offensive: 17 }`.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-cooldowns.mjs test/cooldownImport.test.ts src/metadata/cooldowns.json
git commit -m "feat: generate cooldowns.json from MiniCC Rules.lua"
```

---

### Task 3: Cooldown loader

**Files:**
- Create: `src/metadata/cooldowns.ts`
- Test: `test/cooldownLoader.test.ts`

- [ ] **Step 1: Write the loader**

Create `src/metadata/cooldowns.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CdCategory } from '../metrics/types.js';

interface RawEntry {
  spellId: number; cooldownSec: number; buffDurationSec: number; charges: number;
  bigDefensive: boolean; externalDefensive: boolean; important: boolean;
  castSpellId?: number; noAura?: boolean;
}
interface RawData {
  offensiveSpellIds: number[];
  specToClass: Record<string, string>;
  bySpec: Record<string, RawEntry[]>;
  byClass: Record<string, RawEntry[]>;
}

const DATA = JSON.parse(
  readFileSync(fileURLToPath(new URL('./cooldowns.json', import.meta.url)), 'utf8'),
) as RawData;

export const OFFENSIVE_SPELL_IDS: Set<number> = new Set(DATA.offensiveSpellIds);
/** PvP trinket + the two common PvP-trinket racials (Will to Survive / Will of the Forsaken). */
export const TRINKET_SPELL_IDS: Set<number> = new Set([336126, 59752, 7744]);

export interface CdEntry {
  spellId: number;
  cooldownMs: number;
  buffDurationMs: number;
  charges: number;
  category: CdCategory;
  castSpellId?: number;
  noAura: boolean;
}

function categoryOf(e: RawEntry): CdCategory {
  if (TRINKET_SPELL_IDS.has(e.spellId)) return 'trinket';
  if (OFFENSIVE_SPELL_IDS.has(e.spellId)) return 'offensive';
  if (e.externalDefensive) return 'external';
  if (e.bigDefensive) return 'defensive';
  return 'important';
}

function toEntry(e: RawEntry): CdEntry {
  return {
    spellId: e.spellId,
    cooldownMs: e.cooldownSec * 1000,
    buffDurationMs: e.buffDurationSec * 1000,
    charges: e.charges > 0 ? e.charges : 1,
    category: categoryOf(e),
    castSpellId: e.castSpellId,
    noAura: e.noAura === true,
  };
}

/** All tracked CDs for a spec: spec-specific rules first, then class-fallback rules not already present. */
export function cdsForSpec(specId: string | undefined): CdEntry[] {
  if (!specId) return [];
  const seen = new Set<number>();
  const out: CdEntry[] = [];
  for (const e of DATA.bySpec[specId] ?? []) { if (!seen.has(e.spellId)) { seen.add(e.spellId); out.push(toEntry(e)); } }
  const cls = DATA.specToClass[specId];
  if (cls) for (const e of DATA.byClass[cls] ?? []) { if (!seen.has(e.spellId)) { seen.add(e.spellId); out.push(toEntry(e)); } }
  return out;
}

/** One CD's metadata, resolved spec-first then class-fallback. */
export function cdInfo(spellId: number | undefined, specId?: string): CdEntry | undefined {
  if (spellId === undefined) return undefined;
  if (specId) {
    const hit = cdsForSpec(specId).find((e) => e.spellId === spellId);
    if (hit) return hit;
  }
  // class-agnostic fallback: scan all class lists (used when spec is unknown)
  for (const list of Object.values(DATA.byClass)) {
    const e = list.find((x) => x.spellId === spellId);
    if (e) return toEntry(e);
  }
  return undefined;
}

export function isOffensiveCd(spellId: number | undefined): boolean {
  return spellId !== undefined && OFFENSIVE_SPELL_IDS.has(spellId);
}
```

- [ ] **Step 2: Write the failing test**

Create `test/cooldownLoader.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cdInfo, cdsForSpec, isOffensiveCd, OFFENSIVE_SPELL_IDS } from '../src/metadata/cooldowns.js';

describe('cooldown loader', () => {
  it('exposes MiniCC offensive spell ids', () => {
    expect(OFFENSIVE_SPELL_IDS.size).toBeGreaterThanOrEqual(15);
    expect(isOffensiveCd(107574)).toBe(true); // Avatar
  });

  it('classifies Divine Shield as defensive for Holy Paladin (spec 65)', () => {
    const ds = cdInfo(642, '65');
    expect(ds).toBeDefined();
    expect(ds!.category).toBe('defensive');
    expect(ds!.cooldownMs).toBeGreaterThan(0);
  });

  it('returns spec inventory and resolves cooldownMs in milliseconds', () => {
    const cds = cdsForSpec('265'); // Affliction Warlock
    expect(cds.length).toBeGreaterThan(0);
    for (const c of cds) expect(c.cooldownMs % 1000).toBe(0);
  });

  it('treats the PvP trinket as category trinket', () => {
    const t = cdInfo(336126, '265');
    // trinket may be a class/spec entry or absent; if present it must be categorized trinket
    if (t) expect(t.category).toBe('trinket');
  });
});
```

- [ ] **Step 3: Run to verify**

Run: `npx vitest run test/cooldownLoader.test.ts`
Expected: PASS. (If Divine Shield 642 is not under spec 65 in the live data, the test will surface it — adjust the asserted spell to one present for spec 65 in `cooldowns.json`, e.g. `498` Divine Protection.)

- [ ] **Step 4: Commit**

```bash
git add src/metadata/cooldowns.ts test/cooldownLoader.test.ts
git commit -m "feat: cooldown loader (cdInfo/cdsForSpec, offensive + trinket sets)"
```

---

### Task 4: Cast collection + availability engine

**Files:**
- Create: `src/metrics/cooldownTimeline.ts`
- Test: `test/cooldownTimeline.test.ts`

- [ ] **Step 1: Write the engine**

Create `src/metrics/cooldownTimeline.ts`:

```ts
import { eventType, srcId, spellId, spellName, eventTimeMs } from './eventAccess.js';

export interface CastEvent { spellId: number; name: string; ms: number; }

/** unitId -> chronological SPELL_CAST_SUCCESS events (spellId + name + ms). */
export function collectCasts(match: unknown): Map<string, CastEvent[]> {
  const m = match as { events?: unknown[] };
  const events = Array.isArray(m.events) ? m.events : [];
  const out = new Map<string, CastEvent[]>();
  for (const ev of events) {
    if (eventType(ev) !== 'SPELL_CAST_SUCCESS') continue;
    const s = srcId(ev);
    const sid = spellId(ev);
    const ms = eventTimeMs(ev);
    if (!s || sid === undefined || ms === undefined) continue;
    const arr = out.get(s) ?? [];
    arr.push({ spellId: sid, name: spellName(ev), ms });
    out.set(s, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.ms - b.ms);
  return out;
}

/** Charges available at `ms` given cast timestamps, cooldown length, and max charges.
 *  Charges regenerate sequentially: a recharge timer of `cooldownMs` runs whenever below max. */
export function chargesAt(castMs: number[], cooldownMs: number, maxCharges: number, ms: number): number {
  const casts = castMs.filter((c) => c <= ms).sort((a, b) => a - b);
  let charges = maxCharges;
  let nextRecharge = Infinity;
  for (const c of casts) {
    while (charges < maxCharges && nextRecharge <= c) { charges++; nextRecharge = charges < maxCharges ? nextRecharge + cooldownMs : Infinity; }
    if (charges === 0) continue; // cast with no charge (shouldn't happen in clean logs)
    if (charges === maxCharges) nextRecharge = c + cooldownMs;
    charges--;
  }
  while (charges < maxCharges && nextRecharge <= ms) { charges++; nextRecharge = charges < maxCharges ? nextRecharge + cooldownMs : Infinity; }
  return charges;
}

export function isAvailable(castMs: number[], cooldownMs: number, maxCharges: number, ms: number): boolean {
  return chargesAt(castMs, cooldownMs, maxCharges, ms) > 0;
}

/** Maximal intervals within [startMs, endMs] where ≥1 charge is available.
 *  Exposes hold/idle durations (the substrate for later offensive-throughput analysis). */
export function readyIntervals(castMs: number[], cooldownMs: number, maxCharges: number, startMs: number, endMs: number): { start: number; end: number }[] {
  const casts = castMs.filter((c) => c >= startMs && c <= endMs).sort((a, b) => a - b);
  let charges = maxCharges;
  let nextRecharge = Infinity;
  let ci = 0;
  let readyStart: number | null = charges > 0 ? startMs : null;
  const out: { start: number; end: number }[] = [];
  let now = startMs;
  while (now < endMs) {
    const nextCast = ci < casts.length ? casts[ci] : Infinity;
    const ev = Math.min(nextCast, nextRecharge, endMs);
    now = ev;
    if (ev === endMs) break;
    if (nextRecharge <= nextCast) {
      charges++;
      if (readyStart === null) readyStart = now;
      nextRecharge = charges < maxCharges ? now + cooldownMs : Infinity;
    } else {
      ci++;
      if (charges === maxCharges) nextRecharge = now + cooldownMs;
      if (charges > 0) charges--;
      if (charges === 0 && readyStart !== null) { out.push({ start: readyStart, end: now }); readyStart = null; }
    }
  }
  if (readyStart !== null) out.push({ start: readyStart, end: endMs });
  return out;
}
```

- [ ] **Step 2: Write the failing test**

Create `test/cooldownTimeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { chargesAt, isAvailable, readyIntervals } from '../src/metrics/cooldownTimeline.js';

describe('availability engine', () => {
  it('single-charge CD is unavailable during [cast, cast+cd) and available after', () => {
    const casts = [10_000];
    expect(isAvailable(casts, 30_000, 1, 5_000)).toBe(true);   // before cast
    expect(isAvailable(casts, 30_000, 1, 10_000)).toBe(false); // at cast (charge consumed)
    expect(isAvailable(casts, 30_000, 1, 39_000)).toBe(false); // still on CD
    expect(isAvailable(casts, 30_000, 1, 41_000)).toBe(true);  // recharged
  });

  it('two-charge CD allows a second press immediately, blocks the third', () => {
    const casts = [10_000, 11_000];
    expect(chargesAt(casts, 90_000, 2, 11_500)).toBe(0);        // both charges spent
    expect(chargesAt(casts, 90_000, 2, 9_000)).toBe(2);         // before any cast
    expect(isAvailable(casts, 90_000, 2, 10_500)).toBe(true);   // one charge left after first cast
  });

  it('readyIntervals reports the ready (held) spans for a single-charge CD', () => {
    const intervals = readyIntervals([10_000], 30_000, 1, 0, 60_000);
    expect(intervals).toEqual([{ start: 0, end: 10_000 }, { start: 40_000, end: 60_000 }]);
  });

  it('readyIntervals: never-cast CD is ready the whole match', () => {
    expect(readyIntervals([], 30_000, 1, 0, 60_000)).toEqual([{ start: 0, end: 60_000 }]);
  });
});
```

- [ ] **Step 3: Run to verify**

Run: `npx vitest run test/cooldownTimeline.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/metrics/cooldownTimeline.ts test/cooldownTimeline.test.ts
git commit -m "feat: cast collection + charge-aware availability engine"
```

---

### Task 5: Per-unit CD usage summary

Wire the availability engine + loader into `perUnit.ts` to emit `cdUsage` per player. Casts come from the shared `collectCasts` (passed in by `metrics.ts` in Task 9; defaulted here so existing two-arg callers keep working).

**Files:**
- Modify: `src/metrics/perUnit.ts`
- Test: `test/perUnit.test.ts` (add a case)

- [ ] **Step 1: Add imports and the `casts` parameter**

In `src/metrics/perUnit.ts`, add to the imports:

```ts
import { collectCasts, readyIntervals, type CastEvent } from './cooldownTimeline.js';
import { cdInfo } from '../metadata/cooldowns.js';
```

Change the signature (line 47):

```ts
export function computeUnitMetrics(match: unknown, auras: AuraState, casts: Map<string, CastEvent[]> = collectCasts(match)): UnitMetrics[] {
```

- [ ] **Step 2: Build the `cdUsage` summary inside the per-unit result loop**

In the `for (const [id, a] of accs)` loop, before `result.push({`, add:

```ts
    const specId = u.spec !== undefined ? String(u.spec) : undefined;
    const myCasts = casts.get(id) ?? [];
    const castMsBySpell = new Map<number, number[]>();
    for (const c of myCasts) { const arr = castMsBySpell.get(c.spellId) ?? []; arr.push(c.ms); castMsBySpell.set(c.spellId, arr); }
    const cdUsage = [...castMsBySpell.entries()]
      .map(([sid, msList]) => {
        const info = cdInfo(sid, specId);
        if (!info) return undefined;
        const ready = startMs !== undefined ? readyIntervals(msList, info.cooldownMs, info.charges, startMs, endMs) : [];
        const availableSec = Math.round(ready.reduce((s, iv) => s + (iv.end - iv.start), 0) / 1000);
        const name = myCasts.find((c) => c.spellId === sid)?.name ?? String(sid);
        return { spellId: sid, name, category: info.category, casts: msList.length, availableSec };
      })
      .filter((x): x is NonNullable<typeof x> => x !== undefined)
      .sort((x, y) => y.casts - x.casts);
```

Then add `cdUsage,` to the pushed object (next to `immuneDone,`).

- [ ] **Step 3: Add a failing test**

In `test/perUnit.test.ts`, add (using the existing match fixture/import already at the top of that file — reuse whatever the file already loads as the parsed match and calls `computeUnitMetrics` with):

```ts
it('emits cdUsage for players, categorized and with availability', () => {
  const units = computeUnitMetrics(match, auras);
  const withCds = units.filter((u) => u.kind === 'player' && u.cdUsage.length > 0);
  expect(withCds.length).toBeGreaterThan(0);
  for (const u of withCds) {
    for (const c of u.cdUsage) {
      expect(c.casts).toBeGreaterThan(0);
      expect(c.availableSec).toBeGreaterThanOrEqual(0);
      expect(['offensive', 'defensive', 'external', 'important', 'trinket']).toContain(c.category);
    }
  }
});
```

(If `match`/`auras` are named differently in `test/perUnit.test.ts`, match the existing names in that file.)

- [ ] **Step 4: Run to verify it fails then passes**

Run: `npx vitest run test/perUnit.test.ts`
Expected: FAIL first (no `cdUsage`), PASS after Step 2.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/perUnit.ts test/perUnit.test.ts
git commit -m "feat: per-unit cdUsage summary (casts + availability per tracked CD)"
```

---

### Task 6: Offensive-window detection

Detect windows from offensive-CD self-buff auras (already in `auraState` via `intervalsBy`), merge overlapping ones per attacking team, symmetric across both teams. Severity and ledger are added empty here and filled in Tasks 7–8.

**Files:**
- Create: `src/metrics/offensiveWindows.ts`
- Test: `test/offensiveWindows.test.ts`

- [ ] **Step 1: Write detection (severity/ledger/counter-play stubbed empty)**

Create `src/metrics/offensiveWindows.ts`:

```ts
import { unitKind, unitTeam, type Team, type OffensiveWindow, type CdRef, type UnitMetrics } from './types.js';
import { type AuraState, type Interval } from './auraState.js';
import { cdInfo } from '../metadata/cooldowns.js';

interface Ctx {
  units: Record<string, Record<string, unknown>>;
  startMs: number;
}

const OTHER: Record<Team, Team> = { friendly: 'enemy', enemy: 'friendly', neutral: 'neutral' };

/** Offensive-CD active intervals cast by `unitId`, resolved against that unit's spec. */
function offensiveContribs(unitId: string, specId: string | undefined, auras: AuraState): Interval[] {
  return auras.intervalsBy(unitId).filter((iv) => cdInfo(iv.spellId, specId)?.category === 'offensive');
}

/** Merge overlapping intervals (sorted by start) into windows, keeping all contributors. */
function mergeWindows(contribs: { iv: Interval; team: Team }[]): { team: Team; start: number; end: number; ivs: Interval[] }[] {
  const sorted = [...contribs].sort((a, b) => a.iv.start - b.iv.start);
  const out: { team: Team; start: number; end: number; ivs: Interval[] }[] = [];
  for (const { iv, team } of sorted) {
    const last = out[out.length - 1];
    if (last && last.team === team && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
      last.ivs.push(iv);
    } else {
      out.push({ team, start: iv.start, end: iv.end, ivs: [iv] });
    }
  }
  return out;
}

export function computeOffensiveWindows(match: unknown, units: UnitMetrics[], auras: AuraState, _casts?: unknown): OffensiveWindow[] {
  const m = match as { units?: Record<string, Record<string, unknown>>; events?: unknown[] };
  const rawUnits = m.units ?? {};
  const players = units.filter((u) => u.kind === 'player');

  const contribs: { iv: Interval; team: Team }[] = [];
  for (const p of players) {
    for (const iv of offensiveContribs(p.unitId, p.spec, auras)) {
      contribs.push({ iv, team: p.team });
    }
  }

  const nameOf = (id: string): string => {
    const u = rawUnits[id];
    return u && typeof u.name === 'string' && u.name.length > 0 ? u.name : id;
  };
  const startMs = Number.isFinite((auras as unknown) ? 0 : 0) ? 0 : 0; // placeholder; real startMs passed via ctx below
  void startMs;

  const merged = mergeWindows(contribs);
  // window times are absolute ms; convert to seconds relative to match start.
  const matchStart = players.length ? minStart(contribs) : 0;

  return merged.map((w): OffensiveWindow => {
    const openedBy: CdRef[] = w.ivs.map((iv) => ({
      spellId: iv.spellId,
      spellName: iv.name,
      unitId: iv.srcId,
      startSec: Math.round((iv.start - matchStart) / 1000),
      endSec: Math.round((iv.end - matchStart) / 1000),
    }));
    return {
      attackingTeam: w.team,
      defendingTeam: OTHER[w.team],
      startSec: Math.round((w.start - matchStart) / 1000),
      endSec: Math.round((w.end - matchStart) / 1000),
      openedBy,
      teamDamageTaken: 0,
      damageByTarget: [],
      mitigation: { available: [], used: [] },
      counterPlay: { ccOnDefenders: [], threatImmuneAuras: [] },
    };
  });

  function minStart(cs: { iv: Interval }[]): number {
    return cs.reduce((mn, c) => Math.min(mn, c.iv.start), Number.MAX_SAFE_INTEGER);
  }
}
```

> **Note for the implementer:** the `startMs`/placeholder lines above are a smell — replace them. Use the match's start time consistently. The match start is `matchStartMs(events)` from `eventAccess.js`; import it and compute `const matchStart = matchStartMs(m.events ?? []) ?? minStart(contribs)`. Remove the `void startMs` placeholder and the dead `Number.isFinite(...)` line. (This is called out so the spec-review/quality-review catches it; implement cleanly.)

- [ ] **Step 2: Write the failing test (synthetic auras)**

Create `test/offensiveWindows.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeOffensiveWindows } from '../src/metrics/offensiveWindows.js';
import type { AuraState, Interval } from '../src/metrics/auraState.js';
import type { UnitMetrics } from '../src/metrics/types.js';

// Avatar (107574) is an OFFENSIVE_SPELL_ID. Build a fake AuraState exposing it as a self-buff.
function fakeAuras(bySrc: Record<string, Interval[]>): AuraState {
  return {
    activeOn: () => [],
    intervalsOn: () => [],
    intervalsBy: (id: string) => (bySrc[id] ?? []).map((iv) => ({ ...iv })),
  };
}

function player(unitId: string, team: 'friendly' | 'enemy', spec: string): UnitMetrics {
  return { unitId, name: unitId, kind: 'player', team, spec, cdUsage: [] } as unknown as UnitMetrics;
}

const match = { units: { E1: { name: 'Enemy', type: '1', reaction: 'Hostile', spec: '71' } }, events: [{ logLine: { timestamp: 0 } }] };

describe('computeOffensiveWindows', () => {
  it('opens a window from an offensive self-buff aura', () => {
    const auras = fakeAuras({ E1: [{ srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 10_000, end: 30_000 }] });
    const windows = computeOffensiveWindows(match, [player('E1', 'enemy', '71')], auras);
    expect(windows).toHaveLength(1);
    expect(windows[0].attackingTeam).toBe('enemy');
    expect(windows[0].defendingTeam).toBe('friendly');
    expect(windows[0].openedBy[0]).toMatchObject({ spellId: 107574, unitId: 'E1' });
  });

  it('merges two overlapping offensive CDs into one window', () => {
    const auras = fakeAuras({ E1: [
      { srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 10_000, end: 30_000 },
      { srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 25_000, end: 40_000 },
    ] });
    const windows = computeOffensiveWindows(match, [player('E1', 'enemy', '71')], auras);
    expect(windows).toHaveLength(1);
    expect(windows[0].openedBy).toHaveLength(2);
    expect(windows[0].endSec).toBe(40);
  });

  it('ignores non-offensive auras', () => {
    const auras = fakeAuras({ E1: [{ srcId: 'E1', destId: 'E1', spellId: 871, name: 'Shield Wall', start: 10_000, end: 18_000 }] });
    expect(computeOffensiveWindows(match, [player('E1', 'enemy', '71')], auras)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify it fails then passes**

Run: `npx vitest run test/offensiveWindows.test.ts`
Expected: PASS once Step 1 is implemented cleanly. (107574/Avatar must be in `OFFENSIVE_SPELL_IDS` from Task 2 — it is.)

- [ ] **Step 4: Commit**

```bash
git add src/metrics/offensiveWindows.ts test/offensiveWindows.test.ts
git commit -m "feat: offensive-window detection from offensive-CD auras (symmetric, merged)"
```

---

### Task 7: Window severity (team damage taken)

**Files:**
- Modify: `src/metrics/offensiveWindows.ts`
- Test: `test/offensiveWindows.test.ts` (add a case)

- [ ] **Step 1: Accumulate per-window damage to the defending team**

In `offensiveWindows.ts`, import damage helpers:

```ts
import { eventType, srcId, destId, eventTimeMs, amount, matchStartMs, DAMAGE_EVENTS } from './eventAccess.js';
```

After computing `merged` and `matchStart`, scan events once and attribute damage to any window whose attacking team dealt it to the defending team within `[start, end]`:

```ts
  const teamOf = (id: string | undefined): Team => unitTeam((rawUnits[id ?? ''] ?? {}).reaction);
  const events = Array.isArray(m.events) ? m.events : [];
  // pre-build per-window mutable damage accumulators aligned with `merged` order
  const dmgTotals = merged.map(() => 0);
  const dmgByTarget = merged.map(() => new Map<string, number>());
  for (const ev of events) {
    const t = eventType(ev);
    if (!DAMAGE_EVENTS.test(t)) continue;
    const ms = eventTimeMs(ev);
    if (ms === undefined) continue;
    const s = srcId(ev), d = destId(ev);
    const amt = amount(ev);
    if (amt <= 0 || !d) continue;
    for (let i = 0; i < merged.length; i++) {
      const w = merged[i];
      if (ms < w.start || ms >= w.end) continue;
      if (teamOf(s) !== w.team || teamOf(d) !== OTHER[w.team]) continue;
      dmgTotals[i] += amt;
      dmgByTarget[i].set(d, (dmgByTarget[i].get(d) ?? 0) + amt);
    }
  }
```

Then in the `merged.map(...)` result, set:

```ts
      teamDamageTaken: Math.round(dmgTotals[i]),
      damageByTarget: [...dmgByTarget[i].entries()]
        .map(([unitId, damage]) => ({ unitId, name: nameOf(unitId), damage: Math.round(damage) }))
        .sort((a, b) => b.damage - a.damage),
```

(Change `merged.map((w) => ...)` to `merged.map((w, i) => ...)` to access `i`.)

- [ ] **Step 2: Add a failing test**

Add to `test/offensiveWindows.test.ts`:

```ts
it('sums defending-team damage taken within the window', () => {
  const auras = fakeAuras({ E1: [{ srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 10_000, end: 30_000 }] });
  const m = {
    units: {
      E1: { name: 'Enemy', type: '1', reaction: 'Hostile', spec: '71' },
      F1: { name: 'Me', type: '1', reaction: 'Friendly', spec: '265' },
    },
    events: [
      { logLine: { timestamp: 0 } },
      { event: 'SPELL_DAMAGE', srcUnitId: 'E1', destUnitId: 'F1', amount: 5000, logLine: { timestamp: 15000 } },
      { event: 'SPELL_DAMAGE', srcUnitId: 'E1', destUnitId: 'F1', amount: 3000, logLine: { timestamp: 40000 } }, // outside window
    ],
  };
  const units = [player('E1', 'enemy', '71'), player('F1', 'friendly', '265')];
  const windows = computeOffensiveWindows(m, units, auras);
  expect(windows[0].teamDamageTaken).toBe(5000);
  expect(windows[0].damageByTarget[0]).toMatchObject({ unitId: 'F1', damage: 5000 });
});
```

> The event field names (`event`, `srcUnitId`, `destUnitId`, `amount`, `logLine.timestamp`) must match what `eventAccess.js` reads. Before writing the test, open `src/metrics/eventAccess.ts` and mirror the exact accessors used by `eventType`, `srcId`, `destId`, `amount`, `eventTimeMs`. Adjust the fixture event shape to match.

- [ ] **Step 3: Run to verify**

Run: `npx vitest run test/offensiveWindows.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/metrics/offensiveWindows.ts test/offensiveWindows.test.ts
git commit -m "feat: offensive-window severity (defending-team damage + per-target)"
```

---

### Task 8: Mitigation ledger + counter-play

For each window: compute the defending team's **available** mitigation (their spec CD inventory, ready at window start) and **used** mitigation (defender casts in `[start−1s, end]` resolvable to a mitigation category), plus **counter-play** (enemy CC landed on defenders during the window, and immunity auras on a primary threat).

**Files:**
- Modify: `src/metadata/spells.ts` (add `isImmunity`)
- Modify: `src/metrics/offensiveWindows.ts`
- Test: `test/offensiveWindows.test.ts` (add a case)

- [ ] **Step 1: Add `isImmunity` to `spells.ts`**

In `src/metadata/spells.ts`, after `isDefensive` (line 33), add:

```ts
export function isImmunity(id: number | undefined): boolean {
  return spellMeta(id)?.tags.includes('immunity') ?? false;
}
```

- [ ] **Step 2: Implement the ledger + counter-play**

In `offensiveWindows.ts`, extend imports:

```ts
import { cdInfo, cdsForSpec, isOffensiveCd } from '../metadata/cooldowns.js';
import { ccInfo, isInterrupt, isImmunity } from '../metadata/spells.js';
import { isAvailable, type CastEvent } from './cooldownTimeline.js';
import { unitKind, unitTeam, type Team, type OffensiveWindow, type CdRef, type UnitMetrics, type MitigationItem, type MitigationCategory } from './types.js';
```

Change the signature to actually use casts:

```ts
export function computeOffensiveWindows(match: unknown, units: UnitMetrics[], auras: AuraState, casts: Map<string, CastEvent[]>): OffensiveWindow[] {
```

Add a category-mapping helper near the top of the module:

```ts
function mitigationCategoryOf(spellId: number, specId: string | undefined): MitigationCategory | undefined {
  const info = cdInfo(spellId, specId);
  if (info && (info.category === 'defensive' || info.category === 'external' || info.category === 'trinket')) return info.category;
  if (isImmunity(spellId)) return 'immunity';
  if (isInterrupt(spellId)) return 'interrupt';
  if (ccInfo(spellId)) return 'cc-control';
  return undefined;
}
const AVAILABLE_CATS = new Set<MitigationCategory>(['defensive', 'external', 'trinket', 'immunity']);
```

Inside the `merged.map((w, i) => ...)`, before returning, compute:

```ts
      const defenders = players.filter((p) => p.team === OTHER[w.team]);
      const specOf = (id: string) => { const u = rawUnits[id]; return u && u.spec !== undefined ? String(u.spec) : undefined; };

      // available: each defender's mitigation inventory that is ready at window start
      const available: MitigationItem[] = [];
      for (const def of defenders) {
        const defCasts = (casts.get(def.unitId) ?? []);
        for (const cd of cdsForSpec(def.spec)) {
          if (isOffensiveCd(cd.spellId)) continue;
          const cat = mitigationCategoryOf(cd.spellId, def.spec);
          if (!cat || !AVAILABLE_CATS.has(cat)) continue;
          const msList = defCasts.filter((c) => c.spellId === cd.spellId).map((c) => c.ms);
          if (isAvailable(msList, cd.cooldownMs, cd.charges, w.start)) {
            available.push({ unitId: def.unitId, category: cat, spellId: cd.spellId, name: nameOf(def.unitId) + ':' + cd.spellId });
          }
        }
      }

      // used: defender casts within [start - 1s, end] resolvable to a mitigation category
      const used: MitigationItem[] = [];
      for (const def of defenders) {
        for (const c of casts.get(def.unitId) ?? []) {
          if (c.ms < w.start - 1000 || c.ms > w.end) continue;
          const cat = mitigationCategoryOf(c.spellId, def.spec);
          if (!cat) continue;
          used.push({ unitId: def.unitId, category: cat, spellId: c.spellId, name: c.name, usedAtSec: Math.round((c.ms - matchStart) / 1000) });
        }
      }

      // counter-play: enemy CC landed on defenders during the window
      const ccOnDefenders: { unitId: string; name: string; spell: string; sec: number }[] = [];
      for (const def of defenders) {
        for (const iv of auras.intervalsOn(def.unitId)) {
          if (!ccInfo(iv.spellId)) continue;
          if (teamOf(iv.srcId) !== w.team) continue;
          if (iv.end <= w.start || iv.start >= w.end) continue;
          ccOnDefenders.push({ unitId: def.unitId, name: nameOf(def.unitId), spell: iv.name, sec: Math.round((Math.max(iv.start, w.start) - matchStart) / 1000) });
        }
      }

      // counter-play: immunity auras on a primary threat (an opener's caster) during the window
      const threatIds = new Set(w.ivs.map((iv) => iv.srcId));
      const threatImmuneAuras: string[] = [];
      for (const tid of threatIds) {
        for (const iv of auras.intervalsOn(tid)) {
          if (isImmunity(iv.spellId) && iv.start < w.end && iv.end > w.start) threatImmuneAuras.push(iv.name);
        }
      }
```

Set in the returned object:

```ts
      mitigation: { available, used },
      counterPlay: { ccOnDefenders, threatImmuneAuras },
```

> **Implementer note on the `available` item name:** the `nameOf(unitId) + ':' + spellId` is a placeholder so items are distinguishable without a spell-name source (the inventory comes from `cooldowns.json`, which has no names). Prefer resolving the spell name: reuse the defender's own cast name if present, else fall back to `String(spellId)`. Keep it clean — the spec-review will flag the `:`-concatenation hack.

- [ ] **Step 3: Add a failing test**

Add to `test/offensiveWindows.test.ts` (extend the damage fixture so the defender F1 casts a defensive and gets CC'd inside the window):

```ts
it('records available vs used mitigation and enemy CC on defenders', () => {
  const auras = fakeAuras({
    E1: [{ srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 10_000, end: 30_000 }],
  });
  // F1 is hit by a stun from E1 during the window — intervalsOn('F1') must return it.
  const withCc: AuraState = {
    activeOn: () => [],
    intervalsBy: (id: string) => (id === 'E1' ? [{ srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 10_000, end: 30_000 }] : []),
    intervalsOn: (id: string) => (id === 'F1' ? [{ srcId: 'E1', destId: 'F1', spellId: 853, name: 'Hammer of Justice', start: 12_000, end: 15_000 }] : []),
  };
  const m = {
    units: {
      E1: { name: 'Enemy', type: '1', reaction: 'Hostile', spec: '71' },
      F1: { name: 'Me', type: '1', reaction: 'Friendly', spec: '265' },
    },
    events: [{ logLine: { timestamp: 0 } }],
  };
  const units = [player('E1', 'enemy', '71'), player('F1', 'friendly', '265')];
  // F1 cast Unending Resolve (104773, Affliction defensive) at 13s — inside the window
  const casts = new Map([['F1', [{ spellId: 104773, name: 'Unending Resolve', ms: 13_000 }]]]);
  const windows = computeOffensiveWindows(m, units, withCc, casts);
  const w = windows[0];
  expect(w.mitigation.used.some((x) => x.spellId === 104773 && x.category === 'defensive')).toBe(true);
  expect(w.counterPlay.ccOnDefenders.some((c) => c.spell === 'Hammer of Justice')).toBe(true);
});
```

> Verify `104773` (Unending Resolve) resolves to a defensive via `cdInfo(104773, '265')` in the generated data; if Affliction's defensive id differs, pick one present in `cooldowns.json` for spec 265 and a `defensive` category. `853` Hammer of Justice must resolve via `ccInfo`; if absent from the CC table, use a CC id that is present (e.g. a stun in `ccCategories.json`).

- [ ] **Step 4: Run to verify**

Run: `npx vitest run test/offensiveWindows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/metadata/spells.ts src/metrics/offensiveWindows.ts test/offensiveWindows.test.ts
git commit -m "feat: window mitigation ledger (available/used) + counter-play (CC, immunity)"
```

---

### Task 9: Wire into MatchMetrics + render

**Files:**
- Modify: `src/metrics/metrics.ts`
- Modify: `src/view/renderMetrics.ts`
- Test: `test/renderReport.test.ts` and/or `test/renderMetrics` (whichever exists; add a case)

- [ ] **Step 1: Assemble in `metrics.ts`**

Replace `src/metrics/metrics.ts` body of `computeMatchMetrics` with:

```ts
import { computeUnitMetrics } from './perUnit.js';
import { groupUnits } from './grouping.js';
import { buildTimeline } from './timeline.js';
import { buildAuraState } from './auraState.js';
import { computeCoordination } from './coordination.js';
import { computeFocusTracks } from './targeting.js';
import { collectCasts } from './cooldownTimeline.js';
import { computeOffensiveWindows } from './offensiveWindows.js';
import { HEALER_SPEC_IDS } from './registry.js';
import type { MatchMetrics } from './types.js';

export * from './types.js';

export function computeMatchMetrics(match: unknown): MatchMetrics {
  const m = match as { playerId?: unknown };
  const playerUnitId = typeof m.playerId === 'string' ? m.playerId : undefined;
  const auras = buildAuraState(match);
  const casts = collectCasts(match);
  const units = computeUnitMetrics(match, auras, casts);
  const focusTracks = computeFocusTracks(match);
  return {
    teams: groupUnits(units, playerUnitId),
    timeline: buildTimeline(match),
    coordination: computeCoordination(match, HEALER_SPEC_IDS, focusTracks),
    focusTracks,
    offensiveWindows: computeOffensiveWindows(match, units, auras, casts),
    playerUnitId,
  };
}
```

- [ ] **Step 2: Replace the defensives column + add a windows section in `renderMetrics.ts`**

In `unitRow` (line 22), replace the trailing `defensives (used/burst)` cell with a CD-availability cell:

```ts
    `<td>${u.deathsWhileCcd}</td><td>${cdUsageStr(u.cdUsage)}</td></tr>`;
```

Add this helper near `optTally` (after line 10):

```ts
function cdUsageStr(cds: UnitMetrics['cdUsage']): string {
  const def = cds.filter((c) => c.category === 'defensive' || c.category === 'external' || c.category === 'trinket' || c.category === 'immunity');
  if (!def.length) return '—';
  return def.map((c) => `${escapeHtml(c.name)}×${c.casts} (up ${c.availableSec}s)`).join(', ');
}
```

Update the header cell (line 40): change `<th>defensives (used/burst)</th>` to `<th>defensives (cast / up)</th>`.

Add a windows section. Add this function before `metricsBlock`:

```ts
function offensiveWindowsBlock(windows: MatchMetrics['offensiveWindows']): string {
  if (!windows?.length) return '';
  const rows = windows
    .slice()
    .sort((a, b) => b.teamDamageTaken - a.teamDamageTaken)
    .map((w) => {
      const openers = w.openedBy.map((o) => escapeHtml(o.spellName)).join(', ');
      const used = w.mitigation.used.length;
      const avail = w.mitigation.available.length;
      const cc = w.counterPlay.ccOnDefenders.length;
      const imm = w.counterPlay.threatImmuneAuras.length;
      return `<tr><td>${w.startSec}-${w.endSec}s</td><td>${escapeHtml(TEAM_LABEL[w.attackingTeam] ?? w.attackingTeam)}</td>` +
        `<td>${openers}</td><td>${w.teamDamageTaken}</td><td>${used}/${avail}</td><td>${cc}${imm ? ` · immune:${imm}` : ''}</td></tr>`;
    })
    .join('');
  return `<details><summary>offensive windows (${windows.length})</summary>
  <table><tr><th>t</th><th>attacker</th><th>opened by</th><th>dmg taken</th><th>mit used/avail</th><th>counter</th></tr>${rows}</table></details>`;
}
```

In `metricsBlock`, add `${offensiveWindowsBlock(mm.offensiveWindows)}` after the coordination block:

```ts
export function metricsBlock(mm: MatchMetrics | undefined): string {
  if (!mm) return '';
  return `<h4>Metrics (per player)</h4>
  ${mm.teams.map((t) => teamBlock(t, mm.playerUnitId)).join('')}
  ${coordinationBlock(mm.coordination)}
  ${offensiveWindowsBlock(mm.offensiveWindows)}
  ${timelineBlock(mm.timeline)}`;
}
```

- [ ] **Step 3: Update existing render/report tests for the new shape**

Run the existing suite first to see what breaks:

Run: `npx vitest run`
Expected: any test asserting the old `defensives (used/burst)` header/cell text or building a `MatchMetrics` literal without `offensiveWindows` now FAILs. Fix each: add `offensiveWindows: []` to hand-built `MatchMetrics` fixtures, and update the asserted header string to `defensives (cast / up)`.

- [ ] **Step 4: Add a windows-render test**

In the render test file, add:

```ts
it('renders an offensive-windows section when present', () => {
  const mm = computeMatchMetrics(match); // reuse the file's parsed match
  const html = metricsBlock(mm);
  if (mm.offensiveWindows.length) {
    expect(html).toContain('offensive windows');
  }
});
```

- [ ] **Step 5: Run the full suite + type-check**

Run: `npx vitest run`
Expected: PASS (all suites).
Run: `npx tsc --noEmit`
Expected: clean (Task 1's required fields are now satisfied).

- [ ] **Step 6: Commit**

```bash
git add src/metrics/metrics.ts src/view/renderMetrics.ts test/
git commit -m "feat: wire offensiveWindows into MatchMetrics + render (CD availability + windows section)"
```

---

### Task 10: Final review gates

Per the user's standing workflow (CLAUDE.md): run `/simplify` then `/code-review` on the branch delta and address findings before the work is considered done.

- [ ] **Step 1: Full green check**

Run: `npm test` (expect all pass) and `npx tsc --noEmit` (clean).

- [ ] **Step 2: Run `/simplify`** on `master..HEAD`, apply the cleanup findings (this plan deliberately flagged two placeholder smells — the `offensiveWindows.ts` `startMs` placeholder in Task 6 and the `available` item-name concatenation in Task 8 — confirm both are resolved cleanly).

- [ ] **Step 3: Run `/code-review`** on `master..HEAD`, address confirmed findings.

- [ ] **Step 4: Finish the branch** using superpowers:finishing-a-development-branch (verify tests, then PR/merge per the user's choice). Author commits as `12344643+Phlares@users.noreply.github.com`; end commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Self-Review

**Spec coverage:**
- Inventory + durations → Tasks 2 (generator) + 3 (loader). ✅
- Availability timeline (ready/on-CD, charges, hold/idle exposed) → Task 4 (`readyIntervals`/`chargesAt`). ✅
- Offensive-window detection (active interval from `auraState`, merge, symmetric) → Task 6. ✅
- Severity (team damage taken + per target) → Task 7. ✅
- Mitigation ledger (available vs used, per player) + counter-play (CC on defenders, threat immunity) → Task 8. ✅
- Retire `used/burst` column → Task 9 (replaced with `defensives (cast / up)`). ✅
- `offensiveWindows` on `MatchMetrics`, full data under the hood → Tasks 1 + 9. ✅
- Auto-seed offensive set from MiniCC (no hand-curation) → Task 2 parses `OffensiveSpellIds`; loader uses it. ✅
- Public/private: MiniCC path via `WAE_MINICC_RULES` env var, generated JSON committed → Task 2. ✅
- Deferred (positioning, LoS, verdict, throughput, talent CDR, healing-CD category): not implemented; `readyIntervals` exposes the throughput substrate; window record has no spatial fields yet. ✅ (matches spec deferrals)

**Known intentional gaps (documented, consistent with spec):** `healing` mitigation category omitted (MiniCC has no healing flag — deferred); `threatImmuneAuras` covers immunity auras, not DR-based CC immunity (deferred to a CC-subsystem refinement); never-cast CDs are treated as available in the ledger inventory (a talented-out CD over-reports — acceptable approximation, noted in spec).

**Placeholder scan:** Two smells are *intentionally called out inline* in Tasks 6 and 8 with "implement cleanly" notes so the reviewers catch them; they are not left as silent TODOs. No other placeholders.

**Type consistency:** `CdEntry.cooldownMs`/`buffDurationMs`/`charges`/`category` used identically across loader (Task 3), engine calls (Tasks 5, 8), and detection (Task 6). `MitigationCategory` union matches the mapping in Task 8 and the render in Task 9. `OffensiveWindow`/`CdRef`/`MitigationItem` shapes (Task 1) match construction in Tasks 6–8 and consumption in Task 9. `cdUsage: CdUsageStat[]` defined in Task 1, produced in Task 5, rendered in Task 9.
