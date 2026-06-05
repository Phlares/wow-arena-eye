import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { openDb, upsertMatch } from '../src/store/store.js';
import type { MatchMetrics } from '../src/metrics/types.js';

const emptyMetrics = { teams: [], coordination: [] } as unknown as MatchMetrics;

describe('upsertMatch player_cr + build_version', () => {
  it('stores the recording player personalRating as player_cr and the build version', () => {
    const db: InstanceType<typeof DatabaseSync> = openDb(':memory:');
    const raw = {
      id: 'M1', startInfo: { timestamp: 100, bracket: '3v3', zoneId: '1825' }, endInfo: { team0MMR: 2110, team1MMR: 2100 },
      playerId: 'P-1', playerTeamId: '0', winningTeamId: '0',
      units: { 'P-1': { info: { teamId: '0', personalRating: 1834 } } },
    };
    upsertMatch(db, raw, emptyMetrics, { playerUnitId: 'P-1', buildVersion: '12.0.5' });
    const row = db.prepare('SELECT player_cr, player_rating, build_version FROM match WHERE match_id=?').get('M1') as { player_cr: number | null; player_rating: number | null; build_version: string | null };
    expect(row.player_cr).toBe(1834);
    expect(row.player_rating).toBe(2110); // MMR unchanged
    expect(row.build_version).toBe('12.0.5');
  });
});
