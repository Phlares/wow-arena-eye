import { fileURLToPath } from 'node:url';
import { openDb } from '../store/store.js';
import { loadConfig } from '../config.js';
import { loadPlayerMatches } from '../scorecard/loadMatches.js';
import { buildScorecard } from '../scorecard/scorecard.js';
import { renderScorecardText } from '../scorecard/render.js';
import type { PlayerMatch, Scope } from '../scorecard/types.js';

/** Most recent match (max startMs) overall, or for one character. undefined if none. */
export function latestMatchId(matches: PlayerMatch[], character?: string): string | undefined {
  let bestMs = -Infinity;
  let bestId: string | undefined;
  for (const m of matches) {
    if (character && m.character !== character) continue;
    if (m.startMs === null) continue;
    if (m.startMs > bestMs) { bestMs = m.startMs; bestId = m.matchId; }
  }
  return bestId;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
function has(flag: string): boolean { return process.argv.includes(flag); }

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath ?? './wow-arena-eye.local.db');
  const character = arg('--character');
  const matches = loadPlayerMatches(db, character);
  if (matches.length === 0) { console.error('No matches in the store. Run `npm run ingest-db -- <logsDir>` first.'); process.exit(1); }

  const targetId = arg('--match') ?? latestMatchId(matches, character);
  if (!targetId || !matches.some((m) => m.matchId === targetId)) {
    console.error(`Target match not found. Pass --match <id>, or run \`npm run ingest-db -- <logsDir>\` to add matches. (have ${matches.length})`); process.exit(1);
  }

  const scope: Scope = {};
  if (has('--map')) scope.map = true;
  if (has('--comp')) scope.comp = true;
  if (has('--season')) scope.season = true;
  const rb = arg('--rating-band');
  if (has('--rating-band')) { const v = Number(rb); scope.ratingBand = rb !== undefined && Number.isFinite(v) ? v : 150; }
  const tod = arg('--time-of-day');
  if (has('--time-of-day')) { const v = Number(tod); scope.timeOfDayHours = tod !== undefined && Number.isFinite(v) ? v : 2; }

  const sc = buildScorecard(matches, targetId, { scope, seasons: cfg.seasons });
  if (has('--json')) { console.log(JSON.stringify(sc, null, 2)); return; }
  console.log(renderScorecardText(sc));
  if (sc.cohort.n < 5) console.log(`\n  note: thin sample (n=${sc.cohort.n}); verdicts may read n/a.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((e) => { console.error(e); process.exit(1); });
