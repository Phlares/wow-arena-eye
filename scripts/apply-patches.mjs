/**
 * Apply local patches to node_modules after npm install.
 *
 * Patches live in patches/<package>+<version>.patch and are plain unified-diff
 * files.  We apply them with the `patch` CLI (Unix) or by doing targeted
 * string replacements (Windows / cross-platform fallback).
 *
 * Currently patched:
 *   vite-node@2.1.9  — adds "node:sqlite" to prefixedBuiltins so that
 *                       node:sqlite (experimental, absent from builtinModules)
 *                       is not normalised to bare "sqlite" by normalizeModuleId
 *                       and is correctly treated as a Node built-in in tests.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function patchViteNode() {
  const files = [
    resolve(root, 'node_modules/vite-node/dist/utils.cjs'),
    resolve(root, 'node_modules/vite-node/dist/utils.mjs'),
  ];
  const from = 'new Set(["node:test"])';
  const to   = 'new Set(["node:test", "node:sqlite"])';
  for (const file of files) {
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    if (src.includes(to)) { /* already patched */ continue; }
    if (!src.includes(from)) {
      console.warn(`[apply-patches] WARNING: ${file} does not contain expected string; skipping.`);
      continue;
    }
    writeFileSync(file, src.replace(from, to), 'utf8');
    console.log(`[apply-patches] patched ${file}`);
  }
}

patchViteNode();
