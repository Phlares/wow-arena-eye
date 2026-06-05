import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TABLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./arenas.json', import.meta.url)), 'utf8'),
) as Record<string, string>;

/** Arena name for a zone id; the raw id if unknown. */
export function mapName(zoneId: string): string {
  return TABLE[zoneId] ?? zoneId;
}
