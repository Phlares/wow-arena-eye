import { describe, it, expect } from 'vitest';
import { buildAuraState } from '../src/metrics/auraState.js';

const match = {
  units: { P: { name: 'You' } },
  events: [
    { logLine: { event: 'SPELL_AURA_APPLIED' }, destUnitId: 'P', spellId: 408, spellName: 'Kidney Shot', timestamp: 1000 },
    { logLine: { event: 'SPELL_AURA_REMOVED' }, destUnitId: 'P', spellId: 408, spellName: 'Kidney Shot', timestamp: 5000 },
    { logLine: { event: 'SPELL_AURA_APPLIED' }, destUnitId: 'P', spellId: 118, spellName: 'Polymorph', timestamp: 8000 },
  ],
};

describe('buildAuraState', () => {
  const st = buildAuraState(match);
  it('reports an aura active during its interval', () => {
    expect(st.activeOn('P', 3000).map((a) => a.spellId)).toContain(408);
    expect(st.activeOn('P', 6000).map((a) => a.spellId)).not.toContain(408);
  });
  it('treats an unremoved aura as active through match end', () => {
    expect(st.activeOn('P', 9999).map((a) => a.spellId)).toContain(118);
  });
});
