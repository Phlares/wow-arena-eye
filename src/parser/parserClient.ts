import { WoWCombatLogParser } from '@wowarenalogs/parser';
import type { IArenaMatch, IShuffleRound, IShuffleMatch } from '@wowarenalogs/parser';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

export interface IngestResult {
  arenaMatches: IArenaMatch[];
  shuffleRounds: IShuffleRound[];
  shuffleMatches: IShuffleMatch[];
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

  parser.on('arena_match_ended', (m) => out.arenaMatches.push(m));
  parser.on('solo_shuffle_round_ended', (r) => out.shuffleRounds.push(r));
  parser.on('solo_shuffle_ended', (m) => out.shuffleMatches.push(m));
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
        parser.flush();
      } catch {
        /* flush is best-effort */
      }
      resolve();
    });
    rl.on('error', reject);
  });

  return out;
}

/**
 * TODO(Plan 3): TEMPORARY shape-discovery output — replace with the typed
 * Normalizer that writes real per-match records. Reads values through a Record
 * view so it compiles regardless of the parser's exact field names.
 */
export function summarizeMatch(m: IArenaMatch): Record<string, unknown> {
  const v = m as unknown as Record<string, unknown>;
  const units = v.units as Record<string, unknown> | undefined;
  const events = v.events as unknown[] | undefined;
  return {
    topLevelKeys: Object.keys(m),
    unitCount: units ? Object.keys(units).length : 0,
    eventCount: Array.isArray(events) ? events.length : 0,
    result: v.result,
    winningTeamId: v.winningTeamId,
    durationInSeconds: v.durationInSeconds,
    startInfo: v.startInfo,
  };
}
