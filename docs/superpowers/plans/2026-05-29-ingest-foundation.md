# Ingest Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the wow-arena-eye TypeScript project and prove the vendored wowarenalogs parser correctly parses the user's current 12.0.5 arena logs into structured match objects, with golden tests on verified facts.

**Architecture:** Single-language (TypeScript/Node, ESM, Node ≥22). The wowarenalogs parser is added as an **unmodified git submodule** under `vendor/`, built with its own toolchain, and consumed via a `file:` dependency. A thin `parserClient` wrapper streams a log file's lines through the parser and collects emitted match objects. All paths and player identity come from a git-ignored local config — nothing private is committed.

**Tech Stack:** TypeScript, Node ≥22 (ESM), tsx (run TS), Vitest (tests), `@wowarenalogs/parser` (vendored submodule).

**Scope:** This is Plan 1 of the v1 sequence. It delivers ingest-to-structured-JSON only. SidecarMatcher + live LogWatcher (Plan 2), Storage/Normalizer (Plan 3), Metric battery (Plan 4), and Scorecard (Plan 5) follow, once this plan reveals the parser's exact output shape.

---

## File Structure

```
wow-arena-eye/
  package.json                 # ESM, scripts, deps
  tsconfig.json                # NodeNext, strict
  vitest.config.ts             # test config
  .gitignore                   # excludes data, output, real config, node_modules, vendor build
  config.example.json          # GENERIC template (committed)
  config.json                  # REAL local config (git-ignored, created by hand)
  README.md                    # one-paragraph stub
  vendor/
    wowarenalogs/              # git submodule (unmodified)
  src/
    config.ts                  # typed Config + loadConfig()
    parser/
      parserClient.ts          # parseLogFile(path) -> IngestResult
    cli/
      ingest.ts                # CLI: log -> match summaries in outputDir
    util/
      extractMatchFixture.ts   # dev util: slice one arena match into a small fixture
  test/
    config.test.ts
    parserClient.test.ts
    smoke.test.ts
  test-data/                   # git-ignored: local logs/fixtures
    fixtures/
      arena-sample.log         # produced by extract util (local only)
  output/                      # git-ignored: ingest output
```

**Responsibilities:** `config.ts` owns all path/identity resolution (no hardcoded paths anywhere else). `parser/parserClient.ts` owns the only contact with the vendored parser. `cli/ingest.ts` is a thin orchestrator. `util/extractMatchFixture.ts` is a dev-only helper to produce small test fixtures from large logs.

---

## Task 0: Prerequisites (manual, no commit)

**Files:** none

- [ ] **Step 1: Verify toolchain**

Run:
```bash
node --version    # must be >= v22.0.0
git --version
```
Expected: Node prints `v22.x` or higher; git prints a version. If Node < 22, install Node 22 LTS before continuing (the parser requires `"engines": { "node": ">=22" }`).

---

## Task 1: Project skeleton + toolchain smoke test

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `README.md`, `test/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "wow-arena-eye",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "ingest": "tsx src/cli/ingest.ts",
    "extract-fixture": "tsx src/util/extractMatchFixture.ts"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
dist/
output/
test-data/
config.json
*.local.json
*.local.db
*.db
coverage/
.env
# vendor submodule build artifacts (the submodule itself is tracked via .gitmodules)
vendor/wowarenalogs/node_modules/
vendor/**/dist/
```

- [ ] **Step 5: Create `README.md`**

```markdown
# wow-arena-eye

Personal WoW arena analysis tool. Ingests your own combat logs (via the wowarenalogs
parser) and Warcraft Recorder videos, derives objective per-match metrics, and produces a
comparative scorecard against your own history.

All data paths and player identity are supplied via a local `config.json` (git-ignored).
Copy `config.example.json` to `config.json` and fill in your paths.

See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for plans.
```

- [ ] **Step 6: Write the smoke test** — `test/smoke.test.ts`

```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs TypeScript tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Install and run the smoke test**

Run:
```bash
cd "C:/Users/Ryon/Documents/dev/wow-arena-eye"
npm install
npm test
```
Expected: install succeeds; Vitest reports `1 passed` for `test/smoke.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore README.md test/smoke.test.ts package-lock.json
git commit -m "$(cat <<'EOF'
chore: scaffold TypeScript/ESM project with Vitest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Config module (typed, validated, all paths assignable)

**Files:**
- Create: `src/config.ts`, `config.example.json`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write the failing test** — `test/config.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';

function writeTempConfig(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'wae-cfg-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(obj), 'utf8');
  return path;
}

describe('loadConfig', () => {
  it('loads a valid config and defaults videoDirs to []', () => {
    const path = writeTempConfig({
      sampleLogsDir: '/logs',
      outputDir: './output',
      player: { name: 'Tester', realm: 'TestRealm' },
    });
    const cfg = loadConfig(path);
    expect(cfg.sampleLogsDir).toBe('/logs');
    expect(cfg.outputDir).toBe('./output');
    expect(cfg.player.name).toBe('Tester');
    expect(cfg.videoDirs).toEqual([]);
    rmSync(path, { force: true });
  });

  it('throws a clear error when a required field is missing', () => {
    const path = writeTempConfig({ outputDir: './output', player: { name: 'X', realm: 'Y' } });
    expect(() => loadConfig(path)).toThrow(/sampleLogsDir/);
    rmSync(path, { force: true });
  });

  it('throws when player identity is incomplete', () => {
    const path = writeTempConfig({ sampleLogsDir: '/logs', outputDir: './o', player: { name: 'X' } });
    expect(() => loadConfig(path)).toThrow(/player\.realm/);
    rmSync(path, { force: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — cannot resolve `../src/config.js` (module not found).

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { readFileSync } from 'node:fs';

export interface PlayerIdentity {
  name: string;
  realm: string;
  guid?: string;
}

export interface Config {
  sampleLogsDir: string;
  liveLogsDir?: string;
  videoDirs: string[];
  outputDir: string;
  dbPath?: string;
  player: PlayerIdentity;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Config error: required field "${key}" must be a non-empty string`);
  }
  return v;
}

export function loadConfig(path?: string): Config {
  const resolved = path ?? process.env.WAE_CONFIG ?? 'config.json';
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(resolved, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Config error: could not read/parse "${resolved}": ${(e as Error).message}`);
  }

  const sampleLogsDir = requireString(raw, 'sampleLogsDir');
  const outputDir = requireString(raw, 'outputDir');

  const playerRaw = raw.player as Record<string, unknown> | undefined;
  if (!playerRaw || typeof playerRaw !== 'object') {
    throw new Error('Config error: required field "player" must be an object');
  }
  const player: PlayerIdentity = {
    name: requireString(playerRaw, 'name'),
    realm: requireString(playerRaw, 'realm'),
    guid: typeof playerRaw.guid === 'string' ? playerRaw.guid : undefined,
  };

  const videoDirs = Array.isArray(raw.videoDirs) ? (raw.videoDirs as string[]) : [];

  return {
    sampleLogsDir,
    outputDir,
    liveLogsDir: typeof raw.liveLogsDir === 'string' ? raw.liveLogsDir : undefined,
    dbPath: typeof raw.dbPath === 'string' ? raw.dbPath : undefined,
    videoDirs,
    player,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Create the GENERIC committed template** — `config.example.json`

```json
{
  "sampleLogsDir": "/path/to/sample/combat/logs",
  "liveLogsDir": "/path/to/World of Warcraft/_retail_/Logs",
  "videoDirs": ["/path/to/current/videos", "/path/to/archived/videos"],
  "outputDir": "./output",
  "dbPath": "./wow-arena-eye.local.db",
  "player": { "name": "YourName", "realm": "YourRealm", "guid": "Player-XX-XXXXXXXX" }
}
```

- [ ] **Step 6: Create the REAL local config (NOT committed — it is git-ignored)** — `config.json`

```json
{
  "sampleLogsDir": "<sampleLogsDir>",
  "liveLogsDir": "C:/Program Files (x86)/World of Warcraft/_retail_/Logs",
  "videoDirs": ["<current videos dir>", "<archived videos dir>"],
  "outputDir": "./output",
  "dbPath": "./wow-arena-eye.local.db",
  "player": { "name": "YourName", "realm": "YourRealm", "guid": "Player-XX-XXXXXXXX" }
}
```

Verify it is ignored:
```bash
git check-ignore config.json
```
Expected: prints `config.json` (meaning it IS ignored). If it prints nothing, STOP — do not commit; fix `.gitignore`.

- [ ] **Step 7: Commit (template + module only; never the real config)**

```bash
git add src/config.ts test/config.test.ts config.example.json
git commit -m "$(cat <<'EOF'
feat: config module with assignable paths and validation

All paths and player identity load from a git-ignored local config.
Generic template committed as config.example.json.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Vendor the wowarenalogs parser (submodule + build) and import it

**Files:**
- Create: `.gitmodules` (via `git submodule add`)
- Modify: `package.json` (add the `file:` dependency)
- Create: `test/parserClient.test.ts` (import-only smoke for now)

- [ ] **Step 1: Add the parser as an unmodified submodule**

Run:
```bash
cd "C:/Users/Ryon/Documents/dev/wow-arena-eye"
git submodule add https://github.com/wowarenalogs/wowarenalogs.git vendor/wowarenalogs
```
Expected: clones into `vendor/wowarenalogs`, creates `.gitmodules`.

- [ ] **Step 2: Build just the parser package**

Run:
```bash
cd "C:/Users/Ryon/Documents/dev/wow-arena-eye/vendor/wowarenalogs/packages/parser"
npm install --workspaces=false
npm run build
```
Expected: produces `vendor/wowarenalogs/packages/parser/dist/` containing `index.js`, `parser.esm.js`, `index.d.ts`.

**Fallback if `--workspaces=false` install fails** (monorepo hoisting): build from the repo root instead —
```bash
cd "C:/Users/Ryon/Documents/dev/wow-arena-eye/vendor/wowarenalogs"
npm install
npm run build --workspace=packages/parser
```
Confirm `vendor/wowarenalogs/packages/parser/dist/parser.esm.js` exists either way:
```bash
ls "C:/Users/Ryon/Documents/dev/wow-arena-eye/vendor/wowarenalogs/packages/parser/dist"
```

- [ ] **Step 3: Add the local dependency to the project's `package.json`**

Add this entry to `package.json` (create a `"dependencies"` block if absent):
```json
  "dependencies": {
    "@wowarenalogs/parser": "file:./vendor/wowarenalogs/packages/parser"
  }
```
Then install:
```bash
cd "C:/Users/Ryon/Documents/dev/wow-arena-eye"
npm install
```
Expected: `node_modules/@wowarenalogs/parser` is linked to the vendored build.

- [ ] **Step 4: Write the import smoke test** — `test/parserClient.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { WoWCombatLogParser } from '@wowarenalogs/parser';

describe('@wowarenalogs/parser import', () => {
  it('constructs a parser and accepts the version header line without throwing', () => {
    const parser = new WoWCombatLogParser(null);
    expect(parser).toBeTruthy();
    expect(() =>
      parser.parseLine(
        '5/28/2026 20:08:25.416-4  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.0.5,PROJECT_ID,1',
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Step 5: Run the smoke test**

Run: `npx vitest run test/parserClient.test.ts`
Expected: PASS. If import fails, re-check Step 2's `dist/` exists and Step 3's install linked the package.

- [ ] **Step 6: Commit**

```bash
git add .gitmodules vendor/wowarenalogs package.json package-lock.json test/parserClient.test.ts
git commit -m "$(cat <<'EOF'
feat: vendor wowarenalogs parser as submodule and import it

Unmodified git submodule under vendor/, built with its own tsdx
toolchain, consumed via a file: dependency.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Fixture extraction utility (slice one arena match from a large log)

**Files:**
- Create: `src/util/extractMatchFixture.ts`
- Test: add a test to `test/parserClient.test.ts`

- [ ] **Step 1: Implement `src/util/extractMatchFixture.ts`**

```ts
import { createInterface } from 'node:readline';
import { createReadStream, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Extract the first complete arena match (header line + ARENA_MATCH_START..ARENA_MATCH_END)
 * from a large combat log into a small fixture file. Dev/test helper only.
 */
export async function extractFirstArenaMatch(srcPath: string, destPath: string): Promise<void> {
  const rl = createInterface({ input: createReadStream(srcPath), crlfDelay: Infinity });
  const captured: string[] = [];
  let header: string | null = null;
  let capturing = false;
  let done = false;

  for await (const line of rl) {
    if (done) break;
    if (header === null && line.includes('COMBAT_LOG_VERSION')) {
      header = line;
      continue;
    }
    if (!capturing && line.includes('ARENA_MATCH_START')) capturing = true;
    if (capturing) {
      captured.push(line);
      if (line.includes('ARENA_MATCH_END')) done = true;
    }
  }
  rl.close();

  if (!header || captured.length === 0 || !done) {
    throw new Error(`No complete arena match found in ${srcPath}`);
  }
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, [header, ...captured].join('\n') + '\n', 'utf8');
}

// CLI entry: node/tsx src/util/extractMatchFixture.ts <srcLog> <destFixture>
if (process.argv[1] && process.argv[1].endsWith('extractMatchFixture.ts')) {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) {
    console.error('Usage: npm run extract-fixture -- <srcLog> <destFixture>');
    process.exit(1);
  }
  extractFirstArenaMatch(src, dest)
    .then(() => console.log(`Wrote fixture: ${dest}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
```

- [ ] **Step 2: Produce the local fixture from the staged sample log**

Run (uses the real staged corpus on D:; output is git-ignored `test-data/`):
```bash
cd "C:/Users/Ryon/Documents/dev/wow-arena-eye"
npm run extract-fixture -- "<sampleLogsDir>/WoWCombatLog-<session>.txt" "test-data/fixtures/arena-sample.log"
```
Expected: prints `Wrote fixture: test-data/fixtures/arena-sample.log`. Verify it is small and well-formed:
```bash
wc -l "test-data/fixtures/arena-sample.log"
grep -c ARENA_MATCH_START "test-data/fixtures/arena-sample.log"   # expect 1
grep -c ARENA_MATCH_END   "test-data/fixtures/arena-sample.log"   # expect 1
head -1 "test-data/fixtures/arena-sample.log"                      # expect COMBAT_LOG_VERSION header
```

- [ ] **Step 3: Add an extraction test** — append to `test/parserClient.test.ts`

```ts
import { existsSync, rmSync } from 'node:fs';
import { extractFirstArenaMatch } from '../src/util/extractMatchFixture.js';

describe('extractFirstArenaMatch', () => {
  const SRC = process.env.WAE_SAMPLE_LOG;
  it.runIf(SRC && existsSync(SRC))('extracts a single complete arena match', async () => {
    const dest = 'test-data/fixtures/extract-test.log';
    await extractFirstArenaMatch(SRC as string, dest);
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(dest, 'utf8');
    expect(text.split('\n')[0]).toContain('COMBAT_LOG_VERSION');
    expect((text.match(/ARENA_MATCH_START/g) ?? []).length).toBe(1);
    expect((text.match(/ARENA_MATCH_END/g) ?? []).length).toBe(1);
    rmSync(dest, { force: true });
  });
});
```

- [ ] **Step 4: Run the test**

Run:
```bash
WAE_SAMPLE_LOG="<sampleLogsDir>/WoWCombatLog-<session>.txt" npx vitest run test/parserClient.test.ts
```
Expected: PASS (extraction test runs because the env var points at an existing file).

- [ ] **Step 5: Commit (code only — `test-data/` is git-ignored)**

```bash
git add src/util/extractMatchFixture.ts test/parserClient.test.ts package.json
git commit -m "$(cat <<'EOF'
feat: dev utility to extract a single arena match fixture from a log

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `parseLogFile` + ingest CLI + golden test on real 12.0.5 data

**Files:**
- Create: `src/parser/parserClient.ts`, `src/cli/ingest.ts`
- Test: add a golden test block to `test/parserClient.test.ts`

- [ ] **Step 1: Implement `src/parser/parserClient.ts`**

```ts
import { WoWCombatLogParser } from '@wowarenalogs/parser';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

// Parser object shapes are intentionally loose here; Plan 2 narrows them once
// the exact output shape is confirmed from this plan's golden artifact.
export interface IngestResult {
  arenaMatches: any[];
  shuffleRounds: any[];
  shuffleMatches: any[];
  malformed: number;
  errors: number;
}

export async function parseLogFile(path: string): Promise<IngestResult> {
  const parser = new WoWCombatLogParser(null);
  const out: IngestResult = {
    arenaMatches: [],
    shuffleRounds: [],
    shuffleMatches: [],
    malformed: 0,
    errors: 0,
  };

  parser.on('arena_match_ended', (m: any) => out.arenaMatches.push(m));
  parser.on('solo_shuffle_round_ended', (r: any) => out.shuffleRounds.push(r));
  parser.on('solo_shuffle_ended', (m: any) => out.shuffleMatches.push(m));
  parser.on('malformed_arena_match_detected', () => {
    out.malformed += 1;
  });
  parser.on('parser_error', () => {
    out.errors += 1;
  });

  await new Promise<void>((resolve, reject) => {
    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    rl.on('line', (line) => {
      try {
        parser.parseLine(line);
      } catch {
        out.errors += 1;
      }
    });
    rl.on('close', () => {
      try {
        (parser as any).flush?.();
      } catch {
        /* flush is best-effort */
      }
      resolve();
    });
    rl.on('error', reject);
  });

  return out;
}

/** Robust summary that reveals the parser's output shape without circular-ref JSON crashes. */
export function summarizeMatch(m: any): Record<string, unknown> {
  return {
    topLevelKeys: Object.keys(m ?? {}),
    unitCount: m?.units ? Object.keys(m.units).length : 0,
    eventCount: Array.isArray(m?.events) ? m.events.length : 0,
    result: m?.result,
    winningTeamId: m?.winningTeamId,
    durationInSeconds: m?.durationInSeconds,
    startInfo: m?.startInfo,
  };
}
```

- [ ] **Step 2: Implement the ingest CLI** — `src/cli/ingest.ts`

```ts
import { loadConfig } from '../config.js';
import { parseLogFile, summarizeMatch } from '../parser/parserClient.js';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function firstLog(dir: string): string {
  const f = readdirSync(dir)
    .filter((n) => n.startsWith('WoWCombatLog'))
    .sort()[0];
  if (!f) throw new Error(`No WoWCombatLog files in ${dir}`);
  return join(dir, f);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logPath = process.argv[2] ?? firstLog(cfg.sampleLogsDir);
  const res = await parseLogFile(logPath);

  mkdirSync(cfg.outputDir, { recursive: true });
  res.arenaMatches.forEach((m, i) =>
    writeFileSync(join(cfg.outputDir, `arena-${i}.json`), JSON.stringify(summarizeMatch(m), null, 2)),
  );

  console.log(
    `Parsed ${res.arenaMatches.length} arena matches, ${res.shuffleRounds.length} shuffle rounds ` +
      `(malformed=${res.malformed}, errors=${res.errors}) from ${logPath}`,
  );
  console.log(`Wrote ${res.arenaMatches.length} summaries to ${cfg.outputDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Write the golden test** — append to `test/parserClient.test.ts`

```ts
import { parseLogFile } from '../src/parser/parserClient.js';

describe('parseLogFile golden (real 12.0.5 arena fixture)', () => {
  const FIXTURE = 'test-data/fixtures/arena-sample.log';
  it.runIf(existsSync(FIXTURE))('parses one structurally-valid arena match', async () => {
    const res = await parseLogFile(FIXTURE);
    expect(res.arenaMatches.length).toBeGreaterThanOrEqual(1);

    const m = res.arenaMatches[0];
    expect(typeof m.units).toBe('object');
    expect(Object.keys(m.units).length).toBeGreaterThanOrEqual(6); // 3v3 = 6 players (+ pets/totems)
    expect(Array.isArray(m.events)).toBe(true);
    expect(m.events.length).toBeGreaterThan(0);
    expect(m.durationInSeconds).toBeGreaterThan(0);
    expect(m.winningTeamId).toBeDefined();
    expect(m.result).toBeDefined();
  });
});
```

- [ ] **Step 4: Verify the golden test fails without the fixture, passes with it**

First confirm the fixture exists (created in Task 4 Step 2). Then run:
```bash
npx vitest run test/parserClient.test.ts
```
Expected: PASS — the golden test runs (fixture exists) and all assertions pass. If the fixture is missing, the test is skipped (`it.runIf`); re-run Task 4 Step 2.

- [ ] **Step 5: Run the ingest CLI end-to-end and inspect the real output shape**

Run:
```bash
cd "C:/Users/Ryon/Documents/dev/wow-arena-eye"
npm run ingest -- "test-data/fixtures/arena-sample.log"
```
Expected: prints `Parsed 1 arena matches ...` and writes `output/arena-0.json`. Open `output/arena-0.json` and read `topLevelKeys`, `startInfo`, `result`, `winningTeamId` — **this artifact is the exact parser output shape that Plan 2 builds on.** Record anything surprising (e.g., whether `winningTeamId` is a number or string, how `startInfo` encodes the `3v3` bracket, how `units` keys map to players/specs) in a short note appended to the design spec or a `NOTES.md`.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass (smoke, config ×3, parser import, extraction [if `WAE_SAMPLE_LOG` set], golden).

- [ ] **Step 7: Commit**

```bash
git add src/parser/parserClient.ts src/cli/ingest.ts test/parserClient.test.ts
git commit -m "$(cat <<'EOF'
feat: parseLogFile + ingest CLI with golden test on real 12.0.5 data

Streams a combat log through the vendored parser, collects arena/shuffle
matches, writes shape-revealing summaries. Golden test asserts a
structurally valid 3v3 match parses from a real current-season fixture.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage (Plan 1's slice of the v1 spec):**
- Spec §2 principle 1 (public/private separation): config module + `.gitignore` + generic `config.example.json`; real `config.json` git-ignored and verified via `git check-ignore` (Task 2). ✓
- Spec §2 principle 2 (read-only): ingest only reads log files; no writes to any game directory. ✓
- Spec §2 principle 5 (store is contract / single-language v1): all TypeScript; no Python introduced. ✓
- Spec §4 ParserAdapter (vendored, unmodified): Task 3 submodule + `file:` dep, parser code never copied into repo. ✓
- Spec §5 data sources: config points at the real staged corpus; fixture drawn from it. ✓
- Spec §9 dev on staged copies: golden test + ingest run against `<sample data dir>` and `test-data/`. ✓
- Spec §11 testing (small fixtures, no bulky data committed): fixture lives in git-ignored `test-data/`; only code committed. ✓
- **Deferred (correctly out of Plan 1):** LogWatcher live tail (Plan 2), SidecarMatcher (Plan 2), SQLite schema/Normalizer (Plan 3), metric battery (Plan 4), scorecard (Plan 5). Tightening parser types from `any` and committing an anonymized reproducible fixture are explicit Plan 2 follow-ups noted in Task 5 Step 5 and Task 4.

**2. Placeholder scan:** No `TBD`/`TODO`/"add error handling"/"similar to". Every code step shows complete code; the one integration uncertainty (parser build under npm workspaces) is handled with a concrete fallback command set, not a placeholder. ✓

**3. Type consistency:** `Config`/`PlayerIdentity` fields used identically in `config.ts`, tests, and `ingest.ts`. `IngestResult`/`parseLogFile`/`summarizeMatch` signatures match between `parserClient.ts` and `ingest.ts`/tests. `extractFirstArenaMatch(src, dest)` signature matches its test and CLI usage. ✓

---

## Known follow-ups for Plan 2 (recorded, not done here)
- Replace `any` parser types with the parser's exported interfaces (`IArenaMatch`, `ICombatUnit`, …) using the shape confirmed in Task 5 Step 5.
- Produce a small **anonymized** committable fixture (stable GUID/name remap preserving `Player-XX-YYYYYYYY` format) so golden tests are reproducible in CI without local data.
- Add the `LogWatcher` (mirror Warcraft Recorder `CombatLogWatcher.ts`) and `SidecarMatcher`.
