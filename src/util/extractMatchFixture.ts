import { createInterface } from 'node:readline';
import { createReadStream, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Extract the first complete arena match (header line + ARENA_MATCH_START..ARENA_MATCH_END)
 * from a large combat log into a small fixture file. Dev/test helper only.
 */
export async function extractFirstArenaMatch(srcPath: string, destPath: string): Promise<void> {
  const stream = createReadStream(srcPath);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const captured: string[] = [];
  let header: string | null = null;
  let capturing = false;
  let done = false;

  try {
    for await (const line of rl) {
      if (done) break;
      if (header === null && line.includes('COMBAT_LOG_VERSION')) {
        header = line;
        continue;
      }
      if (!capturing && line.includes('ARENA_MATCH_START')) capturing = true;
      if (capturing) {
        captured.push(line);
        if (line.includes('ARENA_MATCH_END')) done = true;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  if (!header || captured.length === 0 || !done) {
    throw new Error(`No complete arena match found in ${srcPath}`);
  }
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, [header, ...captured].join('\n') + '\n', 'utf8');
}

// CLI entry: tsx src/util/extractMatchFixture.ts <srcLog> <destFixture>
if (process.argv[1] && process.argv[1].endsWith('extractMatchFixture.ts')) {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) {
    console.error('Usage: npm run extract-fixture -- <srcLog> <destFixture>');
    process.exit(1);
  }
  extractFirstArenaMatch(src, dest)
    .then(() => console.log(`Wrote fixture: ${dest}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
