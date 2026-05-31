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

  if (process.argv.includes('--replay')) {
    const replayDir = join(cfg.outputDir, 'replay');
    mkdirSync(replayDir, { recursive: true });
    views.forEach((v, i) => {
      if (!v.metrics) return;
      const tracks = v.metrics.teams
        .flatMap((t) => [...t.players.flatMap((p) => [p.player, ...p.pets]), ...t.unownedPets])
        .map((u) => ({ unitId: u.unitId, name: u.name, kind: u.kind, team: u.team, track: u.track }));
      const focus = v.metrics.focusTracks.tracks.map((t) => ({ attacker: t.attacker, attackerName: t.attackerName, team: t.team, segments: t.segments }));
      writeFileSync(join(replayDir, `match-${i}.json`), JSON.stringify({ playerUnitId: v.metrics.playerUnitId, timeline: v.metrics.timeline, tracks, focus }));
    });
  }

  console.log(
    `Wrote report: ${resolve(outPath)}  (${views.length} matches, ` +
      `sidecars ${index.loaded}/${index.skipped}, from ${logPath})` +
      (process.argv.includes('--replay') ? ' + replay JSON' : ''),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
