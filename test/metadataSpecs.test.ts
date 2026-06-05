import { describe, it, expect } from 'vitest';
import { specLabel, compLabel } from '../src/metadata/specs.js';

describe('specLabel', () => {
  it('resolves a known spec id to a readable short label', () => {
    expect(specLabel('265')).toBe('Affliction');     // specName wins as the short form
    expect(specLabel('105')).toBe('Restoration');
  });
  it('falls back to the raw id for an unknown spec', () => {
    expect(specLabel('999999')).toBe('999999');
  });
});

describe('compLabel', () => {
  it('joins the per-spec labels of a sorted _ -joined comp signature', () => {
    // 105=Druid_Restoration, 265=Warlock_Affliction, 256=Priest_Discipline
    expect(compLabel('105_256_265')).toBe('Restoration·Discipline·Affliction');
  });
  it('returns an empty string for an empty signature', () => {
    expect(compLabel('')).toBe('');
  });
});
