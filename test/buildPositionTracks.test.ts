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

describe('buildPositionTracks — passive-target gap-filling', () => {
  it('injects an inferred sample at the attacker position when a melee swing hits a target', () => {
    // Target T has no observed samples of its own; attacker A melee-swings it.
    // SWING_DAMAGE carries the ATTACKER's actor position (advancedActorPositionX/Y).
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
    const tr = buildPositionTracks(units, match).get('T')!;
    expect(tr.samples).toHaveLength(1);
    expect(tr.samples[0]).toMatchObject({ tSec: 2, x: 50, y: 50, inferred: true });
    expect(units[0].track).toHaveLength(0);
  });

  it('keeps samples sorted after injecting inferred ones', () => {
    const units: UnitMetrics[] = [
      { ...unit({}), unitId: 'T', team: 'enemy', track: [{ tSec: 0, x: 1, y: 1 }, { tSec: 4, x: 2, y: 2 }] } as unknown as UnitMetrics,
      { ...unit({}), unitId: 'A', team: 'friendly', track: [] } as unknown as UnitMetrics,
    ];
    const match = { events: [{ timestamp: 0 }, { event: 'SWING_DAMAGE_LANDED', srcUnitId: 'A', destUnitId: 'T', advancedActorPositionX: 9, advancedActorPositionY: 9, amount: 5, timestamp: 2000 }] };
    const tr = buildPositionTracks(units, match).get('T')!;
    expect(tr.samples.map((s) => s.tSec)).toEqual([0, 2, 4]); // inferred (tSec 2) slotted in order
    expect(tr.samples[1].inferred).toBe(true);
  });

  it('skips swings with no position or an unknown target (no throw, no phantom track)', () => {
    const units: UnitMetrics[] = [unit({ unitId: 'A', team: 'friendly', track: [{ tSec: 0, x: 1, y: 1 }] })];
    const match = {
      events: [
        { timestamp: 0 },
        { event: 'SWING_DAMAGE', srcUnitId: 'A', destUnitId: 'A', amount: 1 },              // no position → skipped
        { event: 'SWING_DAMAGE', srcUnitId: 'A', destUnitId: 'GHOST', advancedActorPositionX: 5, advancedActorPositionY: 5, timestamp: 2000 }, // unknown target → skipped
      ],
    };
    const tracks = buildPositionTracks(units, match);
    expect(tracks.has('GHOST')).toBe(false);          // no phantom track created
    expect(tracks.get('A')!.samples).toHaveLength(1); // unchanged (no inferred sample added to A)
  });
});
