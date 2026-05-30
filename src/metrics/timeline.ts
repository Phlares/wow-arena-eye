import { eventType, srcId, destId, spellName, extraSpellName, eventTimeMs } from './eventAccess.js';
import type { TimelineEvent, TimelineKind } from './types.js';

const KIND: Record<string, TimelineKind> = {
  SPELL_CAST_SUCCESS: 'cast',
  SPELL_INTERRUPT: 'interrupt',
  SPELL_DISPEL: 'dispel',
  SPELL_STOLEN: 'steal',
  UNIT_DIED: 'death',
};

export function buildTimeline(match: unknown): TimelineEvent[] {
  const m = match as { events?: unknown[]; units?: Record<string, { name?: unknown }> };
  const events = Array.isArray(m.events) ? m.events : [];
  const units = m.units ?? {};
  const startMs = events.length > 0 ? eventTimeMs(events[0]) : undefined;
  const nameOf = (id: string | undefined) => {
    const u = id ? units[id] : undefined;
    return u && typeof u.name === 'string' && u.name.length > 0 ? u.name : id ?? '?';
  };

  const out: TimelineEvent[] = [];
  for (const ev of events) {
    const kind = KIND[eventType(ev)];
    if (!kind) continue;
    const ms = eventTimeMs(ev);
    if (ms === undefined || startMs === undefined) continue;
    const actorId = kind === 'death' ? destId(ev) : srcId(ev);
    out.push({
      tSec: Math.round((ms - startMs) / 1000),
      unitId: actorId ?? '?',
      unitName: nameOf(actorId),
      kind,
      spell: kind === 'death' ? undefined : spellName(ev),
      extra: kind === 'interrupt' || kind === 'dispel' || kind === 'steal' ? extraSpellName(ev) : undefined,
    });
  }
  return out.sort((a, b) => a.tSec - b.tSec);
}
