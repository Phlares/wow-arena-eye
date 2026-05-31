import { describe, it, expect } from 'vitest';
import { computeCoordination } from '../src/metrics/coordination.js';

const dmg = (src: string, dst: string, amt: number, ms: number) => ({
  logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: src, destUnitId: dst, amount: amt, timestamp: ms,
});

const units = {
  A1: { name: 'Ally1', type: 1, reaction: 1, spec: '0' },
  A2: { name: 'Ally2', type: 1, reaction: 1, spec: '0' },
  H:  { name: 'EnemyHealer', type: 1, reaction: 2, spec: '105' },
  E:  { name: 'EnemyDps', type: 1, reaction: 2, spec: '0' },
};

// Both allies focus E for the first 4s (aligned), then A1 pokes the healer.
const events: ReturnType<typeof dmg>[] = [];
for (let ms = 0; ms < 4000; ms += 500) { events.push(dmg('A1', 'E', 800, ms)); events.push(dmg('A2', 'E', 800, ms)); }
events.push(dmg('A1', 'H', 200, 9000));

describe('computeCoordination', () => {
  const teams = computeCoordination({ units, events }, ['105']);
  const friendly = teams.find((t) => t.team === 'friendly')!.summary;

  it('ranks target priority and names the top focus target', () => {
    expect(friendly.topFocusTarget).toBe('EnemyDps');
    expect(friendly.targetPriority[0].name).toBe('EnemyDps');
  });
  it('measures healer pressure on the enemy team', () => {
    expect(friendly.healerPressureDamage).toBe(200);
  });
  it('reports per-attacker focus with sane (small) swap counts', () => {
    expect(friendly.attackerFocus.length).toBeGreaterThanOrEqual(2);
    // A2 only ever hit E -> zero swaps; nobody churns
    expect(friendly.swaps).toBeLessThanOrEqual(2);
    const a2 = friendly.attackerFocus.find((a) => a.attacker === 'A2')!;
    expect(a2.swaps).toBe(0);
    expect(a2.topTarget).toBe('EnemyDps');
    expect(a2.engagedSec).toBeGreaterThan(0);
  });
  it('detects alignment while both allies focus the same target', () => {
    expect(friendly.alignmentFraction).toBeGreaterThan(0);
    expect(friendly.alignmentFraction).toBeLessThanOrEqual(1);
    expect(friendly.alignedTimeSec).toBeGreaterThan(0);
  });
  it('returns both teams', () => {
    expect(teams.map((t) => t.team).sort()).toEqual(['enemy', 'friendly']);
  });
});
