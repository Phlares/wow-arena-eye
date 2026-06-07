import { describe, it, expect } from 'vitest';
import { ccInfo } from '../src/metadata/spells.js';

// A roster of common player CC that the detail-view CC lane must recognize. Each must resolve to
// a DR category via ccInfo (DB DR table first, curated fallback second). Seduction (6358) was the
// gap surfaced in the detail view — the Succubus charm produced no CC marker.
const KNOWN_CC: [number, string][] = [
  [5782, 'Fear'],
  [6358, 'Seduction'],
  [118, 'Polymorph'],
  [51514, 'Hex'],
  [853, 'Hammer of Justice'],
  [33786, 'Cyclone'],
  [605, 'Mind Control'],
  [339, 'Entangling Roots'],
];

describe('CC metadata coverage', () => {
  it.each(KNOWN_CC)('resolves %i (%s) to a DR category', (id) => {
    const info = ccInfo(id);
    expect(info, `ccInfo(${id}) should resolve`).toBeDefined();
    expect(info!.category).toBeTruthy();
  });
});
