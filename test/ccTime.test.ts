import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unionSeconds, computeCcDurations } from '../src/metrics/ccTime.js';

const ccCats = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/metadata/ccCategories.json', import.meta.url)), 'utf8'),
) as Record<string, { drCategory: string; name: string }>;
const idOf = (cat: string) => Number(Object.keys(ccCats).find((id) => ccCats[id].drCategory === cat));
const STUN = 408; // Kidney Shot (stun -> hard)
const ROOT = 339; // Entangling Roots (root) — curated fallback if absent from DB
const SILENCE = idOf('silence');
const DISARM = idOf('disarm');

describe('unionSeconds', () => {
  it('sums disjoint windows', () => {
    expect(unionSeconds([{ start: 0, end: 1000 }, { start: 2000, end: 3000 }])).toBe(2);
  });
  it('merges overlapping windows (no double count)', () => {
    expect(unionSeconds([{ start: 0, end: 3000 }, { start: 2000, end: 5000 }])).toBe(5);
  });
  it('returns 0 for empty / zero-length', () => {
    expect(unionSeconds([])).toBe(0);
    expect(unionSeconds([{ start: 1000, end: 1000 }])).toBe(0);
  });
});

describe('computeCcDurations', () => {
  const matchEndMs = 100000;

  it('buckets hard CC, roots, and an interrupt lockout into cast-denial; total is the union', () => {
    const intervals = [
      { spellId: STUN, name: 'Kidney Shot', start: 0, end: 2000 },
      { spellId: ROOT, name: 'Entangling Roots', start: 1000, end: 4000 },
    ];
    const interruptWindows = [{ start: 10000, end: 13000 }];
    const d = computeCcDurations(intervals, interruptWindows, matchEndMs);
    expect(d.hardCcSec).toBe(2);
    expect(d.rootSec).toBe(3);
    expect(d.castDenialSec).toBe(3);
    expect(d.timeControlledSec).toBe(7); // union [0,4]∪[10,13] = 4 + 3
  });

  it('clamps an open-ended aura to matchEndMs', () => {
    const d = computeCcDurations(
      [{ spellId: STUN, name: 'Kidney Shot', start: 99000, end: Number.MAX_SAFE_INTEGER }],
      [], matchEndMs,
    );
    expect(d.hardCcSec).toBe(1);
  });

  it('routes silence into cast-denial', () => {
    const d = computeCcDurations(
      [{ spellId: SILENCE, name: 'Silence', start: 0, end: 4000 }],
      [], matchEndMs,
    );
    expect(d.castDenialSec).toBe(4);
    expect(d.timeControlledSec).toBe(4);
  });

  it('unions across buckets: a silence overlapping a stun is counted once in the total', () => {
    const d = computeCcDurations(
      [
        { spellId: SILENCE, name: 'Silence', start: 0, end: 4000 },
        { spellId: STUN, name: 'Kidney Shot', start: 0, end: 4000 },
      ],
      [], 100000,
    );
    expect(d.castDenialSec).toBe(4);
    expect(d.hardCcSec).toBe(4);
    expect(d.timeControlledSec).toBe(4); // union of identical windows, NOT 8
  });

  it('caps a runaway (unclosed) CC instance at its category max', () => {
    const d = computeCcDurations(
      [{ spellId: STUN, name: 'Kidney Shot', start: 0, end: 200000 }], // never-removed -> would clamp to match end
      [], 1000000,
    );
    expect(d.hardCcSec).toBe(10); // capped at the 10s stun instance max, not 200s
  });

  it('tracks disarm in byCategory only, excluded from the three buckets and total', () => {
    const d = computeCcDurations(
      [{ spellId: DISARM, name: 'Disarm', start: 0, end: 3000 }],
      [], 100000,
    );
    expect(d.byCategory.find((b) => b.category === 'disarm')?.durationSec).toBe(3);
    expect(d.castDenialSec).toBe(0);
    expect(d.hardCcSec).toBe(0);
    expect(d.rootSec).toBe(0);
    expect(d.timeControlledSec).toBe(0);
  });
});
