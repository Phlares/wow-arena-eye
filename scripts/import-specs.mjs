// Regenerate src/metadata/specs.json from the vendored parser's CombatUnitSpec enum.
// Source: vendor/wowarenalogs/packages/parser/src/types.ts (enum keys are `Class_Spec = 'specId'`).
// Refresh upstream per patch: this enum tracks wago.tools DB2 ChrSpecialization.
// Run manually: node scripts/import-specs.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../vendor/wowarenalogs/packages/parser/src/types.ts', import.meta.url));
const OUT = fileURLToPath(new URL('../src/metadata/specs.json', import.meta.url));

const text = readFileSync(SRC, 'utf8');
const body = text.slice(text.indexOf('enum CombatUnitSpec'));
const block = body.slice(body.indexOf('{') + 1, body.indexOf('}'));
const out = {};
for (const m of block.matchAll(/(\w+)\s*=\s*'(\d+)'/g)) {
  const [, key, id] = m;
  if (id === '0') continue; // None
  const us = key.indexOf('_');
  const className = us === -1 ? key : key.slice(0, us);
  const specName = us === -1 ? '' : key.slice(us + 1);
  out[id] = { className, specName };
}
const sorted = Object.fromEntries(Object.keys(out).sort((a, b) => Number(a) - Number(b)).map((k) => [k, out[k]]));
writeFileSync(OUT, JSON.stringify(sorted, null, 0) + '\n');
console.log('imported specs:', Object.keys(sorted).length);
