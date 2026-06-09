import { loadJson } from './loadJson.js';
import { spellMeta } from './spells.js';
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

const DATA = loadJson<RawData>(new URL('./cooldowns.json', import.meta.url));

/** Offensive cooldown classification (kind/cooldown) for the curated supplement. */
export interface OffensiveCdMeta { name: string; cooldownSec: number; kind: 'buff' | 'debuff' | 'pet-summon'; windowSec?: number; }

const VENDOR_OFFENSIVE = loadJson<{ ids: { id: string; name: string }[] }>(new URL('./offensiveCds.json', import.meta.url));

// Current-retail (12.0.x) offensive cooldowns (>=30s) the vendor SpellTag.Offensive set and the
// MiniCC highlight list miss. kind: buff (self-buff aura) | debuff (target aura the attacker
// applies) | pet-summon (no aura -> cast-based fixed window of windowSec). cooldownSec drives the
// GO-band safety availability. Hand-curated; verified against the live log corpus 2026-06-09.
const CURATED_OFFENSIVE = loadJson<Record<string, OffensiveCdMeta>>(new URL('./offensiveCds.curated.json', import.meta.url));

/** Curated offensive-CD metadata by spellId (kind/cooldown/window). */
const CURATED_META = new Map<number, OffensiveCdMeta>(
  Object.entries(CURATED_OFFENSIVE).map(([id, v]) => [Number(id), v]),
);

/** Curated offensive-CD metadata for a spellId, or undefined. */
export function offensiveCdMeta(spellId: number | undefined): OffensiveCdMeta | undefined {
  return spellId === undefined ? undefined : CURATED_META.get(spellId);
}

// Ids that are NOT >=30s burst markers (mobility/utility/legacy, arena-unusable, healing/tank
// variants). The generator already excludes them from offensiveCds.json; subtracting here too
// protects the union whichever source (MiniCC/vendor/curated) an id arrives through.
const DENIED_OFFENSIVE = loadJson<Record<string, { name: string; reason: string }>>(new URL('./offensiveCds.deny.json', import.meta.url));
const DENIED_IDS = new Set<number>(Object.keys(DENIED_OFFENSIVE).map(Number));

/** Union of every offensive-CD source — the MiniCC highlight list, the vendor SpellTag.Offensive
 *  set, and the curated current-retail supplement — minus the denylist of vendor false-positives.
 *  Single source of truth for `isOffensiveCd`. */
export const OFFENSIVE_SPELL_IDS: Set<number> = new Set<number>(
  [
    ...DATA.offensiveSpellIds,
    ...VENDOR_OFFENSIVE.ids.map((e) => Number(e.id)),
    ...CURATED_META.keys(),
  ].filter((id) => !DENIED_IDS.has(id)),
);
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

// --- read-only catalogs for the viewer's Settings view ---

/** Every tracked offensive CD (union minus denylist), with curated/vendor names + meta where known. */
export function offensiveCatalog(): { id: number; name?: string; cooldownSec?: number; kind?: string; windowSec?: number }[] {
  const vendorName = new Map(VENDOR_OFFENSIVE.ids.map((e) => [Number(e.id), e.name]));
  return [...OFFENSIVE_SPELL_IDS].sort((a, b) => a - b).map((id) => {
    const meta = CURATED_META.get(id);
    return { id, name: meta?.name ?? vendorName.get(id), cooldownSec: meta?.cooldownSec, kind: meta?.kind, windowSec: meta?.windowSec };
  });
}

/** The denylisted vendor false-positives, with the reason each was pruned. */
export function deniedOffensiveCatalog(): { id: number; name: string; reason: string }[] {
  return Object.entries(DENIED_OFFENSIVE).map(([id, v]) => ({ id: Number(id), name: v.name, reason: v.reason }));
}

/** Flat dedup of the non-offensive cooldown registry (defensive/external/trinket/important).
 *  Names come from the curated spell table where known (the registry itself is id-only). */
export function defensiveCatalog(): { id: number; name?: string; cooldownSec: number; category: CdCategory }[] {
  const seen = new Map<number, { id: number; name?: string; cooldownSec: number; category: CdCategory }>();
  for (const list of [...Object.values(DATA.bySpec), ...Object.values(DATA.byClass)]) {
    for (const e of list) {
      const category = categoryOf(e);
      if (category === 'offensive' || e.cooldownSec <= 0 || seen.has(e.spellId)) continue;
      seen.set(e.spellId, { id: e.spellId, name: spellMeta(e.spellId)?.name, cooldownSec: e.cooldownSec, category });
    }
  }
  return [...seen.values()].sort((a, b) => a.id - b.id);
}
