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

  useEffect(() => { void fetchFilters().then(setOptions); }, []);
  useEffect(() => { writeUrlFilters(filters); void fetchMatches(filters).then(setData); }, [filters]);

  const onChange = (patch: Filters) => { setSelected(null); setFilters((f) => ({ ...f, ...patch })); };

  return (
    <div className="app">
      <h1>Arena Match Viewer</h1>
      <div className="layout">
        {options && <FilterRail options={options} filters={filters} onChange={onChange} />}
        <div className="main">
          <MatchTable matches={data.matches} sessions={data.sessions} selectedId={selected?.matchId ?? null}
            onSelect={(id) => setSelected(data.matches.find((m) => m.matchId === id) ?? null)} />
        </div>
        <SummaryDrawer match={selected} />
      </div>
    </div>
  );
}
