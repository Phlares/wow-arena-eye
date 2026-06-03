import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Vite rewrites NodeNext `.js` import specifiers to their `.ts` source for `.ts`
// importers, but not when the importer is a `.mjs` file (e.g. scripts/build-occupancy.mjs
// importing `../src/parser/parserClient.js`). This plugin restores that rewrite so the
// generator's pure fns can be unit-tested without changing the runtime import lines.
function rewriteJsToTsFromMjs() {
  return {
    name: 'rewrite-js-to-ts-from-mjs',
    enforce: 'pre' as const,
    resolveId(source: string, importer?: string) {
      if (!importer || !importer.endsWith('.mjs')) return null;
      if (!source.startsWith('.') || !source.endsWith('.js')) return null;
      const tsPath = resolve(dirname(importer), source.replace(/\.js$/, '.ts'));
      return existsSync(tsPath) ? tsPath : null;
    },
  };
}

export default defineConfig({
  plugins: [rewriteJsToTsFromMjs()],
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
  },
});
