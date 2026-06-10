import { describe, it, expect } from 'vitest';
import { buildPositionTracks } from '../src/metrics/positionTracks.js';
import type { UnitMetrics } from '../src/metrics/types.js';

function unit(over: Partial<UnitMetrics>): UnitMetrics {
  return { unitId: 'U', name: 'U', kind: 'player', team: 'friendly', track: [], spacing: { meleeRangeSec: 0, isolatedSec: 0 }, ...over } as unknown as UnitMetrics;
}

describe('buildPositionTracks', () => {
  it('copies observed tracks and records mobility-cast breaks in tSec', () => {
    const units: UnitMetrics[] = [{ ...unit({}), unitId: 'P', track: [{ tSec: 0, x: 0, y: 0 }, { tSec: 5, x: 9, y: 0 }] } as unknown as UnitMetrics];
    // matchStart = 1000 (first event timestamp). Blink (1953) cast at ms 3000 → tSec (3000-1000)/1000 = 2.
    const match = {
      events: [
        { timestamp: 1000 },
        { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'P', spellId: '1953', timestamp: 3000 },
      ],
    };
    const tracks = buildPositionTracks(units, match);
    const tr = tracks.get('P')!;
    expect(tr.samples).toHaveLength(2);          // observed copied
    expect(tr.breaks).toEqual([2]);              // mobility break at tSec 2
    expect(units[0].track).toHaveLength(2);      // original untouched
  });

  it('ignores non-mobility casts', () => {
    const units: UnitMetrics[] = [{ ...unit({}), unitId: 'P', track: [{ tSec: 0, x: 0, y: 0 }] } as unknown as UnitMetrics];
    const match = { events: [{ timestamp: 0 }, { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'P', spellId: '8936', timestamp: 2000 }] };
    expect(buildPositionTracks(units, match).get('P')!.breaks).toEqual([]);
  });
});

describe('buildPositionTracks — no swing-derived injection', () => {
  // Position attribution happens upstream in perUnit via the advanced infoGUID
  // (advancedActorId): SWING_DAMAGE samples the attacker, SWING_DAMAGE_LANDED samples the
  // target — both exactly. Injecting the attacker's position onto the target here would
  // only add duplicate, ≤melee-range-off samples next to the exact ones.
  it('does not inject samples from swing events; tracks are copied as-is', () => {
    const units: UnitMetrics[] = [
      { ...unit({}), unitId: 'T', team: 'enemy', track: [] } as unknown as UnitMetrics,
      { ...unit({}), unitId: 'A', team: 'friendly', track: [{ tSec: 0, x: 50, y: 50 }] } as unknown as UnitMetrics,
    ];
    const match = {
      events: [
        { timestamp: 0 },
        { event: 'SWING_DAMAGE', srcUnitId: 'A', destUnitId: 'T', advancedActorPositionX: 50, advancedActorPositionY: 50, amount: 1000, timestamp: 2000 },
      ],
    };
    const tracks = buildPositionTracks(units, match);
    expect(tracks.get('T')!.samples).toHaveLength(0); // nothing injected
    expect(tracks.get('A')!.samples).toHaveLength(1); // observed copied untouched
  });
});
