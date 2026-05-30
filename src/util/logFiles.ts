import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Most recently modified WoWCombatLog file in dir (filenames are not chronological). */
export function firstLog(dir: string): string {
  const files = readdirSync(dir).filter((n) => n.startsWith('WoWCombatLog'));
  if (files.length === 0) throw new Error(`No WoWCombatLog files in ${dir}`);
  const paths = files.map((n) => join(dir, n));
  paths.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return paths[0];
}
