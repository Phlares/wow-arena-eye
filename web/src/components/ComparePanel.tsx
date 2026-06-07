import { useEffect, useState } from 'react';
import { fetchScorecard, type BaselineQuery, type Scorecard } from '../api.js';
import { CompareControl } from './CompareControl.js';
import { ScorecardTable } from './ScorecardTable.js';

/** Comparative scorecard for one match: a baseline picker + the scorecard table, re-fetched on change. */
export function ComparePanel({ matchId }: { matchId: string }) {
  const [baseline, setBaseline] = useState<BaselineQuery>({ mode: 'overall' });
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let ignore = false;
    setScorecard(null); setErr(null);
    fetchScorecard(matchId, baseline)
      .then((s) => { if (!ignore) setScorecard(s); })
      .catch((e: unknown) => { if (!ignore) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { ignore = true; };
  }, [matchId, baseline]);

  return (
    <div className="compare-panel">
      <h3 className="cp-title">Comparative scorecard</h3>
      <CompareControl baseline={baseline} onChange={setBaseline} />
      {err === 'not-in-store' && <div className="detail-empty">This match is not in the store — can't score it.</div>}
      {err && err !== 'not-in-store' && <div className="detail-empty">Failed to load scorecard: {err}</div>}
      {!err && !scorecard && <div className="detail-empty">Loading…</div>}
      {scorecard && <ScorecardTable scorecard={scorecard} />}
    </div>
  );
}
