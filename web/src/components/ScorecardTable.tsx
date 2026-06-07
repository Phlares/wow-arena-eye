import type { Scorecard, MetricScore } from '../api.js';
import { isRateMetric } from '../api.js';
import { fmtNum } from '../format.js';

const MIN_COHORT = 5;
const GLYPH: Record<string, string> = { better: '▲ better', worse: '▼ worse', average: '= average', descriptive: '· info', insufficient: '· n/a' };
const VCLASS: Record<string, string> = { better: 'v-better', worse: 'v-worse', average: 'v-avg', descriptive: 'v-info', insufficient: 'v-avg' };
const WLCLASS: Record<string, string> = { 'win-like': 'wl-win', 'loss-like': 'wl-loss', neutral: 'wl-neu' };

/** A value for display: 1-decimal for small numbers, abbreviated (k/M) for large; "—" when null. */
function fmtVal(v: number | null): string {
  if (v === null) return '—';
  return Math.abs(v) >= 1000 ? fmtNum(v) : String(Math.round(v * 10) / 10);
}

function Row({ m }: { m: MetricScore }) {
  const unit = isRateMetric(m.id) ? '/min' : '';
  return (
    <tr>
      <td>{m.label}</td>
      <td>{m.value === null ? '—' : `${fmtVal(m.value)}${unit}`}{m.isNewBest && <span className="star"> ★</span>}</td>
      <td className={VCLASS[m.verdict] ?? ''}>{GLYPH[m.verdict] ?? m.verdict}</td>
      <td>{m.verdict === 'insufficient' ? '' : `${fmtVal(m.mean)}${unit}`}</td>
      <td className={WLCLASS[m.winLikeness] ?? ''}>{m.winLikeness}</td>
    </tr>
  );
}

export function ScorecardTable({ scorecard }: { scorecard: Scorecard }) {
  const { cohort, metrics } = scorecard;
  return (
    <div className="sct-wrap">
      <div className="sct-summary">Baseline: {cohort.description} · n={cohort.n} ({cohort.wins}W–{cohort.losses}L)
        {cohort.n < MIN_COHORT && <span className="sct-warn"> · small baseline — verdicts suppressed</span>}
      </div>
      <table className="sct">
        <thead><tr><th>Metric</th><th>This match</th><th>Verdict</th><th>vs avg</th><th>win/loss</th></tr></thead>
        <tbody>{metrics.map((m) => <Row key={m.id} m={m} />)}</tbody>
      </table>
    </div>
  );
}
