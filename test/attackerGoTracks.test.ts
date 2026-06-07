import { describe, it, expect } from 'vitest';
import { computeAttackerGoTracks } from '../src/metrics/attackerGoTracks.js';
import type { AuraState, Interval } from '../src/metrics/auraState.js';
import type { UnitMetrics } from '../src/metrics/types.js';

const OFF = 375087; // a real offensive-CD spell id (cooldowns.json offensiveSpellIds)

function auras(map: Record<string, Interval[]>): AuraState {
  return { activeOn: () => [], intervalsOn: () => [], intervalsBy: (id) => map[id] ?? [] };
}
const iv = (id: string, spellId: number, start: number, end: number): Interval => ({ srcId: id, destId: id, spellId, name: 'CD', start, end });

function units(): UnitMetrics[] {
  return [
    { unitId: 'P', name: 'Me', kind: 'player', team: 'friendly', spec: '265' },   // warlock DPS
    { unitId: 'H', name: 'Healz', kind: 'player', team: 'friendly', spec: '256' }, // disc priest ∈ HEALER_SPEC_IDS
  ] as unknown as UnitMetrics[];
}
const match = { events: [{ event: 'X', timestamp: 1000 }, { event: 'Y', timestamp: 61000 }], durationInSeconds: 60 };

describe('computeAttackerGoTracks', () => {
  it('emits a per-attacker track (offensive interval, tSec-relative); excludes healers', () => {
    const tracks = computeAttackerGoTracks(match, units(), auras({ P: [iv('P', OFF, 11000, 21000)], H: [iv('H', OFF, 11000, 21000)] }));
    expect(tracks.map((t) => t.unitId)).toEqual(['P']);                 // healer H excluded
    expect(tracks[0].intervals).toEqual([{ startSec: 10, endSec: 20 }]); // (11000-1000)/1000 .. (21000-1000)/1000
  });
  it('ignores non-offensive auras', () => {
    const tracks = computeAttackerGoTracks(match, units(), auras({ P: [iv('P', 999999, 5000, 9000)] }));
    expect(tracks[0].intervals).toEqual([]);
  });
});
