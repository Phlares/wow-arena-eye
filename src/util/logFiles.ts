import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Full paths of every WoWCombatLog*.txt file in dir (order not guaranteed). */
export function allLogs(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => /^WoWCombatLog.*\.txt$/i.test(n))
    .map((n) => join(dir, n));
}

/** Most recently modified WoWCombatLog file in dir (filenames are not chronological). */
export function firstLog(dir: string): string {
  const files = readdirSync(dir).filter((n) => n.startsWith('WoWCombatLog'));
  if (files.length === 0) throw new Error(`No WoWCombatLog files in ${dir}`);
  const withMtime = files.map((n) => {
    const p = join(dir, n);
    return { p, mtime: statSync(p).mtimeMs };
  });
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime[0].p;
}
