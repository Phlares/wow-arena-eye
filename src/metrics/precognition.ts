import { unionSeconds, type Window } from './ccTime.js';
import { unitKind, unitTeam } from './types.js';
import type { AuraState } from './auraState.js';
import { PRECOGNITION_AURA_ID, PRECOGNITION_MAX_INSTANCE_SEC } from '../metadata/precognition.js';

export interface PrecognitionUptime { selfSec: number; enemySec: number; }

/** Per-unit Precognition uptime: `selfSec` = union of the unit's own Precognition aura;
 *  `enemySec` = sum of `selfSec` over the opposite team's PLAYER units (pets/totems excluded),
 *  matching how ccDone aggregates across targets. Unclosed auras clamped to the instance cap. */
export function computePrecognition(
  units: Record<string, Record<string, unknown>>, auras: AuraState, endMs: number,
): Map<string, PrecognitionUptime> {
  const ids = Object.keys(units);
  const capMs = PRECOGNITION_MAX_INSTANCE_SEC * 1000;
  const ownSec = new Map<string, number>();
  for (const id of ids) {
    const windows: Window[] = auras.intervalsOn(id)
      .filter((i) => i.spellId === PRECOGNITION_AURA_ID)
      .map((i) => ({ start: i.start, end: Math.min(i.end, endMs, i.start + capMs) }));
    ownSec.set(id, unionSeconds(windows));
  }
  const teamOf = (id: string) => unitTeam((units[id] ?? {}).reaction);
  const isPlayer = (id: string) => unitKind((units[id] ?? {}).type) === 'player';
  const out = new Map<string, PrecognitionUptime>();
  for (const id of ids) {
    let enemySec = 0;
    for (const v of ids) if (v !== id && isPlayer(v) && teamOf(v) !== teamOf(id)) enemySec += ownSec.get(v) ?? 0;
    out.set(id, { selfSec: ownSec.get(id) ?? 0, enemySec });
  }
  return out;
}
