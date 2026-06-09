import { describe, it, expect } from 'vitest';
import { classColorOfSpec, CLASS_COLORS } from '../src/metadata/classColors.js';

describe('class colors', () => {
  it('maps a spec id to its class color', () => {
    expect(classColorOfSpec('265')).toBe(CLASS_COLORS['Warlock']);     // Affliction → Warlock
    expect(classColorOfSpec('250')).toBe(CLASS_COLORS['Death Knight']); // Blood DK
  });
  it('returns a neutral gray for an unknown spec', () => {
    expect(classColorOfSpec('999999')).toBe('#9aa2b1');
    expect(classColorOfSpec(undefined)).toBe('#9aa2b1');
  });
});
