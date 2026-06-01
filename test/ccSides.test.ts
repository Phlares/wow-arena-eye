import { describe, it, expect } from 'vitest';
import { buildAuraState } from '../src/metrics/auraState.js';
import { ccReceivedSide, ccDoneSide } from '../src/metrics/ccSides.js';

const units = {
  P: { type: 1, reaction: 1 }, Pet: { type: 3, reaction: 1, ownerId: 'P' },
  E1: { type: 1, reaction: 2 }, E2: { type: 1, reaction: 2 },
  NPC: { type: 2, reaction: 2 },
};
const cc = (src: string, dst: string, start: number, end: number) => [
  { logLine: { event: 'SPELL_AURA_APPLIED' }, srcUnitId: src, destUnitId: dst, spellId: '408', spellName: 'Kidney Shot', timestamp: start },
  { logLine: { event: 'SPELL_AURA_REMOVED' }, srcUnitId: src, destUnitId: dst, spellId: '408', spellName: 'Kidney Shot', timestamp: end },
];

describe('ccSides', () => {
  it('done sums per-target unions across enemies; received unions on you', () => {
    const events = [...cc('P', 'E1', 0, 2000), ...cc('Pet', 'E2', 0, 3000), ...cc('E1', 'P', 0, 4000)];
    const auras = buildAuraState({ events });
    const done = ccDoneSide('P', ['Pet'], units, auras, [], 100000);
    expect(done.hardCcSec).toBe(5);   // 2s on E1 + 3s on E2 (pet rolled to P), summed
    expect(done.count).toBe(2);
    const recv = ccReceivedSide('P', units, auras, [], 100000);
    expect(recv.hardCcSec).toBe(4);   // 4s stun on P from E1
    expect(recv.count).toBe(1);
  });

  it('folds a landed interrupt lockout into done cast-denial', () => {
    const auras = buildAuraState({ events: [] });
    const done = ccDoneSide('P', [], units, auras, [{ ms: 0, spellId: 2139, targetId: 'E1' }], 100000);
    expect(done.castDenialSec).toBe(6); // Counterspell (2139) 6s lockout on enemy E1
  });

  it('ignores CC on/from non-players (player-on-player only)', () => {
    const events = [...cc('NPC', 'P', 0, 5000), ...cc('P', 'NPC', 0, 5000)];
    const auras = buildAuraState({ events });
    expect(ccReceivedSide('P', units, auras, [], 100000).hardCcSec).toBe(0); // CC from NPC ignored
    expect(ccDoneSide('P', [], units, auras, [], 100000).hardCcSec).toBe(0); // CC on NPC ignored
  });
});
