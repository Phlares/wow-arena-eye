import type { MatchSummary } from '../api.js';
import { fmtNum, fmtDuration, fmtRatingDelta } from '../format.js';

function Row({ k, v }: { k: string; v: string }) {
  return <div className="drow"><span className="dk">{k}</span><span>{v}</span></div>;
}

export function SummaryDrawer({ match: m }: { match: MatchSummary | null }) {
  if (!m) return null;
  return (
    <aside className="drawer">
      <div className="dhead"><span className={m.result === 'win' ? 'win' : 'loss'}>{m.result.toUpperCase()}</span></div>
      <Row k="Matchup" v={`${m.allyCompLabel} vs ${m.enemyCompLabel}`} />
      <Row k="Map" v={m.mapName} />
      <Row k="Rating" v={`${m.rating ?? '—'} ${fmtRatingDelta(m.ratingDelta)}`} />
      <Row k="Duration" v={fmtDuration(m.durationSec)} />
      <Row k="Damage" v={fmtNum(m.damageDone)} />
      <Row k="DPS" v={fmtNum(m.dps)} />
      <Row k="Kicks" v={fmtNum(m.interruptsLanded)} />
      <div className="soon">Open full detail → (coming in B)<br />Compare to history → (coming in C)</div>
    </aside>
  );
}
