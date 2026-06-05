import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface SpecRow { className: string; specName: string }
const TABLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./specs.json', import.meta.url)), 'utf8'),
) as Record<string, SpecRow>;

/** Short display label for a spec id (the spec name, e.g. '265' -> 'Affliction'); raw id if unknown. */
export function specLabel(id: string): string {
  const row = TABLE[id];
  if (!row) return id;
  return row.specName || row.className || id;
}

/** Readable comp label from a sorted, '_'-joined spec-id signature. '' -> ''. */
export function compLabel(sig: string): string {
  if (sig === '') return '';
  return sig.split('_').map(specLabel).join('·');
}

/** Class name for a spec id; '' if unknown. */
export function className(id: string): string {
  return TABLE[id]?.className ?? '';
}

/** All spec ids belonging to a class (by className). */
export function specsOfClass(cls: string): string[] {
  return Object.keys(TABLE).filter((id) => TABLE[id].className === cls);
}
