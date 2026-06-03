import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Subject } from 'rxjs';
import { stringToLogLine, logLineToCombatEvent } from '@wowarenalogs/parser';
import { srcId, position, eventType } from './eventAccess.js';

export interface XY {
  x: number;
  y: number;
}

// Timezone is only consulted for timestamps WITHOUT an explicit UTC offset; real arena
// logs carry an offset (e.g. "-4"), so this fallback is rarely used.
const FALLBACK_TZ = 'America/New_York';

/**
 * Stream raw combat-log lines through the parser's own per-line pipeline and collect
 * PLAYER positions, keyed by the active arena zoneId. Positions are recorded only while
 * a match is active (between ARENA_MATCH_START and ARENA_MATCH_END). Events that fail to
 * parse (e.g. the version-shifted COMBATANT_INFO in older logs) are dropped harmlessly by
 * logLineToCombatEvent's internal try/catch, so a bad event never aborts harvesting.
 *
 * Event-kind detection uses eventAccess.eventType (logLine.event) — the same stable
 * discriminator the parser's own action classes use — rather than `instanceof`, which
 * silently breaks when tsx/vitest resolve the action classes to distinct module identities.
 */
export async function harvestPositions(
  lines: Iterable<string> | AsyncIterable<string>,
  into: Map<string, XY[]> = new Map(),
): Promise<Map<string, XY[]>> {
  const subject = new Subject<string>();
  let zone: string | null = null;
  // The pipe is synchronous (subject.next drives the subscriber inline), so the
  // subscription needs no explicit teardown — subject.complete() ends it.
  subject.pipe(stringToLogLine(FALLBACK_TZ), logLineToCombatEvent('retail')).subscribe((ev) => {
    if (typeof ev === 'string') return;
    const kind = eventType(ev);
    if (kind === 'ARENA_MATCH_START') {
      zone = (ev as { zoneId?: string }).zoneId ?? null;
      return;
    }
    if (kind === 'ARENA_MATCH_END') {
      zone = null;
      return;
    }
    if (!zone) return;
    const s = srcId(ev);
    if (!s || !s.startsWith('Player-')) return;
    const p = position(ev);
    if (!p) return;
    const arr = into.get(zone) ?? [];
    arr.push({ x: p.x, y: p.y });
    into.set(zone, arr);
  });
  for await (const line of lines) subject.next(line);
  subject.complete();
  return into;
}

/** Convenience wrapper: harvest positions from a combat-log file by path. */
export async function harvestFile(path: string, into: Map<string, XY[]> = new Map()): Promise<Map<string, XY[]>> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  return harvestPositions(rl, into);
}
