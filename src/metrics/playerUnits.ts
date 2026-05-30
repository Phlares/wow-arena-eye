import { eventType, srcId, destId, ownerId } from './eventAccess.js';

/**
 * GUIDs that count as "the player": the recording player (match.playerId) plus
 * any pet/guardian they own.
 *
 * Three mechanisms, in order of reliability:
 *  1. The player itself.
 *  2. Pets summoned in-window (SPELL_SUMMON with player as source).
 *  3. Units in match.units whose ownerId === player — catches pre-summoned pets
 *     (e.g. a warlock Felhunter with a randomized name like "Zhaazhem") that never
 *     emit a SPELL_SUMMON inside the log window.
 *  4. Events carrying advancedOwnerId === player (CombatAdvancedAction events) — a
 *     supplementary sweep that also catches in-combat guardians.
 *
 * Note: plain SPELL_INTERRUPT / SPELL_DISPEL events are CombatAction (no advancedOwnerId),
 * so mechanism 3 (unit scan) is the critical one for interrupt/dispel attribution.
 */
export function resolvePlayerUnits(match: unknown): Set<string> {
  const m = match as { playerId?: unknown; events?: unknown[]; units?: Record<string, unknown> };
  const set = new Set<string>();
  const player = typeof m.playerId === 'string' ? m.playerId : undefined;
  if (!player) return set;
  set.add(player);

  const events = Array.isArray(m.events) ? m.events : [];
  for (const ev of events) {
    // pets summoned in-window
    if (eventType(ev) === 'SPELL_SUMMON' && srcId(ev) === player) {
      const pet = destId(ev);
      if (pet) set.add(pet);
    }
    // pets/guardians linked by advanced-log owner GUID (catches in-combat guardians)
    if (ownerId(ev) === player) {
      const actor = srcId(ev);
      if (actor) set.add(actor);
    }
  }

  // Pre-summoned pets: scan match.units for units whose ownerId === player.
  // This is the critical path for warlock Felhunters and other pre-summoned pets
  // whose SPELL_INTERRUPT / SPELL_DISPEL events lack advancedOwnerId.
  const units = m.units ?? {};
  for (const [id, unit] of Object.entries(units)) {
    const u = unit as Record<string, unknown>;
    if (typeof u.ownerId === 'string' && u.ownerId === player) {
      set.add(id);
    }
  }

  return set;
}
