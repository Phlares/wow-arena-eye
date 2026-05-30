import { loadConfig } from '../config.js';
import { parseLogFile } from '../parser/parserClient.js';
import { firstLog } from '../util/logFiles.js';
import { loadSidecarIndex } from '../sidecar/sidecarIndex.js';
import { projectMatch } from '../view/projectMatch.js';
import { renderReport } from '../view/renderReport.js';
import { computeMatchMetrics } from '../metrics/metrics.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logPath = process.argv[2] ?? firstLog(cfg.sampleLogsDir);

  const res = await parseLogFile(logPath);
  const views = [
    ...res.arenaMatches.map((m) => ({ ...projectMatch(m, 'arena'), metrics: computeMatchMetrics(m) })),
    ...res.shuffleRounds.map((r) => ({ ...projectMatch(r, 'shuffleRound'), metrics: computeMatchMetrics(r) })),
  ];
  const index = loadSidecarIndex(cfg.videoDirs);

  const html = renderReport(views, index, {
    sourceLogPath: logPath,
    aborted: res.aborted,
    linesAfterError: res.linesAfterError,
  });

  mkdirSync(cfg.outputDir, { recursive: true });
  const outPath = join(cfg.outputDir, 'report.html');
  writeFileSync(outPath, html, 'utf8');

  console.log(
    `Wrote report: ${resolve(outPath)}  (${views.length} matches, ` +
      `sidecars ${index.loaded}/${index.skipped}, from ${logPath})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
