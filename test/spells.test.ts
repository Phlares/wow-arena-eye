import { describe, it, expect } from 'vitest';
import { spellMeta, isInterrupt, ccInfo, isDefensive, interruptLockoutSec } from '../src/metadata/spells.js';

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
  it('returns interrupt lockout seconds', () => {
    expect(interruptLockoutSec(2139)).toBe(6); // Counterspell
    expect(interruptLockoutSec(47528)).toBe(3); // Mind Freeze
    expect(interruptLockoutSec(118)).toBe(0);   // not an interrupt -> no lockout
  });
  it('covers newer-class interrupt lockouts', () => {
    expect(interruptLockoutSec(116705)).toBe(4); // Spear Hand Strike
    expect(interruptLockoutSec(351338)).toBe(4); // Quell
  });
});
