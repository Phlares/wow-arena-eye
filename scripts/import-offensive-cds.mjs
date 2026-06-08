// Regenerate src/metadata/offensiveCds.json from the vendored wowarenalogs class metadata.
// Source: vendor/wowarenalogs/packages/parser/src/classMetadata.ts (entries tagged SpellTag.Offensive).
// Run manually: node scripts/import-offensive-cds.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Pure parse of classMetadata.ts text → distinct [{id,name}] of SpellTag.Offensive entries. */
export function parseOffensive(src) {
  const re = /spellId:\s*'(\d+)',\s*name:\s*'([^']*)',\s*tags:\s*\[([^\]]*)\]/g;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!/Offensive/.test(m[3])) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], name: m[2] });
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const srcPath = new URL('../vendor/wowarenalogs/packages/parser/src/classMetadata.ts', import.meta.url);
  const ids = parseOffensive(readFileSync(srcPath, 'utf8'));
  const data = { source: 'wowarenalogs classMetadata.ts SpellTag.Offensive', ids };
  const outPath = new URL('../src/metadata/offensiveCds.json', import.meta.url);
  writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
  console.log('imported offensive CDs:', ids.length);
}
