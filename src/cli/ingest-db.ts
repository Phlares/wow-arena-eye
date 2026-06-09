import { basename } from 'node:path';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from '../store/sqlite.js';
import { parseLogFile } from '../parser/parserClient.js';
import { computeMatchMetrics } from '../metrics/metrics.js';
import { resolvePlayerUnitId, type PlayerRef } from '../store/resolvePlayer.js';
import { upsertMatch, openDb, loadIngestedFileSizes, recordIngestedFile } from '../store/store.js';
import { loadConfig } from '../config.js';
import { allLogs } from '../util/logFiles.js';
import { seasonOf, lastNSeasons } from '../util/seasons.js';
import { loadSidecarIndex, nearestSidecar, SIDECAR_MATCH_WINDOW_MS, type SidecarIndex, type SidecarEntry } from '../sidecar/sidecarIndex.js';
import { readBuildVersion } from '../util/buildVersion.js';

export interface IngestSummary { files: number; ingested: number; skipped: number; noPlayer: number; noSidecar: number; }

/** Ingest each log file's arena matches into `db`. Pure of process/argv — testable. */
export async function ingestLogsIntoDb(
  db: DatabaseSync, files: string[], registry: PlayerRef[], sidecar: SidecarIndex | undefined,
): Promise<IngestSummary> {
  const summary: IngestSummary = { files: files.length, ingested: 0, skipped: 0, noPlayer: 0, noSidecar: 0 };
  for (const f of files) {
    let res;
    let sizeAtParse: number;
    // Size is taken BEFORE parsing: a live log can grow mid-parse, and ledgering the post-parse
    // size would mark the unseen tail as ingested (the next run would skip it as "unchanged").
    try { sizeAtParse = statSync(f).size; res = await parseLogFile(f); } catch (e) { console.error('skip file', f, String(e)); continue; }
    const skippedBefore = summary.skipped;
    // Best-effort: a header-read failure costs only the build version, never the whole file.
    let buildVersion: string | undefined;
    try { buildVersion = readBuildVersion(f) ?? undefined; } catch (e) { console.error('build version unreadable', f, String(e)); }
    for (const m of res.arenaMatches) {
      try {
        const metrics = computeMatchMetrics(m);
        const playerUnitId = resolvePlayerUnitId(m, registry);
        if (!playerUnitId) summary.noPlayer += 1;
        const startMs = (m as { startInfo?: { timestamp?: number } }).startInfo?.timestamp ?? null;
        let sc: SidecarEntry | undefined;
        if (sidecar) {
          const near = nearestSidecar(sidecar, startMs);
          if (near && near.deltaMs <= SIDECAR_MATCH_WINDOW_MS) sc = near.entry;
          if (!sc) summary.noSidecar += 1;
        }
        upsertMatch(db, m, metrics, {
          playerUnitId, sourceFile: basename(f), buildVersion,
          videoPath: sc?.videoPath, sidecarPath: sc?.jsonPath,
        });
        summary.ingested += 1;
      } catch (e) { console.error('skip match in', f, String(e)); summary.skipped += 1; }
    }
    // Ledger only fully-stored files: a match-level failure leaves the file unledgered so the
    // next run retries it (a permanently-bad match keeps one file re-parsing, with the error
    // printed each run — preferable to silently never retrying).
    if (summary.skipped === skippedBefore) {
      try { recordIngestedFile(db, f, sizeAtParse); } catch (e) { console.error('ledger failed for', f, String(e)); }
    }
  }
  return summary;
}

export interface IngestArgs { dirs: string[]; seasonsBack: number | undefined; allSeasons: boolean; force: boolean; }

/** Split ingest argv into directories and flags (--seasons-back=N, --all-seasons, --force). */
export function parseIngestArgs(argv: string[]): IngestArgs {
  const out: IngestArgs = { dirs: [], seasonsBack: undefined, allSeasons: false, force: false };
  for (const a of argv) {
    if (a === '--all-seasons') out.allSeasons = true;
    else if (a === '--force') out.force = true;
    else if (a.startsWith('--seasons-back=')) {
      const n = Number(a.slice('--seasons-back='.length));
      if (!Number.isInteger(n) || n < 1) throw new Error(`--seasons-back must be a positive integer, got "${a}"`);
      out.seasonsBack = n;
    } else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else out.dirs.push(a);
  }
  return out;
}

export interface IngestSelection { files: string[]; skippedSeason: number; skippedUnchanged: number; seasons: string[]; }

/** Pick which log files a run actually parses: keep the newest `seasonsBack` seasons present in
 *  the corpus (season = client major.minor from the log header; headerless files are kept — we
 *  can't date them, so stay honest), then drop files already ledgered at their current size
 *  unless `force`. */
export function selectIngestFiles(
  files: string[],
  opts: {
    seasonsBack: number;
    force?: boolean;
    versionOf: (f: string) => string | null;
    sizeOf: (f: string) => number;
    ingestedSizes: Map<string, number>;
  },
): IngestSelection {
  const seasonByFile = new Map(files.map((f) => [f, seasonOf(opts.versionOf(f))]));
  const wanted = lastNSeasons(seasonByFile.values(), opts.seasonsBack);
  const inSeason = files.filter((f) => { const s = seasonByFile.get(f) ?? null; return s === null || wanted.has(s); });
  const fresh = opts.force
    ? inSeason
    : inSeason.filter((f) => opts.ingestedSizes.get(f) !== opts.sizeOf(f));
  // newest-first ordering of the kept seasons, for the log line
  const seasons = [...wanted];
  return { files: fresh, skippedSeason: files.length - inSeason.length, skippedUnchanged: inSeason.length - fresh.length, seasons };
}

/** Directories to ingest: explicit CLI args when given, else the configured live logs
 *  (falling back to the sample corpus) — so a bare `npm run ingest-db` re-ingests real games. */
export function resolveIngestDirs(argv: string[], cfg: { liveLogsDir?: string; sampleLogsDir: string }): string[] {
  return argv.length ? argv : [cfg.liveLogsDir || cfg.sampleLogsDir]; // || so an empty liveLogsDir falls back
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const args = parseIngestArgs(process.argv.slice(2));
  const dirs = resolveIngestDirs(args.dirs, cfg);
  if (!args.dirs.length) console.log('ingest-db: no dirs given, defaulting to', dirs[0]);
  const files = dirs.flatMap((d) => allLogs(d));
  const db = openDb(cfg.dbPath ?? './wow-arena-eye.local.db');
  const seasonsBack = args.allSeasons ? Infinity : args.seasonsBack ?? cfg.ingestSeasonsBack;
  const sel = selectIngestFiles(files, {
    seasonsBack,
    force: args.force,
    versionOf: (f) => { try { return readBuildVersion(f); } catch { return null; } },
    sizeOf: (f) => statSync(f).size,
    ingestedSizes: loadIngestedFileSizes(db),
  });
  console.log(`ingest-db: ${sel.files.length}/${files.length} files — seasons [${sel.seasons.join(', ')}], skipped ${sel.skippedSeason} older-season + ${sel.skippedUnchanged} unchanged (use --seasons-back=N / --all-seasons / --force to widen)`);
  const sidecar = cfg.videoDirs?.length ? loadSidecarIndex(cfg.videoDirs) : undefined;
  const summary = await ingestLogsIntoDb(db, sel.files, cfg.players, sidecar);
  console.log('ingest-db:', JSON.stringify(summary));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
