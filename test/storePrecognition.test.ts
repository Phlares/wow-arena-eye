import { describe, it, expect } from 'vitest';
import { extractMetricRows } from '../src/store/metricRows.js';
import { openDb } from '../src/store/store.js';
import type { MatchMetrics } from '../src/metrics/types.js';

// Lean MatchMetrics: extractMetricRows reads only the UNIT_METRICS fields off each player,
// so a partial player carrying just the asserted fields is enough (absent fields → skipped).
function metrics(): MatchMetrics {
  const cc = { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0, byCategory: [] };
  const imm = { spellsImmuned: [], ccImmuned: 0, ccImmunedByCategory: [] };
  const player = {
    unitId: 'P1', name: 'Me', spec: '265', team: 'friendly',
    spacing: { meleeRangeSec: 0, isolatedSec: 0 }, ccReceived: cc, ccDone: cc, immuneReceived: imm, immuneDone: imm,
    precognitionUptimeSec: 6.2, enemyPrecognitionUptimeSec: 12.4, interruptsSuffered: 2,
  };
  return {
    teams: [{ team: 'friendly', players: [{ player, pets: [] }], unownedPets: [] }],
    coordination: [],
  } as unknown as MatchMetrics;
}

describe('precognition persistence', () => {
  it('extractMetricRows emits the two precognition ids + kicks-taken on the player scope', () => {
    const { metrics: rows } = extractMetricRows(metrics(), 'P1');
    const byId = new Map(rows.filter((r) => r.scope === 'P1').map((r) => [r.metricId, r.value]));
    expect(byId.get('precognitionUptimeSec')).toBeCloseTo(6.2, 3);
    expect(byId.get('enemyPrecognitionUptimeSec')).toBeCloseTo(12.4, 3);
    expect(byId.get('interruptsSuffered')).toBe(2);
  });

  it('migrate exposes the new metrics as dataset_export columns', () => {
    const db = openDb(':memory:');
    const cols = (db.prepare('PRAGMA table_info(dataset_export)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('interruptsSuffered');
    expect(cols).toContain('precognitionUptimeSec');
    expect(cols).toContain('enemyPrecognitionUptimeSec');
  });
});
