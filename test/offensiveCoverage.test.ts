import { describe, it, expect } from 'vitest';
import { isOffensiveCd, offensiveCdMeta } from '../src/metadata/cooldowns.js';
import { loadJson } from '../src/metadata/loadJson.js';

// Current-retail (12.0.x) burst cooldowns across specs that the GO tracks must recognize. Mix of
// vendor-tagged, MiniCC-highlight, and curated-supplement ids — all must resolve via the union.
const KNOWN_BURST: [number, string][] = [
  [1719, 'Recklessness'],
  [360194, 'Deathmark'],
  [51271, 'Pillar of Frost'],
  [191427, 'Metamorphosis'],
  [386997, 'Soul Rot'],
  [442726, 'Malevolence'],
  [288613, 'Trueshot'],
  [190319, 'Combustion'],
  [31884, 'Avenging Wrath'],
  [194223, 'Celestial Alignment'],
  [114050, 'Ascendance (Elemental)'],
  [228260, 'Void Eruption'],
  [137639, 'Storm, Earth, and Fire'],
  [375087, 'Dragonrage'],
];

// The denylist (vendor SpellTag.Offensive ids that are NOT >=30s burst markers) — every entry
// must be excluded from the union, whatever source it came in through.
const DENY = loadJson<Record<string, { name: string; reason: string }>>(
  new URL('../src/metadata/offensiveCds.deny.json', import.meta.url),
);
const DENIED: [number, string][] = Object.entries(DENY).map(([id, v]) => [Number(id), `${v.name} — ${v.reason}`]);

describe('offensive-CD coverage', () => {
  it.each(KNOWN_BURST)('isOffensiveCd(%i) is true (%s)', (id) => {
    expect(isOffensiveCd(id), `${id} should be offensive`).toBe(true);
  });

  it.each(DENIED)('isOffensiveCd(%i) is false — denylisted (%s)', (id) => {
    expect(isOffensiveCd(id), `${id} should be denylisted`).toBe(false);
  });

  it('Shadowstep (the false-positive that motivated the denylist) stays excluded', () => {
    expect(isOffensiveCd(36554)).toBe(false);
  });

  it('every denylist entry carries a human-readable reason', () => {
    for (const [id, v] of Object.entries(DENY)) {
      expect(v.reason, `${id} needs a reason`).toBeTruthy();
    }
  });

  it("on-use damage trinket (Gladiator's Badge) counts as offensive", () => {
    expect(isOffensiveCd(345228)).toBe(true);
    expect(offensiveCdMeta(345228)?.kind).toBe('buff');
  });

  it('every curated pet-summon exposes a window duration (cast path silently skips without one)', () => {
    const curated = loadJson<Record<string, { kind: string; windowSec?: number }>>(
      new URL('../src/metadata/offensiveCds.curated.json', import.meta.url),
    );
    const summons = Object.entries(curated).filter(([, v]) => v.kind === 'pet-summon');
    expect(summons.length).toBeGreaterThan(0);
    for (const [id, v] of summons) expect(v.windowSec, `${id} needs windowSec`).toBeGreaterThan(0);
    expect(offensiveCdMeta(205180)?.kind).toBe('pet-summon'); // Summon Darkglare
  });

  it('drops curated ids that never occur in 12.x logs (verified against the 70GB live corpus)', () => {
    // Sepsis, Nether Portal, Serenity: removed from the game; Dark Soul / Meta cast id: vendor
    // legacy ids that no longer fire — none should claim curated (cooldown/kind) metadata.
    for (const stale of [385408, 267217, 152173, 113860, 113858, 191427]) {
      expect(offensiveCdMeta(stale), `${stale} should not be curated`).toBeUndefined();
    }
  });

  it('returns undefined meta for an unknown spell', () => {
    expect(offensiveCdMeta(999999)).toBeUndefined();
    expect(isOffensiveCd(999999)).toBe(false);
  });
});
