import { describe, it, expect } from 'vitest';
import { buildAuraState } from '../src/metrics/auraState.js';
import { ccReceivedSide, ccDoneSide } from '../src/metrics/ccSides.js';

const units = {
  P: { type: 1, reaction: 1 }, Pet: { type: 3, reaction: 1, ownerId: 'P' },
  E1: { type: 1, reaction: 2 }, E2: { type: 1, reaction: 2 },
  NPC: { type: 2, reaction: 2 },
  EPet: { type: 3, reaction: 2, ownerId: 'E1' },
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

  it('does not credit CC on an enemy pet as CC done on the enemy player', () => {
    const events = [...cc('P', 'EPet', 0, 5000)]; // P stuns enemy E1's pet
    const auras = buildAuraState({ events });
    expect(ccDoneSide('P', [], units, auras, [], 100000).hardCcSec).toBe(0); // pet target not a player
  });

  it('counts interrupting an enemy pet channel as the interrupter cast-denial (rolled to the pet owner)', () => {
    // units: P (team1) interrupts E1's pet EPet (team2). Wind Shear (57994, 3s lockout).
    const u = { ...units, EPet: { type: 3, reaction: 2, ownerId: 'E1' } };
    const auras = buildAuraState({ events: [] });
    // P interrupts E1's pet
    const done = ccDoneSide('P', [], u, auras, [{ ms: 0, spellId: 57994, targetId: 'EPet' }], 100000);
    expect(done.castDenialSec).toBe(3); // kicking the enemy pet's channel counts for P's done
  });

  it('returns empty CC for a non-player subject (pet/NPC recipient or caster excluded)', () => {
    // enemy player E1 CCs the Pet, and the Pet CCs enemy E1
    const events = [...cc('E1', 'Pet', 0, 5000), ...cc('Pet', 'E1', 0, 5000)];
    const auras = buildAuraState({ events });
    expect(ccReceivedSide('Pet', units, auras, [], 100000).timeSec).toBe(0); // CC on a pet is not tracked
    expect(ccDoneSide('Pet', [], units, auras, [], 100000).timeSec).toBe(0); // pet's own ccDone not attributed to the pet
    expect(ccReceivedSide('NPC', units, auras, [], 100000).timeSec).toBe(0);
  });
});
