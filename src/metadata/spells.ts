import { loadJson } from './loadJson.js';
import type { DrCategory } from '../metrics/types.js';

export type SpellTag = 'interrupt' | 'cc' | 'defensive' | 'immunity' | 'offensive';
export interface SpellMeta { name: string; tags: SpellTag[]; ccCategory?: DrCategory; lockoutSec?: number; priority?: number; }

const TABLE = loadJson<Record<string, SpellMeta>>(new URL('./spells.curated.json', import.meta.url));

const CC_CATEGORIES = loadJson<Record<string, { drCategory: DrCategory; name: string }>>(new URL('./ccCategories.json', import.meta.url));

export function spellMeta(id: number | undefined): SpellMeta | undefined {
  return id === undefined ? undefined : TABLE[String(id)];
}
export function isInterrupt(id: number | undefined): boolean {
  return spellMeta(id)?.tags.includes('interrupt') ?? false;
}
export function ccInfo(id: number | undefined): { category: DrCategory } | undefined {
  if (id === undefined) return undefined;
  const fromDb = CC_CATEGORIES[String(id)];
  if (fromDb) return { category: fromDb.drCategory };
  // fallback: CC spells absent from the DB DR table (e.g. 5782 Warlock Fear) still classified via curated
  const m = spellMeta(id);
  if (m && m.tags.includes('cc') && m.ccCategory) return { category: m.ccCategory };
  return undefined;
}
export function isDefensive(id: number | undefined): boolean {
  return spellMeta(id)?.tags.includes('defensive') ?? false;
}
export function isImmunity(id: number | undefined): boolean {
  return spellMeta(id)?.tags.includes('immunity') ?? false;
}
/** School-lockout seconds for an interrupt spell (curated). 0 for non-interrupts; default 4 for an interrupt with no curated value. */
export function interruptLockoutSec(id: number | undefined): number {
  const m = spellMeta(id);
  if (!m || !m.tags.includes('interrupt')) return 0;
  return m.lockoutSec ?? 4;
}

/** Read-only CC catalog (DR category per spell): the imported DR table plus curated cc spells it
 *  misses (e.g. Seduction). For the viewer's Settings view. */
export function ccCatalog(): { id: number; name: string; category: DrCategory }[] {
  const out = new Map<number, { id: number; name: string; category: DrCategory }>();
  for (const [id, v] of Object.entries(CC_CATEGORIES)) out.set(Number(id), { id: Number(id), name: v.name, category: v.drCategory });
  for (const [id, v] of Object.entries(TABLE)) {
    const n = Number(id);
    if (!out.has(n) && v.tags.includes('cc') && v.ccCategory) out.set(n, { id: n, name: v.name, category: v.ccCategory });
  }
  return [...out.values()].sort((a, b) => a.id - b.id);
}
