import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { computeMatchMetrics } from '../src/metrics/metrics.js';
import { parseLogFile } from '../src/parser/parserClient.js';

describe('computeMatchMetrics (synthetic)', () => {
  const mm = computeMatchMetrics({
    playerId: 'P',
    units: { P: { name: 'You', type: 1, reaction: 1 }, E: { name: 'Enemy', type: 1, reaction: 2 } },
    events: [
      { logLine: { event: 'SPELL_CAST_SUCCESS' }, srcUnitId: 'P', spellName: 'Agony', timestamp: 1000 },
      { logLine: { event: 'UNIT_DIED' }, destUnitId: 'E', timestamp: 2000 },
    ],
  });
  it('produces teams, a timeline, focus tracks, and the player id', () => {
    expect(mm.playerUnitId).toBe('P');
    expect(mm.teams.find((t) => t.team === 'friendly')!.players[0].player.unitId).toBe('P');
    expect(mm.teams.find((t) => t.team === 'enemy')!.players[0].player.deaths).toBe(1);
    expect(mm.timeline.length).toBe(2);
    expect(mm.focusTracks).toBeDefined();
    expect(Array.isArray(mm.focusTracks.tracks)).toBe(true);
  });
});

const FIXTURE = 'test-data/fixtures/arena-sample.log';
describe('computeMatchMetrics phases 4-6 (real fixture)', () => {
  it.runIf(existsSync(FIXTURE))('produces damage, coordination, focus tracks, and sane swaps', async () => {
    const { arenaMatches } = await parseLogFile(FIXTURE);
    const mm = computeMatchMetrics(arenaMatches[0]);
    const me = mm.teams.flatMap((t) => t.players).find((p) => p.player.unitId === mm.playerUnitId)!;
    expect(me).toBeTruthy();
    expect(me.combined.damageDone).toBeGreaterThan(0);
    expect(me.player.track.length).toBeGreaterThan(0);

    expect(mm.coordination.length).toBe(2);
    const friendly = mm.coordination.find((c) => c.team === 'friendly')!.summary;
    expect(friendly.targetPriority.length).toBeGreaterThan(0);
    // Sanity: the rebuilt swaps metric is a believable per-match number, not the old 150+/747.
    expect(friendly.swaps).toBeLessThan(60);
    expect(friendly.alignmentFraction).toBeGreaterThanOrEqual(0);
    expect(friendly.alignmentFraction).toBeLessThanOrEqual(1);
    expect(friendly.attackerFocus.length).toBeGreaterThan(0);

    // Retained per-player dominant-target track exists for at least one attacker.
    expect(mm.focusTracks.tracks.some((t) => t.segments.length > 0)).toBe(true);
  });
});
