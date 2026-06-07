import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from '../store/sqlite.js';
import { openDb } from '../store/store.js';
import { loadConfig } from '../config.js';
import { attachSessions, buildRangeSeries, buildScorecardFor, enrichRatingDeltas, loadFilterOptions, loadMatchDetail, loadMatchScalars, loadViewerMatches } from './queries.js';
import type { MatchQuery } from './types.js';
import type { Scope } from '../scorecard/types.js';

/** A baseline Scope from /scorecard query params: mode (overall|games|sessions) + composable filters. */
function parseScope(p: URLSearchParams): Scope {
  const mode = p.get('mode'); const n = Number(p.get('n'));
  const num = (k: string) => (p.get(k) && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : undefined);
  return {
    lastNGames: mode === 'games' && Number.isFinite(n) && n > 0 ? n : undefined,
    lastNSessions: mode === 'sessions' && Number.isFinite(n) && n > 0 ? n : undefined,
    comp: p.get('comp') === '1' || undefined, map: p.get('map') === '1' || undefined,
    ratingBand: num('ratingBand'), timeOfDayHours: num('timeOfDay'), season: p.get('season') === '1' || undefined,
  };
}

export interface ApiResult { status: number; body: string; }

function json(status: number, data: unknown): ApiResult {
  return { status, body: JSON.stringify(data) };
}

function parseQuery(p: URLSearchParams): MatchQuery {
  const num = (k: string) => (p.has(k) && p.get(k) !== '' && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : undefined);
  const str = (k: string) => (p.get(k) || undefined);
  const sort = p.get('sort');
  const order = p.get('order');
  return {
    character: str('character'), bracket: str('bracket'),
    allySpecs: str('allySpecs'), allyClasses: str('allyClasses'),
    enemySpecs: str('enemySpecs'), enemyClasses: str('enemyClasses'),
    map: str('map'), result: str('result'), minRating: num('minRating'), maxRating: num('maxRating'),
    from: num('from'), to: num('to'), q: str('q'),
    sort: (['startMs', 'rating', 'damageDone', 'dps'] as const).find((s) => s === sort),
    order: order === 'asc' ? 'asc' : order === 'desc' ? 'desc' : undefined,
    limit: num('limit'), offset: num('offset'),
  };
}

/** Pure API router over the store. Returns {status, body}. gapMs = session gap. */
export function handleApi(db: DatabaseSync, method: string, path: string, params: URLSearchParams, gapMs: number): ApiResult {
  if (method !== 'GET') return json(405, { error: 'method not allowed' });
  if (path === '/api/filters') return json(200, loadFilterOptions(db, params.get('character') || undefined));
  if (path === '/api/matches') {
    const query = parseQuery(params);
    const matches = loadViewerMatches(db, query);
    enrichRatingDeltas(db, matches);
    const sessions = attachSessions(db, query, matches, gapMs);
    // true filtered count (ignores pagination) so `total` is honest for any future paging UI
    const total = query.limit === undefined && query.offset === undefined
      ? matches.length
      : loadViewerMatches(db, { ...query, limit: undefined, offset: undefined }).length;
    return json(200, { matches, sessions, total });
  }
  const scorecard = path.match(/^\/api\/matches\/(.+)\/scorecard$/);
  if (scorecard) {
    const sc = buildScorecardFor(db, decodeURIComponent(scorecard[1]), parseScope(params), loadConfig().seasons, gapMs);
    return sc ? json(200, sc) : json(404, { error: 'match not in store' });
  }
  const detail = path.match(/^\/api\/matches\/(.+)\/detail$/);
  if (detail) {
    const metrics = loadMatchDetail(db, decodeURIComponent(detail[1]));
    return metrics ? json(200, { metrics, rangeSeries: buildRangeSeries(metrics) }) : json(404, { error: 'no detail for match (re-ingest to populate)' });
  }
  const single = path.match(/^\/api\/matches\/(.+)$/);
  if (single) {
    const m = loadMatchScalars(db, decodeURIComponent(single[1]));
    return m ? json(200, m) : json(404, { error: 'match not found' });
  }
  return json(404, { error: 'not found' });
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2' };

/** Start the HTTP server: /api/* via handleApi, everything else from web/dist (SPA fallback). */
export function startServer(db: DatabaseSync, gapMs: number, port: number, distDir: string): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const r = handleApi(db, req.method ?? 'GET', url.pathname, url.searchParams, gapMs);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(r.body);
      return;
    }
    const rel = normalize(url.pathname).replace(/^([/\\])+/, '');
    let file = join(distDir, rel);
    if (!existsSync(file) || rel === '') file = join(distDir, 'index.html');
    if (!existsSync(file)) { res.writeHead(404); res.end('build the SPA: npm run viewer'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  server.listen(port);
  return server;
}

function main(): void {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath ?? './wow-arena-eye.local.db');
  const gapMs = cfg.sessionGapMinutes * 60_000;
  const port = Number(process.env.WAE_VIEWER_PORT || 5174);
  const dist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  startServer(db, gapMs, port, dist);
  console.log(`Viewer API + UI on http://localhost:${port}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}
