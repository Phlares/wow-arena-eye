import type { DatabaseSync } from '../store/sqlite.js';
import { compLabel, specLabel, className, specsOfClass } from '../metadata/specs.js';
import { mapName } from '../metadata/arenas.js';
import { sessionize, type Session, type SessionInput } from '../store/sessions.js';
import { distanceAt } from '../metrics/positionTracks.js';
import { STEP_SEC, round1 } from '../metrics/spacing.js';
import type { MatchMetrics, PositionTrack } from '../metrics/types.js';
import type { FilterOptions, MatchQuery, MatchSummary, RangePoint } from './types.js';

interface Row {
  match_id: string; start_ms: number | null; duration_sec: number | null; bracket: string | null;
  zone_id: string | null; ally_comp_sig: string | null; enemy_comp_sig: string | null;
  player_rating: number | null; player_cr: number | null; build_version: string | null;
  result: string | null; player_name: string | null;
  damageDone: number | null; dps: number | null; interruptsLanded: number | null;
  interruptsSuffered: number | null; precognitionUptimeSec: number | null; enemyPrecognitionUptimeSec: number | null;
}

const SORT_COLS: Record<NonNullable<MatchQuery['sort']>, string> = {
  startMs: 'm.start_ms', rating: 'm.player_rating', damageDone: 'd.damageDone', dps: 'd.dps',
};

/** Filtered, label-resolved matches. CR/MMR deltas are filled separately by enrichRatingDeltas. */
export function loadViewerMatches(db: DatabaseSync, q: MatchQuery): MatchSummary[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  // empty string and undefined both mean "no filter" (omitted form fields send '')
  const eq = (col: string, v: string | number | undefined) => { if (v !== undefined && v !== '') { where.push(`${col} = ?`); args.push(v); } };
  eq('m.match_id', q.id);
  eq('m.player_name', q.character);
  eq('m.bracket', q.bracket);
  eq('m.zone_id', q.map);
  eq('m.result', q.result);
  if (q.minRating !== undefined) { where.push('m.player_rating >= ?'); args.push(q.minRating); }
  if (q.maxRating !== undefined) { where.push('m.player_rating <= ?'); args.push(q.maxRating); }
  if (q.from !== undefined) { where.push('m.start_ms >= ?'); args.push(q.from); }
  if (q.to !== undefined) { where.push('m.start_ms <= ?'); args.push(q.to); }

  const compExists = (team: 'friendly' | 'enemy', specsCsv?: string, classesCsv?: string) => {
    const parseCsv = (s?: string) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const specs = new Set<string>();
    for (const s of parseCsv(specsCsv)) specs.add(s);
    for (const c of parseCsv(classesCsv)) for (const s of specsOfClass(c)) specs.add(s);
    if (specs.size === 0) return;
    const ids = [...specs];
    where.push(`EXISTS (SELECT 1 FROM combatant c2 WHERE c2.match_id = m.match_id AND c2.team = ? AND c2.spec IN (${ids.map(() => '?').join(',')}))`);
    args.push(team, ...ids);
  };
  compExists('friendly', q.allySpecs, q.allyClasses);
  compExists('enemy', q.enemySpecs, q.enemyClasses);

  const sortCol = SORT_COLS[q.sort ?? 'startMs'];
  const order = q.order === 'asc' ? 'ASC' : 'DESC';
  let limit = '', offset = '';
  if (q.limit !== undefined) { limit = ' LIMIT ?'; args.push(q.limit); }
  if (q.offset !== undefined) {
    if (q.limit === undefined) limit = ' LIMIT -1'; // SQLite requires LIMIT before OFFSET; -1 = no limit
    offset = ' OFFSET ?'; args.push(q.offset);
  }
  const sql =
    `SELECT m.match_id, m.start_ms, m.duration_sec, m.bracket, m.zone_id, m.ally_comp_sig,
            m.enemy_comp_sig, m.player_rating, m.player_cr, m.build_version, m.result, m.player_name,
            d.damageDone, d.dps, d.interruptsLanded, d.interruptsSuffered,
            d.precognitionUptimeSec, d.enemyPrecognitionUptimeSec
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
    rating: r.player_rating, ratingDelta: null,   // MMR + delta (filled by enrichRatingDeltas)
    cr: r.player_cr, crDelta: null, buildVersion: r.build_version ?? '',
    result: r.result ?? 'unknown', sessionId: null,
    damageDone: r.damageDone, dps: r.dps, interruptsLanded: r.interruptsLanded,
    interruptsSuffered: r.interruptsSuffered,
    precognitionUptimeSec: r.precognitionUptimeSec, enemyPrecognitionUptimeSec: r.enemyPrecognitionUptimeSec,
  }));

  // free-text search runs in JS over RESOLVED labels (which aren't stored columns), so it
  // applies AFTER any SQL LIMIT/OFFSET — don't combine q with server-side pagination until
  // it moves into SQL, or a page could under-fill.
  if (q.q) {
    const needle = q.q.toLowerCase();
    mapped = mapped.filter((m) => `${m.allyCompLabel} ${m.enemyCompLabel} ${m.mapName}`.toLowerCase().includes(needle));
  }

  return mapped;
}

/** Single match's scalar row for the summary drawer; null if absent.
 *  crDelta/ratingDelta are null here (enrichRatingDeltas runs only on the list path). */
export function loadMatchScalars(db: DatabaseSync, matchId: string): MatchSummary | null {
  return loadViewerMatches(db, { id: matchId })[0] ?? null;
}

/** Attach CR/MMR deltas to each match vs the chronologically-previous game by the same
 *  (character, bracket), over FULL history (filter-independent). null when no prior game. */
export function enrichRatingDeltas(db: DatabaseSync, matches: MatchSummary[]): void {
  const keyOf = (character: string, bracket: string) => `${character}\0${bracket}`;
  const need = [...new Set(matches.map((m) => keyOf(m.character, m.bracket)))];
  type Hist = { startMs: number | null; cr: number | null; mmr: number | null; matchId: string };
  const hist = new Map<string, Hist[]>();
  const stmt = db.prepare('SELECT match_id, start_ms, player_cr, player_rating FROM match WHERE player_name = ? AND bracket = ? ORDER BY start_ms');
  for (const key of need) {
    const [character, bracket] = key.split('\0');
    const rows = stmt.all(character, bracket) as { match_id: string; start_ms: number | null; player_cr: number | null; player_rating: number | null }[];
    hist.set(key, rows.map((r) => ({ startMs: r.start_ms, cr: r.player_cr, mmr: r.player_rating, matchId: r.match_id })));
  }
  for (const m of matches) {
    const arr = hist.get(keyOf(m.character, m.bracket));
    if (!arr) continue;
    const i = arr.findIndex((h) => h.matchId === m.matchId);
    const prev = i > 0 ? arr[i - 1] : undefined;
    if (prev) {
      if (m.cr !== null && prev.cr !== null) m.crDelta = m.cr - prev.cr;
      if (m.rating !== null && prev.mmr !== null) m.ratingDelta = m.rating - prev.mmr; // MMR delta
    }
  }
}

/** Compute per-character queue-sessions over each character's FULL history and tag every
 *  match in `matches` with its sessionId (mutated in place); returns all sessions across the
 *  characters present. A full-history reload per character is required because sessions must
 *  span the whole timeline, not just the filtered/paginated page — so it cannot be derived by
 *  partitioning `matches` whenever any filter other than `character` is active. Reused by C. */
export function attachSessions(db: DatabaseSync, query: MatchQuery, matches: MatchSummary[], gapMs: number): Session[] {
  const chars = query.character ? [query.character] : [...new Set(matches.map((m) => m.character).filter((c) => c !== ''))];
  const sessions: Session[] = [];
  for (const ch of chars) {
    const hist = loadViewerMatches(db, { character: ch }).map<SessionInput>((m) => ({
      matchId: m.matchId, startMs: m.startMs ?? 0, durationSec: m.durationSec,
      rating: m.rating, result: m.result, allyCompLabel: m.allyCompLabel,
    }));
    const chSessions = sessionize(hist, gapMs);
    sessions.push(...chSessions);
    for (const m of matches) {
      if (m.character !== ch) continue;
      const s = chSessions.find((s) => (m.startMs ?? 0) >= s.startMs && (m.startMs ?? 0) <= s.endMs);
      m.sessionId = s ? s.id : null;
    }
  }
  return sessions;
}

/** Distinct filter values + ranges across the store (optionally scoped to one character). */
export function loadFilterOptions(db: DatabaseSync, character?: string): FilterOptions {
  const all = loadViewerMatches(db, character ? { character } : {});
  const uniq = (xs: string[]) => [...new Set(xs.filter((x) => x !== ''))];
  const ratings = all.map((m) => m.rating).filter((r): r is number => r !== null);
  const dates = all.map((m) => m.startMs).filter((s): s is number => s !== null);
  const specRows = db.prepare("SELECT DISTINCT spec FROM combatant WHERE spec IS NOT NULL AND spec != ''").all() as { spec: string }[];
  const byClass = new Map<string, { id: string; specName: string }[]>();
  for (const { spec } of specRows) {
    const cls = className(spec) || 'Unknown';
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls)!.push({ id: spec, specName: specLabel(spec) });
  }
  const classSpecTree = [...byClass.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cls, specs]) => ({ className: cls, specs: specs.sort((a, b) => a.specName.localeCompare(b.specName)) }));
  return {
    characters: uniq(all.map((m) => m.character)),
    brackets: uniq(all.map((m) => m.bracket)),
    classSpecTree,
    maps: (() => { const seen = new Map<string, string>(); for (const m of all) if (m.mapId !== '' && !seen.has(m.mapId)) seen.set(m.mapId, m.mapName); return [...seen].map(([value, label]) => ({ value, label })); })(),
    ratingRange: ratings.length ? { min: Math.min(...ratings), max: Math.max(...ratings) } : null,
    dateRange: dates.length ? { minMs: Math.min(...dates), maxMs: Math.max(...dates) } : null,
  };
}

/** Parsed full MatchMetrics for one match, or null if not persisted (a pre-detail ingest). */
export function loadMatchDetail(db: DatabaseSync, matchId: string): MatchMetrics | null {
  const row = db.prepare('SELECT metrics_json FROM match_detail WHERE match_id=?').get(matchId) as { metrics_json?: string } | undefined;
  return row?.metrics_json ? (JSON.parse(row.metrics_json) as MatchMetrics) : null;
}

/** Recording player's distance to the primary threat (highest-damage enemy player) over time.
 *  null where either position is unknown — gaps are honest, never a fabricated 0. */
export function buildRangeSeries(m: MatchMetrics): RangePoint[] {
  const enemies = m.teams.find((t) => t.team === 'enemy')?.players ?? [];
  const threat = enemies.slice().sort((a, b) => (b.player.damageDone ?? 0) - (a.player.damageDone ?? 0))[0]?.player.unitId;
  const trackOf = (id?: string): PositionTrack | undefined => m.positionTracks.find((t) => t.unitId === id);
  const pt = trackOf(m.playerUnitId), tt = trackOf(threat);
  if (!pt?.samples.length || !tt?.samples.length) return [];
  const lastSec = Math.max(pt.samples.at(-1)?.tSec ?? 0, tt.samples.at(-1)?.tSec ?? 0);
  const out: RangePoint[] = [];
  for (let t = 0; t <= lastSec; t += STEP_SEC) {
    const d = distanceAt(pt, tt, t);
    out.push({ tSec: round1(t), dist: d === undefined ? null : round1(d) });
  }
  return out;
}
