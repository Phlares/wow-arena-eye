import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DrCategory } from '../metrics/types.js';

export type SpellTag = 'interrupt' | 'cc' | 'defensive' | 'immunity' | 'offensive';
export interface SpellMeta { name: string; tags: SpellTag[]; ccCategory?: DrCategory; drCategory?: DrCategory; priority?: number; }

const TABLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./spells.curated.json', import.meta.url)), 'utf8'),
) as Record<string, SpellMeta>;

export function spellMeta(id: number | undefined): SpellMeta | undefined {
  return id === undefined ? undefined : TABLE[String(id)];
}
export function isInterrupt(id: number | undefined): boolean {
  return spellMeta(id)?.tags.includes('interrupt') ?? false;
}
export function ccInfo(id: number | undefined): { category: DrCategory; dr?: DrCategory } | undefined {
  const m = spellMeta(id);
  if (!m || !m.tags.includes('cc') || !m.ccCategory) return undefined;
  return { category: m.ccCategory, dr: m.drCategory };
}
export function isDefensive(id: number | undefined): boolean {
  return spellMeta(id)?.tags.includes('defensive') ?? false;
}
