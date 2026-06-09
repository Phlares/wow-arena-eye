import { describe, it, expect } from 'vitest';
import { computeDeathBlows } from '../src/metrics/deathBlows.js';

const nameOf = (id: string): string => (({ E1: 'Foe', E2: 'Foe2' } as Record<string, string>)[id] ?? id);

const dmg = (src: string, dest: string, spell: string, amount: number, ms: number) =>
  ({ event: 'SPELL_DAMAGE', srcUnitId: src, destUnitId: dest, spellName: spell, amount, timestamp: ms });
const died = (victim: string, ms: number) => ({ event: 'UNIT_DIED', destUnitId: victim, timestamp: ms });
const start = { event: 'ARENA_MATCH_START', timestamp: 0 };

describe('computeDeathBlows', () => {
  it('lists the ~5s of damage preceding each death (time-ordered), excluding older hits', () => {
    const events = [
      start,
      dmg('E1', 'P2', 'Chaos Bolt', 100, 2000),  // 8s before death → outside the 5s window
      dmg('E1', 'P2', 'Incinerate', 200, 6000),   // t-4s
      dmg('E2', 'P2', 'Shadow Bolt', 300, 8000),   // t-2s
      dmg('E1', 'P2', 'Chaos Bolt', 400, 9000),    // t-1s
      died('P2', 10000),
    ];
    const blows = computeDeathBlows({ events }, nameOf);
    expect(blows).toHaveLength(1);
    expect(blows[0].victimId).toBe('P2');
    expect(blows[0].tSec).toBe(10);
    expect(blows[0].recent).toEqual([
      { srcName: 'Foe', spell: 'Incinerate', amount: 200, tSec: 6 },
      { srcName: 'Foe2', spell: 'Shadow Bolt', amount: 300, tSec: 8 },
      { srcName: 'Foe', spell: 'Chaos Bolt', amount: 400, tSec: 9 },
    ]);
  });

  it('caps the preceding-damage list at 12 hits (keeps the most recent)', () => {
    const events: unknown[] = [start];
    for (let i = 0; i < 15; i++) events.push(dmg('E1', 'P2', 'Tick', 10, 1000 + i * 100)); // 15 hits in [1000,2400]
    events.push(died('P2', 5000));
    const blows = computeDeathBlows({ events }, nameOf);
    expect(blows[0].recent).toHaveLength(12);
    expect(blows[0].recent[0].tSec).toBe(1.3); // first kept = hit #4 (the latest 12 of 15)
    expect(blows[0].recent[11].tSec).toBe(2.4);
  });
});
