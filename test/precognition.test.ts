import { describe, it, expect } from 'vitest';
import { computePrecognition } from '../src/metrics/precognition.js';
import type { AuraState, Interval } from '../src/metrics/auraState.js';
import { PRECOGNITION_AURA_ID } from '../src/metadata/precognition.js';

const iv = (destId: string, start: number, end: number, spellId = PRECOGNITION_AURA_ID): Interval =>
  ({ srcId: destId, destId, spellId, name: 'Precognition', start, end });

// unit.type: 1=player, 3=pet; reaction decides team (friendly vs hostile)
const units = {
  P1: { type: 1, reaction: 'Friendly' },   // recording player
  E1: { type: 1, reaction: 'Hostile' },     // enemy player
  E2: { type: 1, reaction: 'Hostile' },     // enemy player
  EP: { type: 3, reaction: 'Hostile' },     // enemy PET — must be excluded from the enemy sum
} as Record<string, Record<string, unknown>>;

function auras(map: Record<string, Interval[]>): AuraState {
  return { activeOn: () => [], intervalsBy: () => [], intervalsOn: (id) => map[id] ?? [] };
}

describe('computePrecognition', () => {
  it('self = union of own Precognition; enemy = sum over enemy PLAYERS (pets excluded)', () => {
    const a = auras({
      P1: [iv('P1', 1000, 5000)],                       // 4.0s self
      E1: [iv('E1', 0, 2000)],                          // 2.0s
      E2: [iv('E2', 0, 3000), iv('E2', 100, 200, 999)], // 3.0s precog (+ unrelated aura ignored)
      EP: [iv('EP', 0, 9000)],                          // pet — excluded
    });
    const out = computePrecognition(units, a, 100000);
    expect(out.get('P1')!.selfSec).toBeCloseTo(4, 3);
    expect(out.get('P1')!.enemySec).toBeCloseTo(5, 3); // E1 2 + E2 3, EP excluded
  });

  it('clamps an applied-but-never-removed aura to the instance cap', () => {
    const a = auras({ P1: [iv('P1', 1000, Number.MAX_SAFE_INTEGER)] });
    const out = computePrecognition(units, a, 100000);
    expect(out.get('P1')!.selfSec).toBeCloseTo(8, 3); // PRECOGNITION_MAX_INSTANCE_SEC
  });

  it('is 0/0 when there is no Precognition anywhere', () => {
    const out = computePrecognition(units, auras({}), 100000);
    expect(out.get('P1')).toEqual({ selfSec: 0, enemySec: 0 });
  });
});
