// Regenerate src/metadata/ccCategories.json from the vendored wowarenalogs DR table.
// Source: vendor/wowarenalogs/packages/shared/src/data/spellClassMap.json `diminishingReturns`
//   (itself generated from the wago.tools DB2 SpellCategories.DiminishType table).
// Refresh upstream: wago.tools /db2/SpellCategories/csv?build=<build> joined to SpellName.
// Run manually: node scripts/import-cc-categories.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../vendor/wowarenalogs/packages/shared/src/data/spellClassMap.json', import.meta.url));
const OUT = fileURLToPath(new URL('../src/metadata/ccCategories.json', import.meta.url));

const dr = JSON.parse(readFileSync(SRC, 'utf8')).diminishingReturns;
const out = {};
const counts = {};
for (const [category, spells] of Object.entries(dr)) {
  counts[category] = spells.length;
  for (const s of spells) out[String(s.spellId)] = { drCategory: category, name: s.name };
}
const sorted = Object.fromEntries(Object.keys(out).sort((a, b) => Number(a) - Number(b)).map((k) => [k, out[k]]));
writeFileSync(OUT, JSON.stringify(sorted, null, 0) + '\n');
console.log('imported cc categories:', counts, '| total spells', Object.keys(sorted).length);
