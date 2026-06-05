import { describe, it, expect } from 'vitest';
import { extractMetricRows } from '../src/store/metricRows.js';
import type { MatchMetrics, UnitMetrics } from '../src/metrics/types.js';

// minimal UnitMetrics factory — only the fields the extractor reads matter; others default 0.
function u(over: Partial<UnitMetrics>): UnitMetrics {
  const base: Record<string, unknown> = {
    unitId: 'U', name: 'U', spec: '265', kind: 'player', ownerId: undefined,
    casts: 0, interruptsLanded: 0, interruptsSuffered: 0, dispels: 0, purges: 0, cleanses: 0, spellsteals: 0,
    deaths: 0, deathsWhileCcd: 0, distanceMoved: 0, positionSamples: 0, timeStationarySec: 0,
    defensivesUsed: 0, defensivesIntoBurst: 0, damageDone: 0, healingDone: 0, absorbDone: 0, dps: 0, hps: 0,
    spacing: { meleeRangeSec: 0, isolatedSec: 0 },
    ccDone: { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0 },
    ccReceived: { timeSec: 0, castDenialSec: 0, hardCcSec: 0, rootSec: 0, count: 0 },
    immuneDone: { ccImmuned: 0 }, immuneReceived: { ccImmuned: 0 },
    interruptsLandedBySpell: [],
  };
  return { ...(base as unknown as UnitMetrics), ...over };
}

function metrics(player: UnitMetrics, pets: UnitMetrics[]): MatchMetrics {
  return {
    teams: [{ team: 'friendly', players: [{ player, pets, combined: {} as never }], unownedPets: [] }],
    coordination: [],
  } as unknown as MatchMetrics;
}

describe('extractMetricRows combine', () => {
  it('credits pet interrupts/dispels to the player; keeps deaths player-only', () => {
    const player = u({ unitId: 'P', interruptsLanded: 0, dispels: 1, deaths: 1, damageDone: 1000 });
    const pet = u({ unitId: 'Pet', kind: 'primary-pet', ownerId: 'P', interruptsLanded: 4, dispels: 2, deaths: 1, damageDone: 500 });
    const { metrics: rows } = extractMetricRows(metrics(player, [pet]), 'P');
    const val = (id: string) => rows.find((r) => r.scope === 'P' && r.metricId === id)?.value;
    expect(val('interruptsLanded')).toBe(4);   // 0 + 4 (pet)
    expect(val('dispels')).toBe(3);            // 1 + 2 (pet)
    expect(val('deaths')).toBe(1);             // player-only (NOT 2)
    expect(val('damageDone')).toBe(1000);      // throughput player-only in this increment
  });
  it('sums multiple pets into the combined value', () => {
    const player = u({ unitId: 'P', interruptsLanded: 1 });
    const pet1 = u({ unitId: 'Pet1', kind: 'primary-pet', ownerId: 'P', interruptsLanded: 2 });
    const pet2 = u({ unitId: 'Pet2', kind: 'temp-pet', ownerId: 'P', interruptsLanded: 3 });
    const { metrics: rows } = extractMetricRows(metrics(player, [pet1, pet2]), 'P');
    expect(rows.find((r) => r.scope === 'P' && r.metricId === 'interruptsLanded')?.value).toBe(6);
  });
  it('combine with no pets returns the player value unchanged', () => {
    const player = u({ unitId: 'P', interruptsLanded: 3 });
    const { metrics: rows } = extractMetricRows(metrics(player, []), 'P');
    expect(rows.find((r) => r.scope === 'P' && r.metricId === 'interruptsLanded')?.value).toBe(3);
  });
});
