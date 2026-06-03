import { describe, it, expect } from 'vitest';
import { collectAnchors, addWindowPositioning } from '../src/metrics/spacing.js';
import type { UnitMetrics, PositionTrack, OffensiveWindow, Sample } from '../src/metrics/types.js';
import type { CastEvent } from '../src/metrics/cooldownTimeline.js';

function player(unitId: string, team: 'friendly' | 'enemy', spec: string): UnitMetrics {
  return { unitId, name: unitId, kind: 'player', team, spec, track: [], spacing: { meleeRangeSec: 0, isolatedSec: 0 } } as unknown as UnitMetrics;
}

// Dense (1s-apart) standing-still track over 0..25s so every tick in the 10–20s window resolves.
const still = (id: string, x: number, y: number): [string, PositionTrack] =>
  [id, { unitId: id, samples: Array.from({ length: 26 }, (_, i): Sample => ({ tSec: i, x, y })), breaks: [] }];

function baseWindow(over: Partial<OffensiveWindow>): OffensiveWindow {
  return {
    attackingTeam: 'enemy', defendingTeam: 'friendly', startSec: 10, endSec: 20,
    openedBy: [], teamDamageTaken: 0,
    damageByTarget: [{ unitId: 'F1', name: 'F1', damage: 5000 }],
    mitigation: { available: [], used: [] }, counterPlay: { ccOnDefenders: [], threatImmuneAuras: [] },
    ...over,
  } as OffensiveWindow;
}

describe('collectAnchors', () => {
  it('records anchor placements at the caster position from the cast event', () => {
    const match = { events: [{ timestamp: 1000 }, { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'F1', spellId: '48018', advancedActorPositionX: 7, advancedActorPositionY: 8, timestamp: 5000 }] };
    const a = collectAnchors(match).get('F1')!;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ unitId: 'F1', spellId: 48018, x: 7, y: 8, ms: 5000 });
  });
});

describe('addWindowPositioning', () => {
  // Window 10–20s. matchStart=1000 → window start in ms = 11_000.
  // Primary target F1 at (0,0). Attacker E1 at (3,0) → threat 3. Healer F2 (spec 65) at (10,0). Spread = 10.
  const tracks = new Map<string, PositionTrack>([
    still('F1', 0, 0),
    still('F2', 10, 0),
    still('E1', 3, 0),
  ]);
  const units = [player('F1', 'friendly', '265'), player('F2', 'friendly', '65'), player('E1', 'enemy', '71')];

  it('fills threat / healer / spread distances for the primary target', () => {
    const out = addWindowPositioning([baseWindow({})], tracks, units, { events: [{ timestamp: 1000 }] }, new Map());
    const pos = out[0].positioning!;
    expect(pos.primaryTargetId).toBe('F1');
    expect(pos.threatDistanceStartYd).toBeCloseTo(3);
    expect(pos.threatDistanceMinYd).toBeCloseTo(3);
    expect(pos.nearestHealerYd).toBeCloseTo(10);
    expect(pos.teamSpreadYd).toBeCloseTo(10);
    expect(pos.escape).toBeUndefined();
  });

  it('reports escape when an anchor was placed, with availability from the return-spell cooldown', () => {
    const match = { events: [{ timestamp: 1000 }, { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'F1', spellId: '48018', advancedActorPositionX: 0, advancedActorPositionY: 0, timestamp: 5000 }] };
    // Teleport (48020) last cast at ms 1000 → at window start (11_000), 10_000ms < 30_000 CD → NOT available.
    const casts = new Map<string, CastEvent[]>([['F1', [{ spellId: 48020, name: 'Demonic Circle: Teleport', ms: 1000 }]]]);
    const out = addWindowPositioning([baseWindow({})], tracks, units, match, casts);
    const esc = out[0].positioning!.escape!;
    expect(esc.anchorPlaced).toBe(true);
    expect(esc.anchorDistanceYd).toBeCloseTo(0);
    expect(esc.escapeAvailable).toBe(false);
  });

  it('omits positioning when the window has no damage target', () => {
    const out = addWindowPositioning([baseWindow({ damageByTarget: [] })], tracks, units, { events: [{ timestamp: 1000 }] }, new Map());
    expect(out[0].positioning).toBeUndefined();
  });
});
