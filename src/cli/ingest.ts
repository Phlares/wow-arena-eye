import { loadConfig } from '../config.js';
import { parseLogFile, summarizeMatch } from '../parser/parserClient.js';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function firstLog(dir: string): string {
  const f = readdirSync(dir)
    .filter((n) => n.startsWith('WoWCombatLog'))
    .sort()[0];
  if (!f) throw new Error(`No WoWCombatLog files in ${dir}`);
  return join(dir, f);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logPath = process.argv[2] ?? firstLog(cfg.sampleLogsDir);
  const res = await parseLogFile(logPath);

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
