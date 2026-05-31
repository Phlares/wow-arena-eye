import { describe, it, expect } from 'vitest';
import { computeFocusTracks } from '../src/metrics/targeting.js';

// Helper: build a SPELL_DAMAGE event
const dmg = (src: string, dst: string, amt: number, ms: number) => ({
  logLine: { event: 'SPELL_DAMAGE' }, srcUnitId: src, destUnitId: dst, amount: amt, timestamp: ms,
});

const units = {
  A: { name: 'Ally', type: 1, reaction: 1 },
  B: { name: 'Ally2', type: 1, reaction: 1 },
  Pet: { name: 'Felhunter', type: 3, reaction: 1, ownerId: 'A' },
  X: { name: 'EnemyX', type: 1, reaction: 2 },
  Y: { name: 'EnemyY', type: 1, reaction: 2 },
};

describe('computeFocusTracks', () => {
  it('tracks dominant target switching from X to Y as one swap', () => {
    // A hits X hard for [0,4000), then Y hard for [6000,10000). 500ms step, 5s window.
    const events = [];
    for (let ms = 0; ms < 4000; ms += 500) events.push(dmg('A', 'X', 1000, ms));
    for (let ms = 6000; ms <= 10000; ms += 500) events.push(dmg('A', 'Y', 1000, ms));
    const ft = computeFocusTracks({ units, events });
    const track = ft.tracks.find((t) => t.attacker === 'A')!;
    expect(track.segments.map((s) => s.target)).toEqual(['X', 'Y']);
    // exactly one X->Y transition in the smoothed ticks
    let swaps = 0, prev: string | null = null;
    for (const c of track.ticks) { if (c !== null && prev !== null && c !== prev) swaps++; if (c !== null) prev = c; }
    expect(swaps).toBe(1);
  });

  it('keeps the incumbent target on an equal-damage tie (no churn)', () => {
    // A commits to X, then a tick where X and Y are dealt equal damage in-window: stays X.
    const events = [
      dmg('A', 'X', 1000, 0), dmg('A', 'X', 1000, 500), dmg('A', 'X', 1000, 1000),
      // at t=1500 add equal Y damage so window has X=3000,Y=... keep feeding equal so they tie
      dmg('A', 'Y', 1000, 1500), dmg('A', 'X', 1000, 1500),
    ];
    const ft = computeFocusTracks({ units, events });
    const track = ft.tracks.find((t) => t.attacker === 'A')!;
    // never switches away from X
    expect(track.ticks.filter((t) => t === 'Y').length).toBe(0);
    expect(track.segments.map((s) => s.target)).toEqual(['X']);
  });

  it('debounces a sub-dwell flicker (no extra swap)', () => {
    // A on X throughout, with a single 500ms blip where Y briefly out-damages X.
    const events = [];
    for (let ms = 0; ms <= 8000; ms += 500) events.push(dmg('A', 'X', 1000, ms));
    // one big Y hit at t=4000 that would win that single tick
    events.push(dmg('A', 'Y', 9000, 4000));
    const ft = computeFocusTracks({ units, events, }, { dwellMs: 1000 });
    const track = ft.tracks.find((t) => t.attacker === 'A')!;
    // flicker shorter than dwell (2 ticks) is held -> Y never appears as a stable segment
    expect(track.segments.map((s) => s.target)).toEqual(['X']);
  });

  it('rolls pet damage onto the owner', () => {
    const events = [dmg('Pet', 'X', 1000, 0), dmg('Pet', 'X', 1000, 500)];
    const ft = computeFocusTracks({ units, events });
    expect(ft.tracks.map((t) => t.attacker)).toEqual(['A']); // pet attributed to owner A
    expect(ft.tracks[0].segments[0].target).toBe('X');
  });

  it('returns empty tracks when there is no damage', () => {
    const ft = computeFocusTracks({ units, events: [] });
    expect(ft.tickCount).toBe(0);
    expect(ft.tracks).toEqual([]);
  });
});
