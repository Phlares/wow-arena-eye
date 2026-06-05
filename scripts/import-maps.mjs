// Regenerate src/metadata/arenas.json (zoneId -> arena name) from the vendored zoneMetadata.
// Source: vendor/wowarenalogs/packages/shared/src/data/zoneMetadata.ts (mirrors DB2 Map.MapName_lang).
// Run manually: node scripts/import-maps.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../vendor/wowarenalogs/packages/shared/src/data/zoneMetadata.ts', import.meta.url));
const OUT = fileURLToPath(new URL('../src/metadata/arenas.json', import.meta.url));

const text = readFileSync(SRC, 'utf8');
const out = {};
for (const m of text.matchAll(/'(\d+)':\s*\{[\s\S]*?name:\s*'([^']+)'/g)) {
  out[m[1]] = m[2];
}
const sorted = Object.fromEntries(Object.keys(out).sort((a, b) => Number(a) - Number(b)).map((k) => [k, out[k]]));
writeFileSync(OUT, JSON.stringify(sorted, null, 0) + '\n');
console.log('imported arenas:', Object.keys(sorted).length);
