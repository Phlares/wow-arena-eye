import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { loadViewerMatches, loadFilterOptions, enrichRatingDeltas } from '../src/viewer/queries.js';

function seed(db: InstanceType<typeof DatabaseSync>, o: { id: string; t: number; bracket: string; cr: number; mmr: number; build: string;
  combatants: { unit: string; spec: string; team: string; isPlayer?: boolean }[]; name: string; result: string }) {
  db.prepare(`INSERT INTO match (match_id,start_ms,bracket,zone_id,duration_sec,ally_comp_sig,enemy_comp_sig,player_rating,player_cr,build_version,result,player_unit_id,player_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(o.id, o.t, o.bracket, '1825', 100, 'a', 'e', o.mmr, o.cr, o.build, o.result, o.combatants.find((c)=>c.isPlayer)!.unit, o.name);
  const ci = db.prepare('INSERT INTO combatant (match_id,unit_id,name,realm,class,spec,team,is_player) VALUES (?,?,?,?,?,?,?,?)');
  for (const c of o.combatants) ci.run(o.id, c.unit, c.unit, 'R', null, c.spec, c.team, c.isPlayer ? 1 : 0);
}

function db() {
  const d = new DatabaseSync(':memory:'); migrate(d);
  seed(d, { id: 'M1', t: 1000, bracket: '3v3', cr: 1800, mmr: 2000, build: '12.0.5', name: 'Me-R', result: 'win',
    combatants: [{ unit: 'P', spec: '265', team: 'friendly', isPlayer: true }, { unit: 'E1', spec: '250', team: 'enemy' }] });
  seed(d, { id: 'M2', t: 5000, bracket: '3v3', cr: 1816, mmr: 2014, build: '12.0.5', name: 'Me-R', result: 'loss',
    combatants: [{ unit: 'P', spec: '265', team: 'friendly', isPlayer: true }, { unit: 'E2', spec: '62', team: 'enemy' }] });
  return d;
}

describe('loadViewerMatches v2', () => {
  it('exposes cr, mmr (= rating) and buildVersion', () => {
    const m = loadViewerMatches(db(), {}).find((x) => x.matchId === 'M1')!;
    expect(m).toMatchObject({ cr: 1800, rating: 2000, buildVersion: '12.0.5' });
  });
  it('comp filter: enemyClasses=Death Knight matches only M1 (class expands to its specs)', () => {
    expect(loadViewerMatches(db(), { enemyClasses: 'Death Knight' }).map((m) => m.matchId)).toEqual(['M1']);
  });
  it('comp filter: enemySpecs=62 (Arcane Mage) matches only M2; union widens', () => {
    expect(loadViewerMatches(db(), { enemySpecs: '62' }).map((m) => m.matchId)).toEqual(['M2']);
    expect(loadViewerMatches(db(), { enemySpecs: '62', enemyClasses: 'Death Knight' }).map((m) => m.matchId).sort()).toEqual(['M1', 'M2']);
  });
});

describe('enrichRatingDeltas', () => {
  it('computes CR/MMR delta vs the previous game by (character,bracket), independent of filters', () => {
    const d = db();
    const ms = loadViewerMatches(d, { enemySpecs: '62' }); // filtered to M2 only
    enrichRatingDeltas(d, ms);
    const m2 = ms.find((m) => m.matchId === 'M2')!;
    expect(m2.crDelta).toBe(16);      // 1816 - 1800 (vs M1, even though M1 is filtered out)
    expect(m2.ratingDelta).toBe(14);  // MMR: 2014 - 2000
  });
  it('omits the delta when there is no prior game for that character+bracket', () => {
    const d = db();
    const ms = loadViewerMatches(d, {});
    enrichRatingDeltas(d, ms);
    expect(ms.find((m) => m.matchId === 'M1')!.crDelta).toBeNull();
  });
});

describe('loadFilterOptions v2', () => {
  it('returns a class→spec tree of specs present in the data', () => {
    const tree = loadFilterOptions(db()).classSpecTree;
    const wl = tree.find((t) => t.className === 'Warlock');
    expect(wl?.specs.map((s) => s.id)).toContain('265');
    const dk = tree.find((t) => t.className === 'Death Knight');
    expect(dk?.specs.map((s) => s.id)).toContain('250');
  });
});
