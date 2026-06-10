// Fit vector wall/pillar polygons from the committed occupancy grids (3-III), applying the
// hand-painted corrections from the occluder editor when present.
//   npm run fit-occluders   ->   src/metadata/occluders/<zoneId>.json
//   corrections: npm run edit-occluders -> paint -> export -> src/metadata/occluderOverrides.json
// Run via tsx (imports live TS).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { fitOccluders } from '../src/metrics/occluderFit.js';
import { applyRemoveRegions, finalizeOccluders } from '../src/metrics/occluderOverrides.js';

const occDir = fileURLToPath(new URL('../src/metadata/occupancy/', import.meta.url));
const outDir = fileURLToPath(new URL('../src/metadata/occluders/', import.meta.url));
const overridesPath = fileURLToPath(new URL('../src/metadata/occluderOverrides.json', import.meta.url));
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// strip a BOM if present - editors/PowerShell often save the exported file with one
const overrides = existsSync(overridesPath)
  ? JSON.parse(readFileSync(overridesPath, 'utf8').replace(/^﻿/, ''))
  : { version: 1, zones: {} };

for (const f of readdirSync(occDir).filter((n) => n.endsWith('.json'))) {
  const rawGrid = JSON.parse(readFileSync(join(occDir, f), 'utf8'));
  const zoneOverrides = overrides.zones?.[rawGrid.zoneId];
  const grid = applyRemoveRegions(rawGrid, zoneOverrides);
  const fitted = finalizeOccluders(fitOccluders(grid), zoneOverrides);
  const verts = (polys) => polys.reduce((n, p) => n + p.length, 0);
  const out = {
    ...fitted,
    source: 'occupancy-fit',
    isZAxisMap: rawGrid.isZAxisMap,
    generated: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(join(outDir, f), JSON.stringify(out) + '\n');
  const extra = [
    zoneOverrides?.remove?.length ? `${zoneOverrides.remove.length} removed region(s)` : '',
    fitted.manual.length ? `${fitted.manual.length} manual occluder(s)` : '',
    fitted.slopes.length ? `${fitted.slopes.length} slope(s)` : '',
  ].filter(Boolean).join(', ');
  console.log(
    `${rawGrid.zoneId}: ${fitted.walls.length} wall loop(s) / ${fitted.pillars.length} pillar(s), ` +
    `${verts(fitted.walls) + verts(fitted.pillars)} vertices` +
    `${extra ? ` · ${extra}` : ''}${rawGrid.isZAxisMap ? ' [z-axis: approximate]' : ''}`,
  );
}
