import { describe, it, expect } from 'vitest';
import { harvestFile } from '../src/metrics/positionHarvest.js';

// arena-sample.log is a real 12.0.5 match in zone 1825 (Hook Point). The harvester must
// agree with the well-formed-match path: many player positions, all inside Hook Point's
// known world bounds (x ~960-1060, y ~-375..-288).
describe('harvestFile (real 12.0.5 fixture)', () => {
  it('extracts in-bounds player positions for zone 1825', async () => {
    const m = await harvestFile('test-data/fixtures/arena-sample.log');
    const pts = m.get('1825') ?? [];
    expect(pts.length).toBeGreaterThan(500);
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(940);
      expect(p.x).toBeLessThan(1080);
      expect(p.y).toBeGreaterThan(-400);
      expect(p.y).toBeLessThan(-270);
    }
  });
});
