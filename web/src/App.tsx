import { useEffect, useState } from 'react';
import { FilterRail } from './components/FilterRail.js';
import { MatchTable } from './components/MatchTable.js';
import { SummaryDrawer } from './components/SummaryDrawer.js';
import { DetailView } from './components/DetailView.js';
import { Settings } from './components/Settings.js';
import { fetchFilters, fetchMatches, fetchMatchDetail, fetchMetadata, toParams, type FilterOptions, type Filters, type MatchDetail, type MatchesResponse, type MatchSummary, type MetadataView } from './api.js';

function readUrlFilters(): Filters {
  const out: Filters = {};
  new URLSearchParams(location.search).forEach((v, k) => { out[k] = v; });
  return out;
}
function writeUrlFilters(f: Filters) {
  const p = toParams(f);
  history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
}

export function App() {
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [filters, setFilters] = useState<Filters>(readUrlFilters);
  const [data, setData] = useState<MatchesResponse>({ matches: [], sessions: [], total: 0 });
  const [selected, setSelected] = useState<MatchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  // click a sortable header: new col → desc, same col desc → asc, same col asc → cleared
  const onSort = (col: string) => setSort((s) =>
    s?.col !== col ? { col, dir: 'desc' } : s.dir === 'desc' ? { col, dir: 'asc' } : null);

  // persistent tabs: matches (default) | settings (read-only tracked-spell view, fetched lazily)
  const [tab, setTab] = useState<'matches' | 'settings'>('matches');
  const [meta, setMeta] = useState<MetadataView | null>(null);
  useEffect(() => {
    if (tab !== 'settings' || meta) return;
    void fetchMetadata().then(setMeta).catch((e: unknown) => setError(String(e)));
  }, [tab, meta]);

  // per-match detail overlay (sub-project B)
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  useEffect(() => {
    if (detailId === null) return;
    let ignore = false; // drop a stale response if the overlay closed/changed before it resolved
    setDetail(null); setDetailErr(null);
    void fetchMatchDetail(detailId)
      .then((d) => { if (!ignore) setDetail(d); })
      .catch((e: unknown) => { if (!ignore) setDetailErr(e instanceof Error ? e.message : String(e)); });
    return () => { ignore = true; };
  }, [detailId]);
  const closeDetail = () => { setDetailId(null); setDetail(null); setDetailErr(null); };

  useEffect(() => { void fetchFilters().then(setOptions).catch((e: unknown) => setError(String(e))); }, []);
  useEffect(() => {
    setError(null);
    writeUrlFilters(filters);
    void fetchMatches(filters).then(setData).catch((e: unknown) => setError(String(e)));
  }, [filters]);

  const onChange = (patch: Filters) => { setSelected(null); setFilters((f) => ({ ...f, ...patch })); };

  return (
    <div className="app">
      <div className="app-head">
        <h1>Arena Match Viewer</h1>
        <nav className="tabs">
          <button className={tab === 'matches' ? 'on' : ''} onClick={() => setTab('matches')}>Matches</button>
          <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>Settings</button>
        </nav>
      </div>
      {error && <div className="error">{error} — is the viewer server running? (npm run viewer)</div>}
      {tab === 'settings' ? (
        meta ? <Settings meta={meta} /> : <div className="empty">Loading metadata…</div>
      ) : (
      <div className="layout">
        {options && <FilterRail options={options} filters={filters} onChange={onChange} />}
        <div className="main">
          <MatchTable matches={data.matches} sessions={data.sessions} selectedId={selected?.matchId ?? null}
            onSelect={(id) => setSelected(data.matches.find((m) => m.matchId === id) ?? null)}
            sort={sort} onSort={onSort} />
        </div>
        <SummaryDrawer match={selected} onOpenDetail={setDetailId} />
      </div>
      )}
      {detailId !== null && <DetailView detail={detail} error={detailErr} matchId={detailId} onClose={closeDetail} />}
    </div>
  );
}
