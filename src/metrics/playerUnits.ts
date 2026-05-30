import { eventType, srcId, destId } from './eventAccess.js';

/**
 * GUIDs that count as "the player": the recording player (match.playerId) plus
 * any pet/guardian they summoned (SPELL_SUMMON with the player as source).
 */
export function resolvePlayerUnits(match: unknown): Set<string> {
  const m = match as { playerId?: unknown; events?: unknown[] };
  const set = new Set<string>();
  const player = typeof m.playerId === 'string' ? m.playerId : undefined;
  if (!player) return set;
  set.add(player);

  const events = Array.isArray(m.events) ? m.events : [];
  for (const ev of events) {
    if (eventType(ev) === 'SPELL_SUMMON' && srcId(ev) === player) {
      const pet = destId(ev);
      if (pet) set.add(pet);
    }
  }
  return set;
}
