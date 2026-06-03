import { describe, it, expect } from 'vitest';
import { disruptorOf, DISRUPTOR_ABILITIES } from '../src/metadata/losDisruptorAbilities.js';

describe('LoS disruptor abilities', () => {
  it('classifies each disruptor with its kind + modeled flag', () => {
    expect(DISRUPTOR_ABILITIES.size).toBeGreaterThanOrEqual(3);
    const smoke = [...DISRUPTOR_ABILITIES.values()].find((d) => d.kind === 'smoke-bomb');
    expect(smoke?.modeled).toBe(true);   // smoke bomb is geometrically modeled
    expect(smoke?.radius).toBeGreaterThan(0);
    const ice = [...DISRUPTOR_ABILITIES.values()].find((d) => d.kind === 'ice-wall');
    expect(ice?.modeled).toBe(false);    // ice wall is flag-only
    expect(disruptorOf(999999)).toBeUndefined();
  });
});
