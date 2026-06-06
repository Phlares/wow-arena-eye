import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { loadMatchDetail, buildRangeSeries } from '../src/viewer/queries.js';
import type { MatchMetrics } from '../src/metrics/types.js';

// player P at (0,0); top-damage enemy E at (10,0); E2 is low-damage (so threat = E).
const metrics = {
  playerUnitId: 'P',
  teams: [
    { team: 'friendly', players: [{ player: { unitId: 'P', damageDone: 0 } }], unownedPets: [] },
    { team: 'enemy', players: [{ player: { unitId: 'E', damageDone: 999 } }, { player: { unitId: 'E2', damageDone: 1 } }], unownedPets: [] },
  ],
  timeline: [], offensiveWindows: [], losDisruptors: [], coordination: [], distanceBands: [],
  lineOfSight: { zoneId: '1825', resolved: true, approximate: false }, focusTracks: { stepMs: 0, tickCount: 0, startMs: 0, tracks: [] },
  positionTracks: [
    { unitId: 'P', samples: [{ tSec: 0, x: 0, y: 0 }, { tSec: 1, x: 0, y: 0 }], breaks: [] },
    { unitId: 'E', samples: [{ tSec: 0, x: 10, y: 0 }, { tSec: 1, x: 10, y: 0 }], breaks: [] },
  ],
} as unknown as MatchMetrics;

function seedDetail(db: InstanceType<typeof DatabaseSync>, id: string, m: MatchMetrics) {
  db.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,result,player_unit_id,player_name) VALUES (?,?,?,?,?,?,?)`)
    .run(id, 1000, '3v3', '1825', 'win', 'P', 'Me');
  db.prepare('INSERT INTO match_detail (match_id,metrics_json) VALUES (?,?)').run(id, JSON.stringify(m));
}

describe('loadMatchDetail + buildRangeSeries', () => {
  it('round-trips the metrics and ranges player to the top-damage enemy', () => {
    const db = new DatabaseSync(':memory:'); migrate(db);
    seedDetail(db, 'M1', metrics);
    const detail = loadMatchDetail(db, 'M1')!;
    expect(detail.timeline).toEqual([]);
    const rs = buildRangeSeries(detail);
    expect(rs[0]).toMatchObject({ tSec: 0, dist: 10 }); // distance P(0,0) to E(10,0)
  });
  it('returns null when there is no detail row', () => {
    const db = new DatabaseSync(':memory:'); migrate(db);
    expect(loadMatchDetail(db, 'nope')).toBeNull();
  });
});
