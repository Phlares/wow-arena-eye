import type { MetricScore, Scorecard, Verdict } from './types.js';

const GLYPH: Record<Verdict, string> = { better: '▲ better', worse: '▼ worse', average: '= average', insufficient: '· n/a', descriptive: '· info' };

function fmt(v: number | null): string {
  if (v === null) return '—';
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

function pad(s: string, w: number): string { return s.length >= w ? s : s + ' '.repeat(w - s.length); }

function row(m: MetricScore): string {
  const best = m.isNewBest && m.value !== null ? '  ★ season best' : '';
  const vs = m.verdict === 'insufficient' ? '' : `vs ${fmt(m.mean)} avg`;
  return `  ${pad(m.label, 22)} ${pad(fmt(m.value), 9)} ${pad(GLYPH[m.verdict], 11)} ${pad(vs, 14)} ${pad(m.winLikeness, 10)}${best}`;
}

/** Human-readable scorecard. The JSON form is just the Scorecard object (no renderer). */
export function renderScorecardText(sc: Scorecard): string {
  const when = sc.startMs !== null ? new Date(sc.startMs).toLocaleString() : 'unknown time';
  const head = [
    `Scorecard — ${sc.character}`,
    `  ${sc.bracket} on zone ${sc.zoneId} vs ${sc.enemyComp} — ${sc.result.toUpperCase()}${sc.rating !== null ? ` @ ${sc.rating}` : ''} — ${when}`,
    `  baseline: ${sc.cohort.description} · n=${sc.cohort.n} (${sc.cohort.wins}W/${sc.cohort.losses}L)${sc.season ? ` · season ${sc.season}` : ''}`,
    `  ${pad('metric', 22)} ${pad('value', 9)} ${pad('verdict', 11)} ${pad('', 14)} ${pad('win/loss', 10)}`,
  ];
  return [...head, ...sc.metrics.map(row)].join('\n');
}
