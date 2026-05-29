// Fresh-clone bootstrap: init the parser submodule, build it, install root deps.
// Usage: npm run setup   (run once after cloning)
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const submodule = path.join(root, 'vendor', 'wowarenalogs');
const parserDist = path.join(submodule, 'packages', 'parser', 'dist', 'index.js');

function run(cmd, cwd) {
  console.log(`\n> ${cmd}  (cwd: ${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

console.log('[setup] Initializing parser submodule...');
run('git submodule update --init --recursive', root);

if (!existsSync(path.join(submodule, 'package.json'))) {
  console.error('[setup] ERROR: submodule not present at vendor/wowarenalogs after init.');
  process.exit(1);
}

console.log('[setup] Installing submodule deps and building the parser...');
run('npm install', submodule);
run('npm run build --workspace=packages/parser', submodule);

if (!existsSync(parserDist)) {
  console.error(`[setup] ERROR: parser build did not produce ${parserDist}`);
  process.exit(1);
}

console.log('[setup] Installing project dependencies...');
run('npm install', root);

console.log('\n[setup] Done. Next: copy config.example.json to config.json and fill in your paths, then `npm test`.');
