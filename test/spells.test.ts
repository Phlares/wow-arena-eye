import { describe, it, expect } from 'vitest';
import { spellMeta, isInterrupt, ccInfo, isDefensive } from '../src/metadata/spells.js';

describe('spell metadata', () => {
  it('classifies interrupts', () => {
    expect(isInterrupt(1766)).toBe(true);
    expect(isInterrupt(118)).toBe(false);
  });
  it('returns CC info with DR category', () => {
    expect(ccInfo(408)).toEqual({ category: 'stun' });
    expect(ccInfo(1766)).toBeUndefined();
  });
  it('classifies defensives', () => {
    expect(isDefensive(45438)).toBe(true);
    expect(isDefensive(1766)).toBe(false);
  });
  it('returns undefined for unknown ids', () => {
    expect(spellMeta(99999999)).toBeUndefined();
  });
});
