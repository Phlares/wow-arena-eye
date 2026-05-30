# Debug Readout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `npm run view -- <log>` command that renders a self-contained `output/report.html` showing parsed match boundaries, combatants, event-type counts, and a naive sidecar timestamp-match preview, so the pipeline's output is inspectable in a browser.

**Architecture:** Reuse `parseLogFile`/`loadConfig` from Plan 1. A `sidecarIndex` loads Warcraft Recorder `.json` sidecars into a normalized list. A pure `renderReport(matches, index)` returns an HTML string (testable without a browser). A thin `view` CLI projects parsed matches into a view model, loads sidecars, renders, and writes the file. Field access into the parser's match/unit/event objects is intentionally defensive — this is a shape-discovery debug tool.

**Tech Stack:** TypeScript/ESM (Node ≥22), Vitest. No framework, no server, no styling beyond a few legibility rules. Native `<details>` for collapse, browser Ctrl+F for search.

---

## File Structure

```
src/
  util/logFiles.ts          # firstLog() — shared log-selection (extracted from ingest.ts)
  sidecar/sidecarIndex.ts   # loadSidecarIndex() + SidecarEntry/SidecarIndex
  view/renderReport.ts      # renderReport() (pure) + ParsedMatchView/ViewCombatant + escapeHtml
  view/projectMatch.ts      # projectMatch() : parser match object -> ParsedMatchView (defensive)
  cli/view.ts               # `npm run view` glue
  cli/ingest.ts             # MODIFIED: import firstLog from util/logFiles
test/
  sidecarIndex.test.ts
  renderReport.test.ts
  projectMatch.test.ts
package.json                # MODIFIED: add "view" script
```

---

## Task 1: Sidecar index

**Files:** Create `src/sidecar/sidecarIndex.ts`, `test/sidecarIndex.test.ts`

- [ ] **Step 1: Write the failing test** — `test/sidecarIndex.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSidecarIndex } from '../src/sidecar/sidecarIndex.js';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'wae-sc-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe('loadSidecarIndex', () => {
  it('parses a sidecar and derives start time from the filename', () => {
    const d = tempDir();
    // No explicit epoch field -> start time must come from the filename pattern.
    writeFileSync(
      join(d, '2026-05-29 02-36-18 - YourName - 3v3 Nagrand (Win).json'),
      JSON.stringify({
        category: '3v3',
        zoneName: 'Nagrand',
        duration: 123,
        result: true,
        combatants: [{ _name: 'YourName', _specID: 265, _teamID: 0 }],
      }),
      'utf8',
    );
    const idx = loadSidecarIndex([d]);
    expect(idx.loaded).toBe(1);
    expect(idx.skipped).toBe(0);
    const e = idx.entries[0];
    expect(e.category).toBe('3v3');
    expect(e.zoneName).toBe('Nagrand');
    expect(e.result).toBe(true);
    expect(e.durationSec).toBe(123);
    expect(e.combatants).toEqual([{ name: 'YourName', specId: 265, teamId: 0 }]);
    expect(typeof e.startEpochMs).toBe('number'); // parsed from "2026-05-29 02-36-18"
  });

  it('skips non-sidecar / unparseable json and counts it', () => {
    const d = tempDir();
    writeFileSync(join(d, 'junk.json'), '{ not valid json', 'utf8');
    writeFileSync(join(d, 'notsidecar.json'), JSON.stringify({ hello: 'world' }), 'utf8');
    const idx = loadSidecarIndex([d]);
    // junk.json fails to parse -> skipped; notsidecar.json parses but lacks sidecar fields -> skipped
    expect(idx.loaded).toBe(0);
    expect(idx.skipped).toBe(2);
  });

  it('returns an empty index when a dir does not exist', () => {
    const idx = loadSidecarIndex(['/no/such/dir']);
    expect(idx.loaded).toBe(0);
    expect(idx.entries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/sidecarIndex.test.ts`
Expected: FAIL — cannot resolve `../src/sidecar/sidecarIndex.js`.

- [ ] **Step 3: Implement `src/sidecar/sidecarIndex.ts`**

```ts
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export interface SidecarCombatant {
  name: string;
  specId: number;
  teamId: number;
}

export interface SidecarEntry {
  jsonPath: string;
  videoPath: string; // sibling .mp4 if present, else the json path
  startEpochMs: number | null;
  category: string | null;
  zoneName: string | null;
  result: boolean | null;
  durationSec: number | null;
  combatants: SidecarCombatant[];
}

export interface SidecarIndex {
  entries: SidecarEntry[];
  loaded: number;
  skipped: number;
}

/** Parse "YYYY-MM-DD HH-MM-SS" from a filename into epoch ms (local time). Null if absent. */
function startFromFilename(name: string): number | null {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})[ _](\d{2})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const ms = dt.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** A parsed JSON object counts as a sidecar if it has the recorder's recognizable fields. */
function isSidecar(o: Record<string, unknown>): boolean {
  return (
    typeof o.category === 'string' ||
    Array.isArray(o.combatants) ||
    typeof o.zoneName === 'string' ||
    typeof o.zoneID === 'number'
  );
}

function listJsonFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...listJsonFiles(full));
    else if (name.toLowerCase().endsWith('.json')) out.push(full);
  }
  return out;
}

export function loadSidecarIndex(videoDirs: string[]): SidecarIndex {
  const entries: SidecarEntry[] = [];
  let skipped = 0;

  for (const dir of videoDirs) {
    for (const jsonPath of listJsonFiles(dir)) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
      } catch {
        skipped += 1;
        continue;
      }
      if (!obj || typeof obj !== 'object' || !isSidecar(obj)) {
        skipped += 1;
        continue;
      }

      const startField = typeof obj.start === 'number' ? (obj.start as number) : null;
      const startEpochMs = startField ?? startFromFilename(basename(jsonPath));

      const rawCombatants = Array.isArray(obj.combatants) ? (obj.combatants as Record<string, unknown>[]) : [];
      const combatants: SidecarCombatant[] = rawCombatants.map((c) => ({
        name: typeof c._name === 'string' ? c._name : '',
        specId: typeof c._specID === 'number' ? c._specID : -1,
        teamId: typeof c._teamID === 'number' ? c._teamID : -1,
      }));

      const mp4 = jsonPath.replace(/\.json$/i, '.mp4');
      entries.push({
        jsonPath,
        videoPath: existsSync(mp4) ? mp4 : jsonPath,
        startEpochMs,
        category: typeof obj.category === 'string' ? obj.category : null,
        zoneName: typeof obj.zoneName === 'string' ? obj.zoneName : null,
        result: typeof obj.result === 'boolean' ? obj.result : null,
        durationSec: typeof obj.duration === 'number' ? obj.duration : null,
        combatants,
      });
    }
  }

  return { entries, loaded: entries.length, skipped };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/sidecarIndex.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/sidecarIndex.ts test/sidecarIndex.test.ts
git commit -m "feat: sidecar index (load + normalize Warcraft Recorder json)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Pure HTML report renderer

**Files:** Create `src/view/renderReport.ts`, `test/renderReport.test.ts`

- [ ] **Step 1: Write the failing test** — `test/renderReport.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { renderReport, type ParsedMatchView } from '../src/view/renderReport.js';
import type { SidecarIndex } from '../src/sidecar/sidecarIndex.js';

function match(over: Partial<ParsedMatchView> = {}): ParsedMatchView {
  return {
    kind: 'arena',
    bracket: '3v3',
    zone: 'Nagrand',
    isRanked: true,
    startTimeMs: 1_780_013_360_342,
    startTimeIso: '2026-05-28T20:09:20.342Z',
    endTimeMs: 1_780_013_489_342,
    durationSec: 129,
    result: 3,
    winningTeamId: '1',
    eventCounts: { SPELL_INTERRUPT: 4, SPELL_DISPEL: 2, UNIT_DIED: 1 },
    combatants: [{ name: "Phlér'gus", spec: 'Warlock_Affliction', type: 'Player', reaction: 'Friendly' }],
    rawStartInfo: { bracket: '3v3' },
    rawEndInfo: { winningTeamId: '1' },
    ...over,
  };
}

function index(over: Partial<SidecarIndex> = {}): SidecarIndex {
  return { entries: [], loaded: 0, skipped: 0, ...over };
}

describe('renderReport', () => {
  it('renders boundaries, combatants (HTML-escaped), and event counts', () => {
    const html = renderReport([match()], index());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('3v3');
    expect(html).toContain('129');
    expect(html).toContain('SPELL_INTERRUPT');
    // Name with an apostrophe/accent must be HTML-escaped, not break markup
    expect(html).toContain('Phl&#233;r&#39;gus');
  });

  it('shows the nearest sidecar and the delta in seconds when in window', () => {
    const idx = index({
      loaded: 1,
      entries: [
        {
          jsonPath: '/v/clip.json',
          videoPath: '/v/clip.mp4',
          startEpochMs: 1_780_013_360_342 + 5000, // 5s after match start
          category: '3v3',
          zoneName: 'Nagrand',
          result: true,
          durationSec: 130,
          combatants: [],
        },
      ],
    });
    const html = renderReport([match()], idx);
    expect(html).toContain('clip.mp4');
    expect(html).toContain('5.0'); // 5.0s delta
  });

  it('shows "no video match" when the nearest sidecar is outside the window', () => {
    const idx = index({
      loaded: 1,
      entries: [
        {
          jsonPath: '/v/far.json',
          videoPath: '/v/far.mp4',
          startEpochMs: 1_780_013_360_342 + 60 * 60 * 1000, // 1h away
          category: '3v3',
          zoneName: 'Nagrand',
          result: true,
          durationSec: 130,
          combatants: [],
        },
      ],
    });
    const html = renderReport([match()], idx);
    expect(html).toContain('no video match');
  });

  it('renders a valid document with zero matches', () => {
    const html = renderReport([], index());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('0 matches');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/renderReport.test.ts`
Expected: FAIL — cannot resolve `../src/view/renderReport.js`.

- [ ] **Step 3: Implement `src/view/renderReport.ts`**

```ts
import type { SidecarIndex, SidecarEntry } from '../sidecar/sidecarIndex.js';

export interface ViewCombatant {
  name: string;
  spec: string;
  type: string;
  reaction: string;
}

export interface ParsedMatchView {
  kind: 'arena' | 'shuffleRound';
  bracket: string;
  zone: string;
  isRanked: boolean | null;
  startTimeMs: number | null;
  startTimeIso: string | null;
  endTimeMs: number | null;
  durationSec: number | null;
  result: unknown;
  winningTeamId: unknown;
  eventCounts: Record<string, number>;
  combatants: ViewCombatant[];
  rawStartInfo: unknown;
  rawEndInfo: unknown;
}

export interface RenderOpts {
  sourceLogPath?: string;
  aborted?: boolean;
  linesAfterError?: number;
}

const MATCH_WINDOW_MS = 15 * 60 * 1000;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&#34;' : '&#39;',
  ).replace(/[^\x00-\x7F]/g, (c) => `&#${c.codePointAt(0)};`);
}

function nearest(idx: SidecarIndex, startMs: number | null): { entry: SidecarEntry; deltaMs: number } | null {
  if (startMs === null) return null;
  let best: { entry: SidecarEntry; deltaMs: number } | null = null;
  for (const e of idx.entries) {
    if (e.startEpochMs === null) continue;
    const deltaMs = Math.abs(e.startEpochMs - startMs);
    if (best === null || deltaMs < best.deltaMs) best = { entry: e, deltaMs };
  }
  return best;
}

function matchSection(m: ParsedMatchView, idx: SidecarIndex): string {
  const near = nearest(idx, m.startTimeMs);
  let videoBlock: string;
  if (near && near.deltaMs <= MATCH_WINDOW_MS) {
    const sec = (near.deltaMs / 1000).toFixed(1);
    videoBlock =
      `<p class="vid">nearest video (naive ±15min preview): ` +
      `<code>${escapeHtml(near.entry.videoPath)}</code> — delta <b>${sec}s</b> — ` +
      `category ${escapeHtml(near.entry.category ?? '?')} / zone ${escapeHtml(near.entry.zoneName ?? '?')}</p>`;
  } else {
    videoBlock = `<p class="vid">no video match within ±15min (naive preview)</p>`;
  }

  const combatRows = m.combatants
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.spec)}</td>` +
        `<td>${escapeHtml(c.type)}</td><td>${escapeHtml(c.reaction)}</td></tr>`,
    )
    .join('');

  const eventRows = Object.entries(m.eventCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`)
    .join('');

  const summary =
    `${escapeHtml(m.bracket)} · ${escapeHtml(m.zone)} · result=${escapeHtml(String(m.result))} · ` +
    `${m.durationSec ?? '?'}s · ${escapeHtml(m.kind)}`;

  return `<details class="match">
  <summary>${summary}</summary>
  <p>start: ${escapeHtml(m.startTimeIso ?? String(m.startTimeMs))} (epoch ${m.startTimeMs ?? '?'}) ·
     end epoch ${m.endTimeMs ?? '?'} · ranked=${m.isRanked ?? '?'} · winningTeamId=${escapeHtml(String(m.winningTeamId))}</p>
  ${videoBlock}
  <h4>Combatants (${m.combatants.length})</h4>
  <table><tr><th>name</th><th>spec</th><th>type</th><th>reaction</th></tr>${combatRows}</table>
  <h4>Event counts</h4>
  <table><tr><th>event</th><th>count</th></tr>${eventRows}</table>
  <details><summary>raw startInfo / endInfo</summary>
  <pre>${escapeHtml(JSON.stringify({ startInfo: m.rawStartInfo, endInfo: m.rawEndInfo }, null, 2))}</pre></details>
</details>`;
}

export function renderReport(matches: ParsedMatchView[], idx: SidecarIndex, opts: RenderOpts = {}): string {
  const deltas: number[] = [];
  for (const m of matches) {
    const near = nearest(idx, m.startTimeMs);
    if (near && near.deltaMs <= MATCH_WINDOW_MS) deltas.push(near.deltaMs);
  }
  deltas.sort((a, b) => a - b);
  const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const deltaSummary =
    deltas.length > 0
      ? `match→video deltas: min ${fmt(deltas[0])}, median ${fmt(deltas[Math.floor(deltas.length / 2)])}, max ${fmt(deltas[deltas.length - 1])} (n=${deltas.length})`
      : 'match→video deltas: none in window';

  const abortBanner = opts.aborted
    ? `<p class="warn">WARNING: parse aborted — ${opts.linesAfterError ?? 0} lines dropped after a parser error; data is INCOMPLETE.</p>`
    : '';

  const body = matches.length > 0 ? matches.map((m) => matchSection(m, idx)).join('\n') : '<p>0 matches parsed.</p>';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>wow-arena-eye debug report</title>
<style>
body{font-family:monospace;margin:1rem;line-height:1.4}
table{border-collapse:collapse;margin:.3rem 0}
td,th{border:1px solid #ccc;padding:2px 8px;text-align:left}
.match{border:1px solid #999;margin:.4rem 0;padding:.3rem .6rem}
summary{cursor:pointer;font-weight:bold}
.vid{color:#225}
.warn{color:#a00;font-weight:bold}
pre{background:#f4f4f4;padding:.4rem;overflow:auto}
header{border-bottom:2px solid #333;margin-bottom:.6rem}
</style></head><body>
<header>
<h2>wow-arena-eye debug report</h2>
<p>source log: <code>${escapeHtml(opts.sourceLogPath ?? '(unknown)')}</code></p>
<p>${matches.length} matches · sidecars loaded ${idx.loaded} / skipped ${idx.skipped}</p>
<p>${escapeHtml(deltaSummary)}</p>
${abortBanner}
</header>
${body}
</body></html>`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/renderReport.test.ts`
Expected: PASS — 4 tests. (If the escaped-name assertion fails, check `escapeHtml` handles the apostrophe → `&#39;` and `é` → `&#233;`.)

- [ ] **Step 5: Commit**

```bash
git add src/view/renderReport.ts test/renderReport.test.ts
git commit -m "feat: pure HTML debug-report renderer with sidecar delta preview

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Match projection + shared log selection + CLI + real report

**Files:** Create `src/view/projectMatch.ts`, `src/util/logFiles.ts`, `src/cli/view.ts`, `test/projectMatch.test.ts`. Modify `src/cli/ingest.ts`, `package.json`.

- [ ] **Step 1: Extract `firstLog` into `src/util/logFiles.ts`**

Create `src/util/logFiles.ts`:
```ts
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Most recently modified WoWCombatLog file in dir (filenames are not chronological). */
export function firstLog(dir: string): string {
  const files = readdirSync(dir).filter((n) => n.startsWith('WoWCombatLog'));
  if (files.length === 0) throw new Error(`No WoWCombatLog files in ${dir}`);
  const paths = files.map((n) => join(dir, n));
  paths.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return paths[0];
}
```
Then edit `src/cli/ingest.ts`: remove its local `firstLog` function, remove `statSync` from its `node:fs` import if now unused (keep `readdirSync`? it is no longer used either — remove it; keep `mkdirSync, writeFileSync`), and add `import { firstLog } from '../util/logFiles.js';`. Verify `src/cli/ingest.ts` still imports only what it uses.

- [ ] **Step 2: Write the failing projection test** — `test/projectMatch.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLogFile } from '../src/parser/parserClient.js';
import { projectMatch } from '../src/view/projectMatch.js';

describe('projectMatch (real fixture)', () => {
  const FIXTURE = 'test-data/fixtures/arena-sample.log';
  it.runIf(existsSync(FIXTURE))('projects a parsed arena match into a view model', async () => {
    const res = await parseLogFile(FIXTURE);
    const view = projectMatch(res.arenaMatches[0], 'arena');
    expect(view.kind).toBe('arena');
    expect(view.bracket).toBe('3v3');
    expect(view.durationSec).toBeGreaterThan(0);
    expect(view.combatants.length).toBeGreaterThanOrEqual(6);
    // event histogram is populated and includes at least one known event type
    expect(Object.keys(view.eventCounts).length).toBeGreaterThan(0);
    const totalEvents = Object.values(view.eventCounts).reduce((a, b) => a + b, 0);
    expect(totalEvents).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run test/projectMatch.test.ts`
Expected: FAIL — cannot resolve `../src/view/projectMatch.js`.

- [ ] **Step 4: Implement `src/view/projectMatch.ts`** (defensive — this is a debug/shape-discovery tool)

```ts
import type { ParsedMatchView, ViewCombatant } from './renderReport.js';

type Anon = Record<string, unknown>;

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

/** Best-effort event-type key for a parsed combat event across possible shapes. */
function eventType(ev: unknown): string {
  const e = ev as Anon;
  const fromLine = (e?.logLine as Anon | undefined)?.event;
  return str(e?.logEvent ?? e?.event ?? fromLine ?? 'UNKNOWN') || 'UNKNOWN';
}

export function projectMatch(raw: unknown, kind: 'arena' | 'shuffleRound'): ParsedMatchView {
  const m = raw as Anon;
  const startInfo = (m.startInfo as Anon | undefined) ?? {};

  const units = (m.units as Record<string, Anon> | undefined) ?? {};
  const combatants: ViewCombatant[] = Object.values(units).map((u) => ({
    name: str(u.name),
    spec: str(u.spec),
    type: str(u.type),
    reaction: str(u.reaction),
  }));

  const eventCounts: Record<string, number> = {};
  const events = Array.isArray(m.events) ? m.events : [];
  for (const ev of events) {
    const t = eventType(ev);
    eventCounts[t] = (eventCounts[t] ?? 0) + 1;
  }

  const startMs = typeof startInfo.timestamp === 'number' ? (startInfo.timestamp as number) : null;

  return {
    kind,
    bracket: str(startInfo.bracket) || '?',
    zone: str(startInfo.zoneId) || '?',
    isRanked: typeof startInfo.isRanked === 'boolean' ? (startInfo.isRanked as boolean) : null,
    startTimeMs: startMs,
    startTimeIso: startMs !== null ? new Date(startMs).toISOString() : null,
    endTimeMs: typeof m.endTime === 'number' ? (m.endTime as number) : null,
    durationSec: typeof m.durationInSeconds === 'number' ? (m.durationInSeconds as number) : null,
    result: m.result,
    winningTeamId: m.winningTeamId,
    eventCounts,
    combatants,
    rawStartInfo: m.startInfo ?? null,
    rawEndInfo: m.endInfo ?? null,
  };
}
```

- [ ] **Step 5: Run the projection test to verify it passes**

Run: `npx vitest run test/projectMatch.test.ts`
Expected: PASS (fixture present). If `combatants` is empty or `eventCounts` is empty, the parser's unit/event field names differ from the defensive guesses — add a one-off `console.log(Object.keys(Object.values(res.arenaMatches[0].units)[0]))` and `console.log(Object.keys(res.arenaMatches[0].events[0]))`, then adjust `str(u.<field>)` / `eventType` to the real field names and re-run. Report any field-name adjustment.

- [ ] **Step 6: Implement the CLI** — `src/cli/view.ts`

```ts
import { loadConfig } from '../config.js';
import { parseLogFile } from '../parser/parserClient.js';
import { firstLog } from '../util/logFiles.js';
import { loadSidecarIndex } from '../sidecar/sidecarIndex.js';
import { projectMatch } from '../view/projectMatch.js';
import { renderReport } from '../view/renderReport.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logPath = process.argv[2] ?? firstLog(cfg.sampleLogsDir);

  const res = await parseLogFile(logPath);
  const views = [
    ...res.arenaMatches.map((m) => projectMatch(m, 'arena')),
    ...res.shuffleRounds.map((r) => projectMatch(r, 'shuffleRound')),
  ];
  const index = loadSidecarIndex(cfg.videoDirs);

  const html = renderReport(views, index, {
    sourceLogPath: logPath,
    aborted: res.aborted,
    linesAfterError: res.linesAfterError,
  });

  mkdirSync(cfg.outputDir, { recursive: true });
  const outPath = join(cfg.outputDir, 'report.html');
  writeFileSync(outPath, html, 'utf8');

  console.log(
    `Wrote report: ${resolve(outPath)}  (${views.length} matches, ` +
      `sidecars ${index.loaded}/${index.skipped}, from ${logPath})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 7: Add the `view` script to `package.json`**

In the `"scripts"` block add: `"view": "tsx src/cli/view.ts"`.

- [ ] **Step 8: Full suite + typecheck**

Run: `npm test` — all green (smoke, config, parserClient incl. golden, sidecarIndex, renderReport, projectMatch; extraction skipped without env var).
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 9: Commit**

```bash
git add src/util/logFiles.ts src/cli/ingest.ts src/view/projectMatch.ts src/cli/view.ts test/projectMatch.test.ts package.json
git commit -m "feat: view CLI — render parsed matches + sidecar preview to report.html

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 10: Generate a real report (the deliverable)**

Run against a real staged log so the user has something to open:
```bash
npm run view -- "<a real WoWCombatLog .txt under the configured sampleLogsDir>"
```
(Find one via `config.json` `sampleLogsDir`; pick the largest/newest for the most matches.) Confirm it prints `Wrote report: <abs path>` and that `output/report.html` exists and is non-trivial in size. Report the absolute path and the printed match/sidecar counts. (`output/` is git-ignored — do NOT commit the report.)

---

## Self-Review

**1. Spec coverage:**
- §3 sidecarIndex (load/normalize, filename-or-field start, skip junk) → Task 1. ✓
- §3 renderReport pure + ParsedMatchView projection → Task 2 (renderer) + Task 3 (projectMatch). ✓
- §3 CLI glue + reuse firstLog → Task 3 (extracts firstLog to shared util, wires CLI). ✓
- §4 per-match content (boundaries, combatants, event histogram, video preview, raw dump) → renderReport (Task 2). ✓
- §4 header with delta summary + aborted banner → renderReport `RenderOpts` + header (Task 2). ✓
- §6 error handling (no sidecars, junk skipped, missing times, zero matches, aborted) → Task 1 (skip/empty), Task 2 (no-match/zero/abort), `projectMatch` null-safety. ✓
- §7 testing (renderReport unit incl. zero-match + escaping, sidecar fixture, projection via real fixture) → Tasks 1–3. ✓
- §9 reuse/altitude (firstLog extraction; naive match kept in view layer; SidecarEntry clean for Plan 2) → Task 3 + module placement. ✓
- Deliverable: real report generated → Task 3 Step 10. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases". The two field-name uncertainties (unit fields, event type) are handled by defensive access with a concrete discovery+adjust instruction (Task 3 Step 5), not a placeholder.

**3. Type consistency:** `SidecarIndex`/`SidecarEntry` defined in Task 1, imported by renderReport (Task 2) and view.ts (Task 3) — same shape. `ParsedMatchView`/`ViewCombatant` defined in `renderReport.ts` (Task 2), imported by `projectMatch.ts` (Task 3) — consistent. `firstLog(dir): string` signature identical in `logFiles.ts` and its `ingest.ts`/`view.ts` call sites. `renderReport(matches, idx, opts?)` signature matches its test and the view.ts call.
