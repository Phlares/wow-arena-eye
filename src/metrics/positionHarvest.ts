import { Subject } from 'rxjs';
import { stringToLogLine, logLineToCombatEvent } from '@wowarenalogs/parser';
import { srcId, position } from './eventAccess.js';

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
 * Event-kind detection uses constructor.name (not instanceof): under tsx/vitest the action
 * classes can resolve to distinct module identities, which silently breaks instanceof.
 */
export async function harvestPositions(
  lines: Iterable<string> | AsyncIterable<string>,
  into: Map<string, XY[]> = new Map(),
): Promise<Map<string, XY[]>> {
  const subject = new Subject<string>();
  let zone: string | null = null;
  const sub = subject.pipe(stringToLogLine(FALLBACK_TZ), logLineToCombatEvent('retail')).subscribe((ev) => {
    if (typeof ev === 'string') return;
    const kind = (ev as { constructor?: { name?: string } })?.constructor?.name;
    if (kind === 'ArenaMatchStart') {
      zone = (ev as unknown as { zoneId: string }).zoneId;
      return;
    }
    if (kind === 'ArenaMatchEnd') {
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
  sub.unsubscribe();
  return into;
}
