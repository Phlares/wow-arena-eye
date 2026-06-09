import { readFileSync } from 'node:fs';

/** A JSON file by URL (use `new URL('./x.json', import.meta.url)` for module-relative paths). */
export const loadJson = <T>(url: URL): T => JSON.parse(readFileSync(url, 'utf8')) as T;
