import type { LosDisruptor } from './types.js';
import { unitTeam } from './types.js';
import { matchStartMs, eventType, srcId, spellId, eventTimeMs, position } from './eventAccess.js';
import { disruptorOf } from '../metadata/losDisruptorAbilities.js';

/** Scan a match for LoS-disruptor casts → intervals (smoke-bomb modeled with pos+radius; others flagged). */
export function collectLosDisruptors(match: unknown): LosDisruptor[] {
  const m = match as { events?: unknown[]; units?: Record<string, { reaction?: unknown }> };
  const events = Array.isArray(m.events) ? m.events : [];
  const startMs = matchStartMs(events) ?? 0;
  const units = m.units ?? {};
  const out: LosDisruptor[] = [];
  for (const ev of events) {
    if (eventType(ev) !== 'SPELL_CAST_SUCCESS') continue;
    const info = disruptorOf(spellId(ev));
    if (!info) continue;
    const s = srcId(ev); const ms = eventTimeMs(ev);
    if (!s || ms === undefined) continue;
    const p = position(ev);
    out.push({
      kind: info.kind, casterId: s, team: unitTeam((units[s] ?? {}).reaction),
      pos: info.modeled && p ? { x: p.x, y: p.y } : undefined,
      radius: info.modeled ? info.radius : undefined,
      startSec: Math.round((ms - startMs) / 1000),
      endSec: Math.round((ms - startMs + info.durationMs) / 1000),
      modeled: info.modeled,
    });
  }
  return out;
}
