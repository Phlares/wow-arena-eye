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

  const startMs = typeof startInfo.timestamp === 'number' ? startInfo.timestamp : null;

  return {
    kind,
    bracket: str(startInfo.bracket) || '?',
    zone: str(startInfo.zoneId) || '?',
    isRanked: typeof startInfo.isRanked === 'boolean' ? startInfo.isRanked : null,
    startTimeMs: startMs,
    startTimeIso: startMs !== null ? new Date(startMs).toISOString() : null,
    endTimeMs: typeof m.endTime === 'number' ? m.endTime : null,
    durationSec: typeof m.durationInSeconds === 'number' ? m.durationInSeconds : null,
    result: m.result,
    winningTeamId: m.winningTeamId,
    eventCounts,
    combatants,
    rawStartInfo: m.startInfo ?? null,
    rawEndInfo: m.endInfo ?? null,
  };
}
