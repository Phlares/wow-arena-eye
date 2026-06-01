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

  it('closes an aura early on SPELL_AURA_BROKEN', () => {
    const st = buildAuraState({
      events: [
        { logLine: { event: 'SPELL_AURA_APPLIED' }, destUnitId: 'U', spellId: '5782', spellName: 'Fear', timestamp: 1000 },
        { logLine: { event: 'SPELL_AURA_BROKEN' }, destUnitId: 'U', spellId: '5782', spellName: 'Fear', timestamp: 2500 },
      ],
    });
    const ivs = st.intervalsOn('U');
    expect(ivs).toHaveLength(1);
    expect(ivs[0]).toMatchObject({ spellId: 5782, start: 1000, end: 2500 });
  });

  it('intervalsOn returns an open aura with a sentinel end', () => {
    const st = buildAuraState({
      events: [{ logLine: { event: 'SPELL_AURA_APPLIED' }, destUnitId: 'U', spellId: '339', spellName: 'Entangling Roots', timestamp: 500 }],
    });
    const ivs = st.intervalsOn('U');
    expect(ivs).toHaveLength(1);
    expect(ivs[0].start).toBe(500);
    expect(ivs[0].end).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('captures the caster (srcId) and indexes intervals by source', () => {
    const st = buildAuraState({
      events: [
        { logLine: { event: 'SPELL_AURA_APPLIED' }, srcUnitId: 'Mage', destUnitId: 'Victim', spellId: '118', spellName: 'Polymorph', timestamp: 1000 },
        { logLine: { event: 'SPELL_AURA_REMOVED' }, srcUnitId: 'Mage', destUnitId: 'Victim', spellId: '118', spellName: 'Polymorph', timestamp: 4000 },
      ],
    });
    const on = st.intervalsOn('Victim');
    expect(on).toHaveLength(1);
    expect(on[0]).toMatchObject({ srcId: 'Mage', destId: 'Victim', spellId: 118, start: 1000, end: 4000 });
    const by = st.intervalsBy('Mage');
    expect(by).toHaveLength(1);
    expect(by[0]).toMatchObject({ srcId: 'Mage', destId: 'Victim', spellId: 118 });
    expect(st.intervalsBy('Nobody')).toEqual([]);
  });
});
