import { loadJson } from './loadJson.js';

const TABLE = loadJson<Record<string, string>>(new URL('./arenas.json', import.meta.url));

/** Arena name for a zone id; the raw id if unknown. */
export function mapName(zoneId: string): string {
  return TABLE[zoneId] ?? zoneId;
}
