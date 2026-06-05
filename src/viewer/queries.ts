import type { DatabaseSync } from '../store/sqlite.js';
import { compLabel } from '../metadata/specs.js';
import { mapName } from '../metadata/arenas.js';
import type { FilterOptions, MatchQuery, MatchSummary } from './types.js';

interface Row {
  match_id: string; start_ms: number | null; duration_sec: number | null; bracket: string | null;
  zone_id: string | null; ally_comp_sig: string | null; enemy_comp_sig: string | null;
  player_rating: number | null; result: string | null; player_name: string | null;
  damageDone: number | null; dps: number | null; interruptsLanded: number | null;
}

const SORT_COLS: Record<NonNullable<MatchQuery['sort']>, string> = {
  startMs: 'm.start_ms', rating: 'm.player_rating', damageDone: 'd.damageDone', dps: 'd.dps',
};

/** Filtered, label-resolved matches. ratingDelta is computed per character over the returned set. */
export function loadViewerMatches(db: DatabaseSync, q: MatchQuery): MatchSummary[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  // empty string and undefined both mean "no filter" (omitted form fields send '')
  const eq = (col: string, v: string | number | undefined) => { if (v !== undefined && v !== '') { where.push(`${col} = ?`); args.push(v); } };
  eq('m.match_id', q.id);
  eq('m.player_name', q.character);
  eq('m.bracket', q.bracket);
  eq('m.ally_comp_sig', q.myComp);
  eq('m.enemy_comp_sig', q.enemyComp);
  eq('m.zone_id', q.map);
  eq('m.result', q.result);
  if (q.minRating !== undefined) { where.push('m.player_rating >= ?'); args.push(q.minRating); }
  if (q.maxRating !== undefined) { where.push('m.player_rating <= ?'); args.push(q.maxRating); }
  if (q.from !== undefined) { where.push('m.start_ms >= ?'); args.push(q.from); }
  if (q.to !== undefined) { where.push('m.start_ms <= ?'); args.push(q.to); }

  const sortCol = SORT_COLS[q.sort ?? 'startMs'];
  const order = q.order === 'asc' ? 'ASC' : 'DESC';
  let limit = '', offset = '';
  if (q.limit !== undefined) { limit = ' LIMIT ?'; args.push(q.limit); }
  if (q.offset !== undefined) { offset = ' OFFSET ?'; args.push(q.offset); }
  const sql =
    `SELECT m.match_id, m.start_ms, m.duration_sec, m.bracket, m.zone_id, m.ally_comp_sig,
            m.enemy_comp_sig, m.player_rating, m.result, m.player_name,
            d.damageDone, d.dps, d.interruptsLanded
     FROM match m
     LEFT JOIN dataset_export d ON d.match_id = m.match_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY ${sortCol} ${order}${limit}${offset}`;
  const rows = db.prepare(sql).all(...args) as unknown as Row[];

  let mapped: MatchSummary[] = rows.map((r) => ({
    matchId: r.match_id, startMs: r.start_ms, durationSec: r.duration_sec, bracket: r.bracket ?? '',
    character: r.player_name ?? '', mapId: r.zone_id ?? '', mapName: mapName(r.zone_id ?? ''),
    allyComp: r.ally_comp_sig ?? '', allyCompLabel: compLabel(r.ally_comp_sig ?? ''),
    enemyComp: r.enemy_comp_sig ?? '', enemyCompLabel: compLabel(r.enemy_comp_sig ?? ''),
    rating: r.player_rating, ratingDelta: null, result: r.result ?? 'unknown', sessionId: null,
    damageDone: r.damageDone, dps: r.dps, interruptsLanded: r.interruptsLanded,
  }));

  if (q.q) {
    const needle = q.q.toLowerCase();
    mapped = mapped.filter((m) => `${m.allyCompLabel} ${m.enemyCompLabel} ${m.mapName}`.toLowerCase().includes(needle));
  }

  const byChar = new Map<string, MatchSummary[]>();
  for (const m of [...mapped].sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0))) {
    const arr = byChar.get(m.character) ?? [];
    const prev = arr.length ? arr[arr.length - 1] : undefined;
    if (m.rating !== null && prev && prev.rating !== null) m.ratingDelta = m.rating - prev.rating;
    arr.push(m); byChar.set(m.character, arr);
  }
  return mapped;
}

/** Single match's scalar row for the summary drawer; null if absent. */
export function loadMatchScalars(db: DatabaseSync, matchId: string): MatchSummary | null {
  return loadViewerMatches(db, { id: matchId })[0] ?? null;
}

/** Distinct filter values + ranges across the store (optionally scoped to one character). */
export function loadFilterOptions(db: DatabaseSync, character?: string): FilterOptions {
  const all = loadViewerMatches(db, character ? { character } : {});
  const uniq = (xs: string[]) => [...new Set(xs.filter((x) => x !== ''))];
  const comps = (pick: (m: MatchSummary) => [string, string]) => {
    const seen = new Map<string, string>();
    for (const m of all) { const [v, l] = pick(m); if (v !== '' && !seen.has(v)) seen.set(v, l); }
    return [...seen].map(([value, label]) => ({ value, label }));
  };
  const ratings = all.map((m) => m.rating).filter((r): r is number => r !== null);
  const dates = all.map((m) => m.startMs).filter((s): s is number => s !== null);
  return {
    characters: uniq(all.map((m) => m.character)),
    brackets: uniq(all.map((m) => m.bracket)),
    myComps: comps((m) => [m.allyComp, m.allyCompLabel]),
    enemyComps: comps((m) => [m.enemyComp, m.enemyCompLabel]),
    maps: comps((m) => [m.mapId, m.mapName]),
    ratingRange: ratings.length ? { min: Math.min(...ratings), max: Math.max(...ratings) } : null,
    dateRange: dates.length ? { minMs: Math.min(...dates), maxMs: Math.max(...dates) } : null,
  };
}
