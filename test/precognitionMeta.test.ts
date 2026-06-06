import { describe, it, expect } from 'vitest';
import { PRECOGNITION_AURA_ID, PRECOGNITION_MAX_INSTANCE_SEC } from '../src/metadata/precognition.js';

describe('precognition metadata', () => {
  it('exposes the verified aura id and a sane instance cap', () => {
    expect(PRECOGNITION_AURA_ID).toBe(377362);            // verified on real 12.0.5 logs (self-BUFF)
    expect(PRECOGNITION_MAX_INSTANCE_SEC).toBeGreaterThanOrEqual(4); // real buff ~4s
    expect(PRECOGNITION_MAX_INSTANCE_SEC).toBeLessThanOrEqual(15);
  });
});
