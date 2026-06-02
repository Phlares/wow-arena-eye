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
    const windows = computeOffensiveWindows(match, [player('E1', 'enemy', '71')], auras);
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
    const windows = computeOffensiveWindows(match, [player('E1', 'enemy', '71')], auras);
    expect(windows).toHaveLength(1);
    expect(windows[0].openedBy).toHaveLength(2);
    expect(windows[0].endSec).toBe(40);
  });

  it('ignores non-offensive auras', () => {
    const auras = fakeAuras({ E1: [{ srcId: 'E1', destId: 'E1', spellId: 871, name: 'Shield Wall', start: 10_000, end: 18_000 }] });
    expect(computeOffensiveWindows(match, [player('E1', 'enemy', '71')], auras)).toHaveLength(0);
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
    const windows = computeOffensiveWindows(match, [player('E1', 'enemy', '71')], auras);
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
    const windows = computeOffensiveWindows(m, units, auras);
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
    );
    expect(windows).toHaveLength(2);
    const teams = windows.map((w) => w.attackingTeam).sort();
    expect(teams).toEqual(['enemy', 'friendly']);
    const enemyW = windows.find((w) => w.attackingTeam === 'enemy')!;
    expect(enemyW.defendingTeam).toBe('friendly');
  });
});
