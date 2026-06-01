import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CdCategory } from '../metrics/types.js';

interface RawEntry {
  spellId: number; cooldownSec: number; buffDurationSec: number; charges: number;
  bigDefensive: boolean; externalDefensive: boolean; important: boolean;
  castSpellId?: number; noAura?: boolean;
}
interface RawData {
  offensiveSpellIds: number[];
  specToClass: Record<string, string>;
  bySpec: Record<string, RawEntry[]>;
  byClass: Record<string, RawEntry[]>;
}

const DATA = JSON.parse(
  readFileSync(fileURLToPath(new URL('./cooldowns.json', import.meta.url)), 'utf8'),
) as RawData;

export const OFFENSIVE_SPELL_IDS: Set<number> = new Set(DATA.offensiveSpellIds);
/** PvP trinket + the two common PvP-trinket racials (Will to Survive / Will of the Forsaken). */
export const TRINKET_SPELL_IDS: Set<number> = new Set([336126, 59752, 7744]);

export interface CdEntry {
  spellId: number;
  cooldownMs: number;
  buffDurationMs: number;
  charges: number;
  category: CdCategory;
  castSpellId?: number;
  noAura: boolean;
}

function categoryOf(e: RawEntry): CdCategory {
  if (TRINKET_SPELL_IDS.has(e.spellId)) return 'trinket';
  if (OFFENSIVE_SPELL_IDS.has(e.spellId)) return 'offensive';
  if (e.externalDefensive) return 'external';
  if (e.bigDefensive) return 'defensive';
  // fallthrough: not a trinket/offensive/defensive — note this is NOT gated on RawEntry.important (which is unused here)
  return 'important';
}

function toEntry(e: RawEntry): CdEntry {
  return {
    spellId: e.spellId,
    cooldownMs: e.cooldownSec * 1000,
    buffDurationMs: e.buffDurationSec * 1000,
    charges: e.charges > 0 ? e.charges : 1,
    category: categoryOf(e),
    castSpellId: e.castSpellId,
    noAura: e.noAura === true,
  };
}

/** All tracked CDs for a spec: spec-specific rules first, then class-fallback rules not already present. */
export function cdsForSpec(specId: string | undefined): CdEntry[] {
  if (!specId) return [];
  const seen = new Set<number>();
  const out: CdEntry[] = [];
  for (const e of DATA.bySpec[specId] ?? []) {
    if (!seen.has(e.spellId)) {
      seen.add(e.spellId);
      out.push(toEntry(e));
    }
  }
  const cls = DATA.specToClass[specId];
  if (cls) {
    for (const e of DATA.byClass[cls] ?? []) {
      if (!seen.has(e.spellId)) {
        seen.add(e.spellId);
        out.push(toEntry(e));
      }
    }
  }
  return out;
}

/** One CD's metadata, resolved spec-first then class-fallback. Builds the spec list per call —
 *  for per-spell loops over one player, call `cdsForSpec(specId)` once and `.find` instead. */
export function cdInfo(spellId: number | undefined, specId?: string): CdEntry | undefined {
  if (spellId === undefined) return undefined;
  if (specId) {
    const hit = cdsForSpec(specId).find((e) => e.spellId === spellId);
    if (hit) return hit;
  }
  // class-agnostic fallback: scan all class lists (used when spec is unknown)
  for (const list of Object.values(DATA.byClass)) {
    const e = list.find((x) => x.spellId === spellId);
    if (e) return toEntry(e);
  }
  return undefined;
}

export function isOffensiveCd(spellId: number | undefined): boolean {
  return spellId !== undefined && OFFENSIVE_SPELL_IDS.has(spellId);
}
