import { useEffect, useState } from 'react';
import { FilterRail } from './components/FilterRail.js';
import { MatchTable } from './components/MatchTable.js';
import { SummaryDrawer } from './components/SummaryDrawer.js';
import { fetchFilters, fetchMatches, toParams, type FilterOptions, type Filters, type MatchesResponse, type MatchSummary } from './api.js';

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
  const onSort = (col: string) => setSort((s) =>
    s?.col !== col ? { col, dir: 'desc' } : s.dir === 'desc' ? { col, dir: 'asc' } : null);

  useEffect(() => { void fetchFilters().then(setOptions).catch((e: unknown) => setError(String(e))); }, []);
  useEffect(() => {
    setError(null);
    writeUrlFilters(filters);
    void fetchMatches(filters).then(setData).catch((e: unknown) => setError(String(e)));
  }, [filters]);

  const onChange = (patch: Filters) => { setSelected(null); setFilters((f) => ({ ...f, ...patch })); };

  return (
    <div className="app">
      <h1>Arena Match Viewer</h1>
      {error && <div className="error">{error} — is the viewer server running? (npm run viewer)</div>}
      <div className="layout">
        {options && <FilterRail options={options} filters={filters} onChange={onChange} />}
        <div className="main">
          <MatchTable matches={data.matches} sessions={data.sessions} selectedId={selected?.matchId ?? null}
            onSelect={(id) => setSelected(data.matches.find((m) => m.matchId === id) ?? null)}
            sort={sort} onSort={onSort} />
        </div>
        <SummaryDrawer match={selected} />
      </div>
    </div>
  );
}
