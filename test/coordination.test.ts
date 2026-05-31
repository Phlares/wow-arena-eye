import { describe, it, expect } from 'vitest';
import { computeCoordination } from '../src/metrics/coordination.js';

const match = {
  units: {
    A1: { name: 'Ally1', type: 1, reaction: 1, spec: '0' },
    A2: { name: 'Ally2', type: 1, reaction: 1, spec: '0' },
    H:  { name: 'EnemyHealer', type: 1, reaction: 2, spec: '105' },
    E:  { name: 'EnemyDps', type: 1, reaction: 2, spec: '0' },
  },
  events: [
    { logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'A1', destUnitId: 'E', amount: 500, timestamp: 1000 },
    { logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'A2', destUnitId: 'E', amount: 500, timestamp: 1500 },
    { logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: 'A1', destUnitId: 'H', amount: 200, timestamp: 9000 },
  ],
};

describe('computeCoordination', () => {
  const teams = computeCoordination(match, ['105']);
  const friendly = teams.find((t) => t.team === 'friendly')!.summary;
  it('detects a focus-fire window and top target', () => {
    expect(friendly.focusFireWindows).toBeGreaterThanOrEqual(1);
    expect(friendly.topFocusTarget).toBe('EnemyDps');
  });
  it('measures healer pressure on the enemy team', () => {
    expect(friendly.healerPressureDamage).toBe(200);
  });
  it('returns both teams', () => {
    expect(teams.map((t) => t.team).sort()).toEqual(['enemy', 'friendly']);
  });
});
