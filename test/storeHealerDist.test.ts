import { describe, it, expect } from 'vitest';
import { extractMetricRows } from '../src/store/metricRows.js';
import { openDb } from '../src/store/store.js';
import { SCORECARD_METRICS } from '../src/scorecard/scorecard.js';
import type { MatchMetrics } from '../src/metrics/types.js';

function metrics(healerDist: number | null): MatchMetrics {
  const cc = { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0, byCategory: [] };
  const imm = { spellsImmuned: [], ccImmuned: 0, ccImmunedByCategory: [] };
  const player = {
    unitId: 'P', name: 'Me', spec: '265', team: 'friendly',
    spacing: { meleeRangeSec: 0, isolatedSec: 0 }, ccReceived: cc, ccDone: cc, immuneReceived: imm, immuneDone: imm,
    avgHealerDistanceYd: healerDist,
  };
  return { teams: [{ team: 'friendly', players: [{ player, pets: [] }], unownedPets: [] }], coordination: [] } as unknown as MatchMetrics;
}

describe('avgHealerDistanceYd persistence', () => {
  it('persists the metric when present', () => {
    const { metrics: rows } = extractMetricRows(metrics(21.4), 'P');
    expect(rows.find((r) => r.scope === 'P' && r.metricId === 'avgHealerDistanceYd')?.value).toBeCloseTo(21.4, 3);
  });
  it('omits the row when null (no healer)', () => {
    const { metrics: rows } = extractMetricRows(metrics(null), 'P');
    expect(rows.find((r) => r.metricId === 'avgHealerDistanceYd')).toBeUndefined();
  });
  it('exposes the column in dataset_export', () => {
    const db = openDb(':memory:');
    const cols = (db.prepare('PRAGMA table_info(dataset_export)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('avgHealerDistanceYd');
  });
  it('is a scorecard metric (descriptive, not rate)', () => {
    const def = SCORECARD_METRICS.find((d) => d.id === 'avgHealerDistanceYd')!;
    expect(def.polarity).toBe('neutral');
    expect(def.rate).toBeUndefined();
  });
});
