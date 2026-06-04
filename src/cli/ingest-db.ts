import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from '../store/sqlite.js';
import { parseLogFile } from '../parser/parserClient.js';
import { computeMatchMetrics } from '../metrics/metrics.js';
import { resolvePlayerUnitId, type PlayerRef } from '../store/resolvePlayer.js';
import { upsertMatch, openDb } from '../store/store.js';
import { loadConfig } from '../config.js';
import { loadSidecarIndex, type SidecarIndex, type SidecarEntry } from '../sidecar/sidecarIndex.js';

export interface IngestSummary { files: number; ingested: number; skipped: number; noPlayer: number; noSidecar: number; }

const SIDE_WINDOW_MS = 15 * 60 * 1000;
function nearestSidecar(index: SidecarIndex | undefined, startMs: number | undefined): SidecarEntry | undefined {
  if (!index || startMs == null) return undefined;
  let best: SidecarEntry | undefined;
  let bestDelta = SIDE_WINDOW_MS;
  for (const e of index.entries) {
    if (typeof e.startEpochMs !== 'number') continue;
    const d = Math.abs(e.startEpochMs - startMs);
    if (d <= bestDelta) { best = e; bestDelta = d; }
  }
  return best;
}

/** Ingest each log file's arena matches into `db`. Pure of process/argv — testable. */
export async function ingestLogsIntoDb(
  db: DatabaseSync, files: string[], registry: PlayerRef[], sidecar: SidecarIndex | undefined,
): Promise<IngestSummary> {
  const summary: IngestSummary = { files: files.length, ingested: 0, skipped: 0, noPlayer: 0, noSidecar: 0 };
  for (const f of files) {
    let res;
    try { res = await parseLogFile(f); } catch (e) { console.error('skip file', f, String(e)); continue; }
    for (const m of res.arenaMatches) {
      try {
        const metrics = computeMatchMetrics(m);
        const playerUnitId = resolvePlayerUnitId(m, registry);
        if (!playerUnitId) summary.noPlayer += 1;
        const startMs = (m as { startInfo?: { timestamp?: number } }).startInfo?.timestamp;
        const sc = nearestSidecar(sidecar, startMs);
        if (sidecar && !sc) summary.noSidecar += 1;
        upsertMatch(db, m, metrics, {
          playerUnitId, sourceFile: basename(f),
          videoPath: sc?.videoPath, sidecarPath: sc?.jsonPath,
        });
        summary.ingested += 1;
      } catch (e) { console.error('skip match in', f, String(e)); summary.skipped += 1; }
    }
  }
  return summary;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const dirs = process.argv.slice(2);
  if (!dirs.length) { console.error('usage: npm run ingest-db -- <logsDir...>'); process.exit(1); }
  const files = dirs.flatMap((d) => readdirSync(d).filter((f) => /WoWCombatLog.*\.txt$/i.test(f)).map((f) => join(d, f)));
  const db = openDb(cfg.dbPath ?? './wow-arena-eye.local.db');
  const sidecar = cfg.videoDirs?.length ? loadSidecarIndex(cfg.videoDirs) : undefined;
  const summary = await ingestLogsIntoDb(db, files, cfg.players, sidecar);
  console.log('ingest-db:', JSON.stringify(summary));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
