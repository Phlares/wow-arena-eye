import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../src/metrics/timeline.js';

// P1 (player) polymorphs P2 (player); pet PET (owner P1) fears P2; CC on a non-player NPC is ignored.
// CC is detected by ccInfo(spellId) alone (mirrors ccSides); auraType is not used.
function ccMatch() {
  return {
    units: { P1: { name: 'Me', type: 1 }, P2: { name: 'Foe', type: 1 }, PET: { name: 'Imp', type: 3, ownerId: 'P1' }, NPC: { name: 'Totem', type: 0 } },
    events: [
      { event: 'SPELL_AURA_APPLIED', srcUnitId: 'P1', destUnitId: 'P2', spellId: 118, spellName: 'Polymorph', timestamp: 2000 },
      { event: 'SPELL_AURA_APPLIED', srcUnitId: 'PET', destUnitId: 'P2', spellId: 5782, spellName: 'Fear', timestamp: 3000 },
      { event: 'SPELL_AURA_APPLIED', srcUnitId: 'P1', destUnitId: 'NPC', spellId: 118, spellName: 'Polymorph', timestamp: 4000 },
    ],
  };
}

describe('buildTimeline cc events', () => {
  it('emits player-on-player CC with target + category; rolls pet to owner; drops NPC targets', () => {
    const cc = buildTimeline(ccMatch()).filter((e) => e.kind === 'cc');
    expect(cc.length).toBe(2); // poly + pet fear; NPC target excluded
    expect(cc[0]).toMatchObject({ unitId: 'P1', targetId: 'P2', extra: 'incapacitate' }); // Polymorph 118
    expect(cc[1]).toMatchObject({ unitId: 'P1', targetId: 'P2', extra: 'disorient' });     // pet Fear 5782 → owner P1
  });
});
