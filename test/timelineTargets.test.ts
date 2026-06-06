import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../src/metrics/timeline.js';

// eventAccess reads: event, srcUnitId, destUnitId, spellName, extraSpellName, timestamp (all direct fields).
function interruptMatch() {
  return {
    units: { P1: { name: 'Me', type: 1 }, P2: { name: 'Foe', type: 1 } },
    events: [
      { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'P1', destUnitId: 'P1', spellName: 'Shadow Bolt', timestamp: 1000 },
      { event: 'SPELL_INTERRUPT', srcUnitId: 'P1', destUnitId: 'P2', spellName: 'Counterspell', extraSpellName: 'Polymorph', timestamp: 3000 },
    ],
  };
}

describe('buildTimeline interrupt targets', () => {
  it('records the interrupt target so kicks-taken is derivable', () => {
    const tl = buildTimeline(interruptMatch());
    const kick = tl.find((e) => e.kind === 'interrupt')!;
    expect(kick.unitId).toBe('P1');       // interrupter
    expect(kick.targetId).toBe('P2');     // who got kicked
    expect(kick.targetName).toBe('Foe');
    expect(kick.extra).toBe('Polymorph'); // the kicked spell (unchanged)
  });
});
