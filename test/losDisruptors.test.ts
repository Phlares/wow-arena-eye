import { describe, it, expect } from 'vitest';
import { collectLosDisruptors } from '../src/metrics/losDisruptors.js';

describe('collectLosDisruptors', () => {
  it('records a modeled smoke bomb (pos+radius) and a flagged ice wall', () => {
    const match = {
      units: { R: { type: 1, reaction: 'Hostile' }, M: { type: 1, reaction: 'Friendly' } },
      events: [
        { timestamp: 1000 }, // matchStart
        { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'R', spellId: '76577', advancedActorPositionX: 50, advancedActorPositionY: 60, timestamp: 5000 },
        { event: 'SPELL_CAST_SUCCESS', srcUnitId: 'M', spellId: '352278', advancedActorPositionX: 10, advancedActorPositionY: 20, timestamp: 8000 },
      ],
    };
    const ds = collectLosDisruptors(match);
    const smoke = ds.find((d) => d.kind === 'smoke-bomb')!;
    expect(smoke).toMatchObject({ casterId: 'R', team: 'enemy', startSec: 4, modeled: true, radius: 8 });
    expect(smoke.pos).toEqual({ x: 50, y: 60 });
    expect(smoke.endSec).toBe(9); // 5000ms cast + 5000ms duration → tSec 9
    const ice = ds.find((d) => d.kind === 'ice-wall')!;
    expect(ice).toMatchObject({ casterId: 'M', team: 'friendly', modeled: false });
  });
});
