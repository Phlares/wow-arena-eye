import { describe, it, expect } from 'vitest';
import { computeAttackerGoTracks } from '../src/metrics/attackerGoTracks.js';
import type { AuraState, Interval } from '../src/metrics/auraState.js';
import type { CastEvent } from '../src/metrics/cooldownTimeline.js';
import type { UnitMetrics } from '../src/metrics/types.js';

const OFF = 375087;       // a real offensive-CD spell id (cooldowns.json offensiveSpellIds)
const DARKGLARE = 205180; // curated pet-summon, windowSec 20
const INFERNAL = 1122;    // curated pet-summon, windowSec 30

function auras(map: Record<string, Interval[]>): AuraState {
  return { activeOn: () => [], intervalsOn: () => [], intervalsBy: (id) => map[id] ?? [] };
}
const iv = (id: string, spellId: number, start: number, end: number, name = 'CD'): Interval => ({ srcId: id, destId: id, spellId, name, start, end });
const casts = (map: Record<string, CastEvent[]>): Map<string, CastEvent[]> => new Map(Object.entries(map));

function units(): UnitMetrics[] {
  return [
    { unitId: 'P', name: 'Me', kind: 'player', team: 'friendly', spec: '265' },   // warlock DPS
    { unitId: 'H', name: 'Healz', kind: 'player', team: 'friendly', spec: '256' }, // disc priest ∈ HEALER_SPEC_IDS
  ] as unknown as UnitMetrics[];
}
const match = { events: [{ event: 'X', timestamp: 1000 }, { event: 'Y', timestamp: 61000 }], durationInSeconds: 60 };

describe('computeAttackerGoTracks', () => {
  it('emits a per-attacker track (offensive interval, tSec-relative); excludes healers', () => {
    const tracks = computeAttackerGoTracks(match, units(), auras({ P: [iv('P', OFF, 11000, 21000)], H: [iv('H', OFF, 11000, 21000)] }), casts({}));
    expect(tracks.map((t) => t.unitId)).toEqual(['P']);                              // healer H excluded
    expect(tracks[0].intervals).toEqual([{ startSec: 10, endSec: 20, spell: 'CD' }]); // carries the ability name for hover
  });
  it('ignores non-offensive auras', () => {
    const tracks = computeAttackerGoTracks(match, units(), auras({ P: [iv('P', 999999, 5000, 9000)] }), casts({}));
    expect(tracks[0].intervals).toEqual([]);
  });
  it('emits a fixed window from a pet-summon cast (no aura)', () => {
    const tracks = computeAttackerGoTracks(match, units(), auras({}),
      casts({ P: [{ spellId: INFERNAL, name: 'Summon Infernal', ms: 11000 }], H: [{ spellId: INFERNAL, name: 'Summon Infernal', ms: 11000 }] }));
    expect(tracks.map((t) => t.unitId)).toEqual(['P']); // healer still excluded
    expect(tracks[0].intervals).toEqual([{ startSec: 10, endSec: 40, spell: 'Summon Infernal' }]); // windowSec 30
  });
  it('clamps a pet-summon window to the match end', () => {
    const tracks = computeAttackerGoTracks(match, units(), auras({}),
      casts({ P: [{ spellId: INFERNAL, name: 'Summon Infernal', ms: 51000 }] }));
    expect(tracks[0].intervals).toEqual([{ startSec: 50, endSec: 60, spell: 'Summon Infernal' }]);
  });
  it('skips the cast window when the summon also left an overlapping aura (no double segment)', () => {
    // Darkglare DOES leave a same-id aura in live logs — the aura interval wins, no duplicate.
    const tracks = computeAttackerGoTracks(match, units(),
      auras({ P: [iv('P', DARKGLARE, 11000, 31000, 'Summon Darkglare')] }),
      casts({ P: [{ spellId: DARKGLARE, name: 'Summon Darkglare', ms: 11000 }] }));
    expect(tracks[0].intervals).toEqual([{ startSec: 10, endSec: 30, spell: 'Summon Darkglare' }]);
  });
  it('keeps intervals sorted when cast windows and auras interleave', () => {
    const tracks = computeAttackerGoTracks(match, units(),
      auras({ P: [iv('P', OFF, 31000, 41000)] }),
      casts({ P: [{ spellId: DARKGLARE, name: 'Summon Darkglare', ms: 6000 }] }));
    expect(tracks[0].intervals).toEqual([
      { startSec: 5, endSec: 25, spell: 'Summon Darkglare' }, // windowSec 20
      { startSec: 30, endSec: 40, spell: 'CD' },
    ]);
  });
  it('ignores non-summon casts (buff/debuff CDs stay aura-driven)', () => {
    const tracks = computeAttackerGoTracks(match, units(), auras({}),
      casts({ P: [{ spellId: OFF, name: 'Dragonrage', ms: 11000 }] }));
    expect(tracks[0].intervals).toEqual([]);
  });
});
