import { describe, it, expect } from 'vitest';
import { computeOffensiveWindows } from '../src/metrics/offensiveWindows.js';
import type { AuraState, Interval } from '../src/metrics/auraState.js';
import type { UnitMetrics } from '../src/metrics/types.js';

// Avatar (107574) is an OFFENSIVE_SPELL_ID. Build a fake AuraState exposing it as a self-buff.
function fakeAuras(bySrc: Record<string, Interval[]>): AuraState {
  return {
    activeOn: () => [],
    intervalsOn: () => [],
    intervalsBy: (id: string) => (bySrc[id] ?? []).map((iv) => ({ ...iv })),
  };
}

function player(unitId: string, team: 'friendly' | 'enemy', spec: string): UnitMetrics {
  return { unitId, name: unitId, kind: 'player', team, spec, cdUsage: [] } as unknown as UnitMetrics;
}

// eventTimeMs reads e?.timestamp directly (not logLine.timestamp) — use { timestamp: 0 } so matchStartMs returns 0.
const match = { units: { E1: { name: 'Enemy', type: '1', reaction: 'Hostile', spec: '71' } }, events: [{ timestamp: 0 }] };

describe('computeOffensiveWindows', () => {
  it('opens a window from an offensive self-buff aura', () => {
    const auras = fakeAuras({ E1: [{ srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 10_000, end: 30_000 }] });
    const windows = computeOffensiveWindows(match, [player('E1', 'enemy', '71')], auras, new Map());
    expect(windows).toHaveLength(1);
    expect(windows[0].attackingTeam).toBe('enemy');
    expect(windows[0].defendingTeam).toBe('friendly');
    expect(windows[0].openedBy[0]).toMatchObject({ spellId: 107574, unitId: 'E1' });
  });

  it('merges two overlapping offensive CDs into one window', () => {
    const auras = fakeAuras({ E1: [
      { srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 10_000, end: 30_000 },
      { srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 25_000, end: 40_000 },
    ] });
    const windows = computeOffensiveWindows(match, [player('E1', 'enemy', '71')], auras, new Map());
    expect(windows).toHaveLength(1);
    expect(windows[0].openedBy).toHaveLength(2);
    expect(windows[0].endSec).toBe(40);
  });

  it('ignores non-offensive auras', () => {
    const auras = fakeAuras({ E1: [{ srcId: 'E1', destId: 'E1', spellId: 871, name: 'Shield Wall', start: 10_000, end: 18_000 }] });
    expect(computeOffensiveWindows(match, [player('E1', 'enemy', '71')], auras, new Map())).toHaveLength(0);
  });

  // Pet-summon burst (Infernal 1122, curated windowSec 30) leaves no aura — the band must open
  // from the summon cast, same as the GO tracks do.
  it('opens a window from a pet-summon cast that leaves no aura', () => {
    const casts = new Map([['E1', [{ spellId: 1122, name: 'Summon Infernal', ms: 10_000 }]]]);
    const windows = computeOffensiveWindows(match, [player('E1', 'enemy', '265')], fakeAuras({}), casts);
    expect(windows).toHaveLength(1);
    expect(windows[0].startSec).toBe(10);
    expect(windows[0].endSec).toBe(40);
    expect(windows[0].openedBy[0]).toMatchObject({ spellId: 1122, unitId: 'E1', spellName: 'Summon Infernal' });
  });

  // spec 71 (Arms Warrior) + Avatar (107574); spec 63 (Fire Mage) + Combustion (190319)
  // Both resolve to category 'offensive' via bySpec.
  it('merges overlapping offensive CDs from two same-team players into one window', () => {
    const auras = fakeAuras({
      E1: [{ srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 10_000, end: 30_000 }],
      E2: [{ srcId: 'E2', destId: 'E2', spellId: 190319, name: 'Combustion', start: 15_000, end: 35_000 }],
    });
    const windows = computeOffensiveWindows(
      match,
      [player('E1', 'enemy', '71'), player('E2', 'enemy', '63')],
      auras,
      new Map(),
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].openedBy).toHaveLength(2);
    expect(windows[0].startSec).toBe(10);
    expect(windows[0].endSec).toBe(35);
  });

  it('keeps non-overlapping offensive CDs as separate windows', () => {
    const auras = fakeAuras({
      E1: [
        { srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 10_000, end: 30_000 },
        { srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 50_000, end: 60_000 },
      ],
    });
    const windows = computeOffensiveWindows(match, [player('E1', 'enemy', '71')], auras, new Map());
    expect(windows).toHaveLength(2);
    expect(windows.map((w) => w.startSec).sort((a, b) => a - b)).toEqual([10, 50]);
  });

  // spec 71 (Arms Warrior) + Avatar (107574); spec 261 (Subtlety Rogue) + Shadow Blades (121471)
  // Both resolve to category 'offensive' via bySpec.
  it('sums defending-team damage taken within the window', () => {
    const auras = fakeAuras({ E1: [{ srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 10_000, end: 30_000 }] });
    const m = {
      units: {
        E1: { name: 'Enemy', type: '1', reaction: 'Hostile', spec: '71' },
        F1: { name: 'Me', type: '1', reaction: 'Friendly', spec: '265' },
      },
      events: [
        { timestamp: 0 },
        { event: 'SPELL_DAMAGE', srcUnitId: 'E1', destUnitId: 'F1', amount: 5000, timestamp: 15000 },
        { event: 'SPELL_DAMAGE', srcUnitId: 'E1', destUnitId: 'F1', amount: 3000, timestamp: 40000 }, // outside window
      ],
    };
    const units = [player('E1', 'enemy', '71'), player('F1', 'friendly', '265')];
    const windows = computeOffensiveWindows(m, units, auras, new Map());
    expect(windows[0].teamDamageTaken).toBe(5000);
    expect(windows[0].damageByTarget[0]).toMatchObject({ unitId: 'F1', name: 'Me', damage: 5000 });
  });

  it('detects offensive windows for both teams (symmetric)', () => {
    const auras = fakeAuras({
      E1: [{ srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 10_000, end: 30_000 }],
      F1: [{ srcId: 'F1', destId: 'F1', spellId: 121471, name: 'Shadow Blades', start: 12_000, end: 28_000 }],
    });
    const windows = computeOffensiveWindows(
      match,
      [player('E1', 'enemy', '71'), player('F1', 'friendly', '261')],
      auras,
      new Map(),
    );
    expect(windows).toHaveLength(2);
    const teams = windows.map((w) => w.attackingTeam).sort();
    expect(teams).toEqual(['enemy', 'friendly']);
    const enemyW = windows.find((w) => w.attackingTeam === 'enemy')!;
    expect(enemyW.defendingTeam).toBe('friendly');
  });

  // Regression for cross-team-interleave double-count bug (Fix 1).
  // Global sort order: E1 Avatar[0,10s], F1 Shadow Blades[5,15s], E2 Avatar[8,20s].
  // The old single-pass merge saw F1 between E1 and E2, causing E2 to fail the
  // same-team adjacency check and produce TWO enemy windows [0,10] + [8,20] (overlapping).
  // The per-team partition fix must yield ONE enemy window [0,20] and ONE friendly window [5,15].
  it('merges same-team windows even when an opposing-team window interleaves them in time', () => {
    const auras = fakeAuras({
      E1: [{ srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 0, end: 10_000 }],
      F1: [{ srcId: 'F1', destId: 'F1', spellId: 121471, name: 'Shadow Blades', start: 5_000, end: 15_000 }],
      E2: [{ srcId: 'E2', destId: 'E2', spellId: 107574, name: 'Avatar', start: 8_000, end: 20_000 }],
    });
    const units = [player('E1', 'enemy', '71'), player('F1', 'friendly', '261'), player('E2', 'enemy', '71')];
    const windows = computeOffensiveWindows(match, units, auras, new Map());
    const enemyWindows = windows.filter((w) => w.attackingTeam === 'enemy');
    expect(enemyWindows).toHaveLength(1);               // E1+E2 merge into one, not two
    expect(enemyWindows[0].startSec).toBe(0);
    expect(enemyWindows[0].endSec).toBe(20);
    expect(enemyWindows[0].openedBy).toHaveLength(2);
    expect(windows.filter((w) => w.attackingTeam === 'friendly')).toHaveLength(1);
  });

  // Regression: an offensive buff applied but never closed leaves an unbounded interval end.
  // The window must be clamped to the match end (here durationInSeconds), not a garbage value.
  it('clamps a window whose offensive aura never closed to the match end', () => {
    const auras = fakeAuras({ E1: [{ srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 10_000, end: 9_000_000_000_000 }] });
    const m = { units: { E1: { name: 'Enemy', type: '1', reaction: 'Hostile', spec: '71' } }, events: [{ timestamp: 0 }], durationInSeconds: 100 };
    const windows = computeOffensiveWindows(m, [player('E1', 'enemy', '71')], auras, new Map());
    expect(windows).toHaveLength(1);
    expect(windows[0].startSec).toBe(10);
    expect(windows[0].endSec).toBe(100); // clamped to match end, not 9_000_000_000
    expect(windows[0].openedBy[0].endSec).toBe(100); // opener interval clamped too
  });

  // attackerOffenseAvailableCount: curated offensive CDs the attacking team has OFF cooldown at
  // window start (observed-cast based — a CD we never saw cast can't be attributed to a loadout).
  it('counts the attacking team offense available at window start', () => {
    const auras = fakeAuras({ E1: [{ srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 60_000, end: 80_000 }] });
    // Deathmark (360194, 120s cd) cast at 5s → still on cooldown at the 60s window start.
    // Kingsbane (385627, 60s cd) first cast at 70s → ready at window start (no earlier cast).
    const casts = new Map([['E1', [
      { spellId: 360194, name: 'Deathmark', ms: 5_000 },
      { spellId: 385627, name: 'Kingsbane', ms: 70_000 },
    ]]]);
    const windows = computeOffensiveWindows(match, [player('E1', 'enemy', '71')], auras, casts);
    expect(windows).toHaveLength(1);
    expect(windows[0].attackerOffenseAvailableCount).toBe(1);
  });

  it('records used mitigation and enemy CC on defenders during a window', () => {
    const withCc: AuraState = {
      activeOn: () => [],
      intervalsBy: (id: string) => (id === 'E1' ? [{ srcId: 'E1', destId: 'E1', spellId: 107574, name: 'Avatar', start: 10_000, end: 30_000 }] : []),
      intervalsOn: (id: string) => (id === 'F1' ? [{ srcId: 'E1', destId: 'F1', spellId: 853, name: 'Hammer of Justice', start: 12_000, end: 15_000 }] : []),
    };
    const m = {
      units: {
        E1: { name: 'Enemy', type: '1', reaction: 'Hostile', spec: '71' },
        F1: { name: 'Me', type: '1', reaction: 'Friendly', spec: '265' },
      },
      events: [{ timestamp: 0 }],
    };
    const units = [player('E1', 'enemy', '71'), player('F1', 'friendly', '265')];
    // F1 casts Unending Resolve (104773, Affliction defensive) at 13s — inside the window
    const casts = new Map([['F1', [{ spellId: 104773, name: 'Unending Resolve', ms: 13_000 }]]]);
    const windows = computeOffensiveWindows(m, units, withCc, casts);
    const w = windows[0];
    expect(w.mitigation.used.some((x) => x.spellId === 104773 && x.category === 'defensive')).toBe(true);
    expect(w.counterPlay.ccOnDefenders.some((c) => c.spell === 'Hammer of Justice')).toBe(true);
  });
});
