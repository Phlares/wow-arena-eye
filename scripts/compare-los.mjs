// Agreement check: ray-sampled void-ness LoS (current shipping) vs the fitted vector LoS.
//   npm run compare-los
// Samples deterministic point pairs from WALKABLE cells of each grid and compares verdicts.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { losBetween } from '../src/metrics/lineOfSight.js';
import { losBlockedVector } from '../src/metrics/losVector.js';

const PAIRS_PER_ZONE = 3000;

// seeded LCG so runs are reproducible
let seed = 1234567;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

const occDir = fileURLToPath(new URL('../src/metadata/occupancy/', import.meta.url));
const fitDir = fileURLToPath(new URL('../src/metadata/occluders/', import.meta.url));

let totals = { agree: 0, vectorOnly: 0, gridOnly: 0, all: 0 };
for (const f of readdirSync(occDir).filter((n) => n.endsWith('.json'))) {
  const grid = JSON.parse(readFileSync(join(occDir, f), 'utf8'));
  const occ = JSON.parse(readFileSync(join(fitDir, f), 'utf8'));
  const { bounds, cellSize, cols } = grid;
  const walkable = [];
  grid.voidness.forEach((v, i) => { if (v < 0.5) walkable.push(i); });
  const pointIn = (i) => ({
    x: bounds.minX + ((i % cols) + 0.5) * cellSize,
    y: bounds.minY + (Math.floor(i / cols) + 0.5) * cellSize,
  });
  let agree = 0, vectorOnly = 0, gridOnly = 0;
  for (let k = 0; k < PAIRS_PER_ZONE; k++) {
    const a = pointIn(walkable[Math.floor(rand() * walkable.length)]);
    const b = pointIn(walkable[Math.floor(rand() * walkable.length)]);
    const g = losBetween(grid, a, b).result === 'blocked';
    const v = losBlockedVector(occ, a, b);
    if (g === v) agree++;
    else if (v) vectorOnly++;
    else gridOnly++;
  }
  totals.agree += agree; totals.vectorOnly += vectorOnly; totals.gridOnly += gridOnly; totals.all += PAIRS_PER_ZONE;
  console.log(
    `${grid.zoneId}: agree ${(100 * agree / PAIRS_PER_ZONE).toFixed(1)}%` +
    ` · vector-only-blocked ${(100 * vectorOnly / PAIRS_PER_ZONE).toFixed(1)}%` +
    ` · grid-only-blocked ${(100 * gridOnly / PAIRS_PER_ZONE).toFixed(1)}%` +
    `${grid.isZAxisMap ? ' [z]' : ''}`,
  );
}
console.log(`TOTAL: agree ${(100 * totals.agree / totals.all).toFixed(1)}% over ${totals.all} pairs`);
