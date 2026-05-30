import { loadConfig } from '../config.js';
import { parseLogFile, summarizeMatch } from '../parser/parserClient.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstLog } from '../util/logFiles.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logPath = process.argv[2] ?? firstLog(cfg.sampleLogsDir);
  const res = await parseLogFile(logPath);

  if (res.aborted) {
    console.warn(
      `WARNING: parsing aborted by a parser error after ${res.linesAfterError} further lines were dropped — ` +
        `results for ${logPath} are INCOMPLETE and must not be trusted as a full parse.`,
    );
  }

  mkdirSync(cfg.outputDir, { recursive: true });
  res.arenaMatches.forEach((m, i) =>
    writeFileSync(join(cfg.outputDir, `arena-${i}.json`), JSON.stringify(summarizeMatch(m), null, 2)),
  );

  console.log(
    `Parsed ${res.arenaMatches.length} arena matches, ${res.shuffleRounds.length} shuffle rounds ` +
      `(malformed=${res.malformed}, errors=${res.errors}) from ${logPath}`,
  );
  console.log(`Wrote ${res.arenaMatches.length} summaries to ${cfg.outputDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
