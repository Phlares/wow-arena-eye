import { describe, it, expect } from 'vitest';
import { harvestPositions } from '../src/metrics/positionHarvest.js';

// Real lines lifted from test-data/fixtures/arena-sample.log (zone 1825, Hook Point).
const START = '5/28/2026 20:09:20.342-4  ARENA_MATCH_START,1825,41,3v3,1';
const END = '5/28/2026 20:11:30.043-4  ARENA_MATCH_END,1,129,2464,2425';
// A player SPELL_CAST_SUCCESS carrying advanced position x=972.96 y=-299.03:
const CAST_PLAYER =
  '5/28/2026 20:09:20.914-4  SPELL_CAST_SUCCESS,Player-1427-0E06AA75,"Thatsutwo-Ragnaros-US",0x10512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,370537,"Stasis",0x40,Player-1427-0E06AA75,0000000000000000,545840,545840,768,2698,2208,2261,0,0,0,273000,273000,10000,972.96,-299.03,0,5.2856,291';
// Same line but a non-player (pet) source GUID:
const CAST_PET = CAST_PLAYER.replace(/Player-1427-0E06AA75/g, 'Pet-0-1427-2222-3333-4444-0000000001');
// A deliberately broken COMBATANT_INFO (too few params) — stands in for the real 11.x
// missing-specId shift; both make logLineToCombatEvent's per-event try/catch drop the
// event without throwing out of the stream.
const BAD_COMBATANT_INFO = '5/28/2026 20:09:20.500-4  COMBATANT_INFO,Player-1427-0E06AA75,0,1,2,3';

describe('harvestPositions', () => {
  it('collects in-match player positions under the active zone', async () => {
    const m = await harvestPositions([START, CAST_PLAYER, END]);
    expect(m.get('1825')).toEqual([{ x: 972.96, y: -299.03 }]);
  });

  it('excludes non-player (pet/NPC) advanced units', async () => {
    const m = await harvestPositions([START, CAST_PET, END]);
    expect(m.get('1825') ?? []).toEqual([]);
  });

  it('gates by the advanced unit, not the event source', async () => {
    // src = creature, but the advanced block (and thus the position) describes the PLAYER
    // (e.g. a creature melee landing on a player). The position is the player's — keep it.
    // .replace with a string only swaps the FIRST occurrence: the source GUID, not the
    // advanced infoGUID later in the line.
    const creatureSrc = CAST_PLAYER.replace('Player-1427-0E06AA75', 'Creature-0-1427-2222-3333-4444-0000000001');
    const m = await harvestPositions([START, creatureSrc, END]);
    expect(m.get('1825')).toEqual([{ x: 972.96, y: -299.03 }]);
  });

  it('excludes positions outside any active match', async () => {
    const m = await harvestPositions([CAST_PLAYER, START, END, CAST_PLAYER]);
    expect(m.get('1825') ?? []).toEqual([]);
  });

  it('does not throw on a malformed COMBATANT_INFO and still collects around it', async () => {
    const m = await harvestPositions([START, BAD_COMBATANT_INFO, CAST_PLAYER, END]);
    expect(m.get('1825')).toEqual([{ x: 972.96, y: -299.03 }]);
  });

  it('closes the collection window on ZONE_CHANGE when ARENA_MATCH_END is missing', async () => {
    // Real logs often omit ARENA_MATCH_END; leaving the arena emits a ZONE_CHANGE to the
    // city. Positions after that ZONE_CHANGE (e.g. casting in the city) must NOT pollute
    // the arena zone.
    const ZONE_CITY = '5/28/2026 20:11:35.000-4  ZONE_CHANGE,2552,"Dornogal",0';
    const m = await harvestPositions([START, CAST_PLAYER, ZONE_CITY, CAST_PLAYER]);
    expect(m.get('1825')).toEqual([{ x: 972.96, y: -299.03 }]); // only the in-arena cast
  });

  it('separates positions from different zones into different keys', async () => {
    const START2 = '5/28/2026 20:20:00.000-4  ARENA_MATCH_START,572,41,3v3,1';
    const m = await harvestPositions([START, CAST_PLAYER, END, START2, CAST_PLAYER, END]);
    expect(m.get('1825')).toEqual([{ x: 972.96, y: -299.03 }]);
    expect(m.get('572')).toEqual([{ x: 972.96, y: -299.03 }]);
  });
});
