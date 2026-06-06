import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { loadFilterOptions, loadMatchScalars, loadViewerMatches, enrichRatingDeltas } from '../src/viewer/queries.js';

function seedMatch(db: InstanceType<typeof DatabaseSync>, o: {
  id: string; startMs: number; dur: number; bracket: string; zone: string;
  ally: string; enemy: string; rating: number; result: string; name: string;
  dmg?: number; dps?: number; kicks?: number;
}) {
  db.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,duration_sec,ally_comp_sig,enemy_comp_sig,player_rating,result,player_unit_id,player_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(o.id, o.startMs, o.bracket, o.zone, o.dur, o.ally, o.enemy, o.rating, o.result, 'P', o.name);
  db.prepare(`INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)`)
    .run(o.id, 'P', 'Me', 'R', null, '265', 'friendly', 1);
  const metric = db.prepare('INSERT INTO metric (match_id,scope,metric_id,value) VALUES (?,?,?,?)');
  metric.run(o.id, 'P', 'damageDone', o.dmg ?? 1000);
  metric.run(o.id, 'P', 'dps', o.dps ?? 100);
  metric.run(o.id, 'P', 'interruptsLanded', o.kicks ?? 3);
}

function db() {
  const d = new DatabaseSync(':memory:');
  migrate(d);
  seedMatch(d, { id: 'A', startMs: 1000, dur: 120, bracket: '3v3', zone: '2547', ally: '105_265', enemy: '62_64', rating: 2000, result: 'win', name: 'Me-R' });
  seedMatch(d, { id: 'B', startMs: 5000, dur: 100, bracket: '3v3', zone: '1825', ally: '105_265', enemy: '256_258', rating: 2016, result: 'loss', name: 'Me-R' });
  seedMatch(d, { id: 'C', startMs: 9000, dur: 100, bracket: '2v2', zone: '2547', ally: '265', enemy: '62', rating: 1900, result: 'win', name: 'Alt-R' });
  return d;
}

describe('loadViewerMatches', () => {
  it('returns matches with resolved labels, newest-first by default', () => {
    const ms = loadViewerMatches(db(), {});
    expect(ms.map((m) => m.matchId)).toEqual(['C', 'B', 'A']);
    const a = ms.find((m) => m.matchId === 'A')!;
    expect(a).toMatchObject({ bracket: '3v3', mapName: 'Enigma Crucible', allyCompLabel: 'Restoration·Affliction', result: 'win', rating: 2000 });
    expect(a.damageDone).toBe(1000);
  });
  it('filters by character and bracket', () => {
    expect(loadViewerMatches(db(), { character: 'Me-R', bracket: '3v3' }).map((m) => m.matchId)).toEqual(['B', 'A']);
  });
  it('filters by result and rating band', () => {
    expect(loadViewerMatches(db(), { result: 'win', minRating: 1950 }).map((m) => m.matchId)).toEqual(['A']);
  });
  it('computes ratingDelta vs the previous match for the character (via enrichRatingDeltas, full history)', () => {
    const d = db();
    const ms = loadViewerMatches(d, { character: 'Me-R', sort: 'startMs', order: 'asc' });
    enrichRatingDeltas(d, ms);
    expect(ms.find((m) => m.matchId === 'B')!.ratingDelta).toBe(16); // 2016 - 2000
    expect(ms.find((m) => m.matchId === 'A')!.ratingDelta).toBeNull(); // first
  });
  it('applies the free-text q filter over resolved labels', () => {
    expect(loadViewerMatches(db(), { q: 'Enigma' }).map((m) => m.matchId).sort()).toEqual(['A', 'C']); // both on zone 2547
    expect(loadViewerMatches(db(), { q: 'zzz-none' })).toHaveLength(0);
  });
  it('applies LIMIT and OFFSET with correctly-ordered params', () => {
    // newest-first default [C,B,A]; offset 1 limit 1 -> [B]
    expect(loadViewerMatches(db(), { limit: 1, offset: 1 }).map((m) => m.matchId)).toEqual(['B']);
  });
  it('handles offset without limit (no SQL error)', () => {
    // newest-first [C,B,A]; offset 1, no limit -> [B, A]
    expect(loadViewerMatches(db(), { offset: 1 }).map((m) => m.matchId)).toEqual(['B', 'A']);
  });
});

describe('loadFilterOptions', () => {
  it('returns distinct characters, brackets, comps, maps, and ranges', () => {
    const o = loadFilterOptions(db());
    expect(o.characters.sort()).toEqual(['Alt-R', 'Me-R']);
    expect(o.brackets.sort()).toEqual(['2v2', '3v3']);
    expect(o.maps.map((m) => m.label)).toContain('Enigma Crucible');
    expect(o.ratingRange).toEqual({ min: 1900, max: 2016 });
  });
});

describe('loadMatchScalars', () => {
  it('returns one match by id, or null when absent', () => {
    expect(loadMatchScalars(db(), 'B')!.matchId).toBe('B');
    expect(loadMatchScalars(db(), 'NOPE')).toBeNull();
  });
});

describe('empty store', () => {
  it('returns no matches and null ranges', () => {
    const d = new DatabaseSync(':memory:'); migrate(d);
    expect(loadViewerMatches(d, {})).toEqual([]);
    const o = loadFilterOptions(d);
    expect(o.characters).toEqual([]);
    expect(o.ratingRange).toBeNull();
  });
});
