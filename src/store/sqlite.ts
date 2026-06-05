import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncCtor } from 'node:sqlite';

// node:sqlite is an experimental Node builtin (absent from builtinModules), so a static
// `import ... from 'node:sqlite'` is mis-normalized by bundlers / vite-node (the `node:`
// prefix gets stripped to bare `sqlite`, which then fails to resolve). Loading it through
// createRequire — the same pattern vendor/parser-proxy uses — sidesteps that and hits the
// real Node module loader. Still requires the runtime flag (--experimental-sqlite).
const require = createRequire(import.meta.url);
const sqlite = require('node:sqlite') as typeof import('node:sqlite');

export const DatabaseSync = sqlite.DatabaseSync;
export type DatabaseSync = DatabaseSyncCtor;
