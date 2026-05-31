import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DrCategory } from '../metrics/types.js';

export type SpellTag = 'interrupt' | 'cc' | 'defensive' | 'immunity' | 'offensive';
export interface SpellMeta { name: string; tags: SpellTag[]; ccCategory?: DrCategory; lockoutSec?: number; priority?: number; }

const TABLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./spells.curated.json', import.meta.url)), 'utf8'),
) as Record<string, SpellMeta>;

const CC_CATEGORIES = JSON.parse(
  readFileSync(fileURLToPath(new URL('./ccCategories.json', import.meta.url)), 'utf8'),
) as Record<string, { drCategory: DrCategory; name: string }>;

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
