import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../src/metrics/timeline.js';

describe('buildTimeline', () => {
  const tl = buildTimeline({
    units: { P: { name: 'You' }, E: { name: 'Enemy' } },
    events: [
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Agony', timestamp: 1000 },
      { logLine: { event: 'SPELL_INTERRUPT' }, srcUnitId: 'P', destUnitId: 'E', spellName: 'Spell Lock', extraSpellName: 'Fear', timestamp: 3000 },
      { logLine: { event: 'UNIT_DIED' }, destUnitId: 'E', timestamp: 5000 },
      { logLine: { event: 'SPELL_PERIODIC_DAMAGE' }, srcUnitId: 'P', spellName: 'Agony', timestamp: 1500 },
    ],
  });

  it('includes only interesting kinds, sorted by tSec, with labels', () => {
    expect(tl.map((e) => e.kind)).toEqual(['cast', 'interrupt', 'death']);
    expect(tl[0]).toMatchObject({ tSec: 0, unitName: 'You', kind: 'cast', spell: 'Agony' });
    expect(tl[1]).toMatchObject({ tSec: 2, kind: 'interrupt', spell: 'Spell Lock', extra: 'Fear' });
    expect(tl[2]).toMatchObject({ tSec: 4, unitName: 'Enemy', kind: 'death' });
  });
});
