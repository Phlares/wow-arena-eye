/**
 * Isolates all parser-event field access in one place.
 * Every other module that reads combat events MUST go through these accessors.
 *
 * Real field names (discovered via TDD against the real fixture):
 *   event type   : logLine.event          (LogEvent enum string, e.g. "SPELL_CAST_SUCCESS")
 *   srcUnitId    : srcUnitId              (direct field on CombatAction)
 *   destUnitId   : destUnitId             (direct field on CombatAction)
 *   spellName    : spellName              (direct field on CombatAction, nullable)
 *   extraSpellName: extraSpellName        (direct field on CombatExtraSpellAction)
 *   auraType     : logLine.parameters[14] (not a class field; raw WoW param for SPELL_DISPEL etc.)
 *   timestamp    : timestamp              (direct field on CombatAction)
 *   position x   : advancedActorPositionX (number, ~41% of events carry valid position)
 *   position y   : advancedActorPositionY (number)
 *   facing       : advancedActorFacing    (number, radians)
 */

type Ev = Record<string, unknown>;
type LogLineShape = { event: unknown; timestamp?: unknown; parameters?: unknown[] };

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

function strOpt(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function logLine(ev: unknown): LogLineShape | undefined {
  const e = ev as Ev;
  const ll = e?.logLine;
  if (ll && typeof ll === 'object') return ll as LogLineShape;
  return undefined;
}

/** The LogEvent string, e.g. "SPELL_CAST_SUCCESS". Never returns empty — falls back to "UNKNOWN". */
export function eventType(ev: unknown): string {
  const ll = logLine(ev);
  if (ll) return str(ll.event) || 'UNKNOWN';
  // Fallback: some shapes may expose event directly
  const e = ev as Ev;
  return str(e?.event) || 'UNKNOWN';
}

/** Source unit GUID/id string, e.g. "Player-…". */
export function srcId(ev: unknown): string | undefined {
  const e = ev as Ev;
  return strOpt(e?.srcUnitId);
}

/** Destination unit GUID/id string. */
export function destId(ev: unknown): string | undefined {
  const e = ev as Ev;
  return strOpt(e?.destUnitId);
}

/** Spell name for the primary spell on the event. Returns "" when absent. */
export function spellName(ev: unknown): string {
  const e = ev as Ev;
  return str(e?.spellName);
}

/**
 * Extra spell name — present on CombatExtraSpellAction events:
 * SPELL_INTERRUPT, SPELL_STOLEN, SPELL_DISPEL, SPELL_DISPEL_FAILED.
 * This is the name of the spell that was interrupted/dispelled/stolen.
 */
export function extraSpellName(ev: unknown): string | undefined {
  const e = ev as Ev;
  return strOpt(e?.extraSpellName);
}

/**
 * Aura type for dispel/aura events ("BUFF" | "DEBUFF").
 * Not a class field — read from logLine.parameters[14] (WoW combat log raw param).
 * Layout for SPELL_DISPEL: [...8 prefix params, spellId, spellName, spellSchool,
 *   extraSpellId, extraSpellName, auraAmount, auraType]
 */
export function auraType(ev: unknown): 'BUFF' | 'DEBUFF' | undefined {
  const ll = logLine(ev);
  const params = ll?.parameters;
  if (!Array.isArray(params)) return undefined;
  const v = str(params[14]);
  return v === 'BUFF' || v === 'DEBUFF' ? v : undefined;
}

/** Epoch ms of the match's first event (the t=0 reference), or undefined if no events. */
export function matchStartMs(events: unknown[]): number | undefined {
  for (const ev of events) {
    const t = eventTimeMs(ev);
    if (t !== undefined) return t;
  }
  return undefined;
}

/** Millisecond timestamp of the event (directly on CombatAction). */
export function eventTimeMs(ev: unknown): number | undefined {
  const e = ev as Ev;
  const t = e?.timestamp;
  return typeof t === 'number' ? t : undefined;
}

/**
 * Advanced-log position of the source unit at the time of the event.
 * Returns undefined for events without valid position data (x=0 & y=0 is treated as absent).
 * Real field names (confirmed via TDD): advancedActorPositionX / advancedActorPositionY /
 * advancedActorFacing. Present on ~41% of events in a typical arena match.
 */
export function position(ev: unknown): { x: number; y: number; facing?: number } | undefined {
  const e = ev as Ev;
  const x = e?.advancedActorPositionX ?? e?.positionX ?? e?.x;
  const y = e?.advancedActorPositionY ?? e?.positionY ?? e?.y;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  if (x === 0 && y === 0) return undefined;
  const f = e?.advancedActorFacing ?? e?.advancedActorPositionFacing ?? e?.facing;
  return { x, y, facing: typeof f === 'number' ? f : undefined };
}

