import { describe, it, expect } from 'vitest';
import { className, specsOfClass } from '../src/metadata/specs.js';

describe('class helpers', () => {
  it('className resolves a spec id to its class', () => {
    expect(className('265')).toBe('Warlock');
    expect(className('999999')).toBe('');
  });
  it('specsOfClass returns all spec ids of a class', () => {
    const wl = specsOfClass('Warlock');
    expect(wl).toContain('265'); // Affliction
    expect(wl).toContain('266'); // Demonology
    expect(wl).toContain('267'); // Destruction
    expect(specsOfClass('Nonexistent')).toEqual([]);
  });
});
