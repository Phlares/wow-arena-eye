# Debug Readout — Design

**Date:** 2026-05-30
**Status:** Approved design, pre-implementation
**Depends on:** Plan 1 (ingest foundation) — uses `parseLogFile`, `loadConfig`.

---

## 1. What this is

A developer debug tool: one command turns a combat log into a **self-contained
`output/report.html`** the user opens in a browser to eyeball what the pipeline
detected — arena boundaries, combatants, event coverage — and a *preview* of how
each parsed match lines up with the user's Warcraft Recorder video sidecars by
timestamp. It replaces cumbersome CLI inspection of many values/variables.

It is a debugging aid, NOT a product surface. Generic fields, native HTML
expand/collapse, browser Ctrl+F for search. No styling effort, no framework, no
server.

## 2. Non-goals

- No styling/polish, no client framework, no live server/interactivity.
- No robust video matching (that is Plan 2's `SidecarMatcher`). This shows a
  deliberately **naive nearest-by-timestamp preview**, clearly labeled.
- No metrics (Plan 4). Shows raw parsed data + event-type counts only.

## 3. Components

Three small, focused units:

- **`src/sidecar/sidecarIndex.ts`** — `loadSidecarIndex(videoDirs: string[]): SidecarIndex`.
  Recursively finds `*.json` sidecars under the configured `videoDirs`, parses
  each into a normalized `SidecarEntry`:
  ```ts
  interface SidecarEntry {
    videoPath: string;        // sibling .mp4 if present, else the .json path
    jsonPath: string;
    startEpochMs: number | null;
    category: string | null;  // sidecar "category" (e.g. "3v3", "Solo Shuffle", "Skirmish")
    zoneName: string | null;
    result: boolean | null;   // sidecar win/loss
    combatants: { name: string; specId: number; teamId: number }[];
    durationSec: number | null;
  }
  interface SidecarIndex { entries: SidecarEntry[]; loaded: number; skipped: number; }
  ```
  `startEpochMs` derivation: prefer a numeric epoch field on the sidecar if
  present; otherwise parse the recording start from the filename pattern
  `YYYY-MM-DD HH-MM-SS` (interpreted as local time). If neither yields a time,
  `startEpochMs = null` (entry still listed, just not matchable). Unreadable/
  non-sidecar JSON files are skipped and counted, never fatal. This module is a
  stepping-stone toward Plan 2's real matcher.

- **`src/view/renderReport.ts`** — a **pure function**
  `renderReport(matches: ParsedMatchView[], index: SidecarIndex): string` that
  returns a complete HTML document string. Purity = testable without a browser.
  `ParsedMatchView` is a small projection of the parser's match object holding
  exactly the fields the report needs (see §4), so the renderer does not depend
  on the parser's full type surface.

- **`src/cli/view.ts`** — thin glue: `loadConfig()` → `parseLogFile(logPath)` →
  project matches to `ParsedMatchView[]` → `loadSidecarIndex(cfg.videoDirs)` →
  `renderReport(...)` → write `output/report.html` → print the absolute path.
  Log path comes from `process.argv[2]`, else the most-recent log in
  `sampleLogsDir` (reuse the existing `firstLog` helper pattern from `ingest.ts`;
  extract it to a shared spot if that avoids duplication).

## 4. What the report shows (per match)

Each match is a native `<details>` block (collapsed by default; summary line =
bracket · zone · result · duration). Inside:

- **Boundaries:** `startTime`, `endTime`, `durationInSeconds`, the epoch
  `startInfo.timestamp`, `bracket`, `zoneId`, `isRanked`.
- **Combatants:** a table of name / specId / teamId from `units`.
- **Event histogram:** counts per `LogEvent` type present in `events`
  (so interrupts, dispels, casts, deaths, etc. are visible at a glance).
- **Video-match preview:** the nearest `SidecarEntry` by `|match.startInfo.timestamp − entry.startEpochMs|`,
  showing the **delta in seconds**, the `videoPath`, and whether category/zone
  agree. Explicitly headed "naive nearest-match preview (Plan 2 will do this
  properly)". If no entry within a window (default ±15 min) → "no video match".
- **Raw dump:** a nested collapsed `<details>` with pretty-printed
  `startInfo`/`endInfo` JSON.

Top of report: a header with the source log path, match count, sidecars
loaded/skipped, and — because it is the key debugging signal — a **summary of the
match→video deltas** (min/median/max) so a constant offset (timezone bug) is
obvious at a glance.

## 5. Data flow

```
config.json ─▶ loadConfig
log .txt ────▶ parseLogFile ─▶ ParsedMatchView[] ┐
videoDirs ───▶ loadSidecarIndex ─▶ SidecarIndex ─┼─▶ renderReport ─▶ output/report.html
```

## 6. Error handling

- No `videoDirs` configured or none found → report renders with a "no sidecars
  loaded" banner; all matches show "no video match".
- Unreadable/!sidecar JSON → skipped, counted in `index.skipped`, surfaced in the
  header.
- `startInfo.timestamp` or `startEpochMs` missing → that pairing shows "time
  unavailable" rather than a bogus delta.
- Empty log / zero matches → report renders with "0 matches parsed" (still valid
  HTML). Aborted-parse signal (`aborted`/`linesAfterError` from `parseLogFile`)
  is surfaced in the header banner.

## 7. Testing

- **`renderReport`** (pure) — unit tests: feed a synthetic `ParsedMatchView` + a
  synthetic `SidecarIndex` and assert the HTML string contains the boundary
  values, a combatant row, the computed delta, and the "no video match" text when
  out of window. Also a zero-matches case.
- **`sidecarIndex`** — parse a tiny committed sidecar JSON fixture (anonymized,
  generic) from a temp dir; assert normalization (startEpochMs from field and the
  filename-fallback path; skipped count for a junk file).
- CLI is thin; covered by a smoke run in the plan's final step (generate a real
  report).

## 8. File structure

```
src/
  sidecar/sidecarIndex.ts     # loadSidecarIndex + SidecarEntry/SidecarIndex
  view/renderReport.ts        # renderReport (pure) + ParsedMatchView
  cli/view.ts                 # `npm run view` glue
test/
  sidecarIndex.test.ts
  renderReport.test.ts
package.json                  # add "view": "tsx src/cli/view.ts"
```

## 9. Reuse / altitude notes

- Reuse `parseLogFile`, `loadConfig`, and the `firstLog` log-selection logic
  (extract `firstLog` from `ingest.ts` into a shared module if it avoids
  copy-paste — both `ingest.ts` and `view.ts` need it).
- `sidecarIndex` is intentionally a thin precursor to Plan 2's `SidecarMatcher`;
  keep its normalized `SidecarEntry` shape clean so Plan 2 can build on it.
- The naive match is a *preview*, not infrastructure — keep it inside the view
  layer, not promoted into a shared matcher, so Plan 2 owns the real one.
