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

/** Normalize a raw className from specs.json to a display name with spaces.
 *  'DeathKnight' → 'Death Knight', 'DemonHunter' → 'Demon Hunter', etc. */
function displayClassName(raw: string): string {
  return raw.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Class name for a spec id (display form with spaces, e.g. 'Death Knight'); '' if unknown. */
export function className(id: string): string {
  const raw = TABLE[id]?.className;
  return raw ? displayClassName(raw) : '';
}

/** All spec ids belonging to a class (by className, accepts both display form and raw form). */
export function specsOfClass(cls: string): string[] {
  const normalized = cls.replace(/\s+/g, ''); // strip spaces for comparison
  return Object.keys(TABLE).filter((id) => TABLE[id].className === normalized || TABLE[id].className === cls);
}
