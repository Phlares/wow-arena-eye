// Fit vector wall/pillar polygons from the committed occupancy grids (3-III).
//   npm run fit-occluders   ->   src/metadata/occluders/<zoneId>.json
// Run via tsx (imports live TS).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { fitOccluders } from '../src/metrics/occluderFit.js';

const occDir = fileURLToPath(new URL('../src/metadata/occupancy/', import.meta.url));
const outDir = fileURLToPath(new URL('../src/metadata/occluders/', import.meta.url));
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

for (const f of readdirSync(occDir).filter((n) => n.endsWith('.json'))) {
  const grid = JSON.parse(readFileSync(join(occDir, f), 'utf8'));
  const fitted = fitOccluders(grid);
  const verts = (polys) => polys.reduce((n, p) => n + p.length, 0);
  const out = {
    ...fitted,
    source: 'occupancy-fit',
    isZAxisMap: grid.isZAxisMap,
    generated: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(join(outDir, f), JSON.stringify(out) + '\n');
  console.log(
    `${grid.zoneId}: ${fitted.walls.length} wall loop(s) / ${fitted.pillars.length} pillar(s), ` +
    `${verts(fitted.walls) + verts(fitted.pillars)} vertices${grid.isZAxisMap ? ' [z-axis: approximate]' : ''}`,
  );
}
