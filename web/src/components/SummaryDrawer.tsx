import type { MatchSummary } from '../api.js';
import { fmtNum, fmtDuration, fmtRating, fmtSeconds } from '../format.js';

function Row({ k, v }: { k: string; v: string }) {
  return <div className="drow"><span className="dk">{k}</span><span>{v}</span></div>;
}

export function SummaryDrawer({ match: m, onOpenDetail }: { match: MatchSummary | null; onOpenDetail: (id: string) => void }) {
  if (!m) return null;
  return (
    <aside className="drawer">
      <div className="dhead"><span className={m.result === 'win' ? 'win' : 'loss'}>{m.result.toUpperCase()}</span></div>
      <Row k="Matchup" v={`${m.allyCompLabel} vs ${m.enemyCompLabel}`} />
      <Row k="Map" v={m.mapName} />
      <Row k="CR" v={fmtRating(m.cr, m.crDelta)} />
      <Row k="MMR" v={fmtRating(m.rating, m.ratingDelta)} />
      <Row k="Duration" v={fmtDuration(m.durationSec)} />
      <Row k="Damage" v={fmtNum(m.damageDone)} />
      <Row k="DPS" v={fmtNum(m.dps)} />
      <Row k="Kicks" v={fmtNum(m.interruptsLanded)} />
      <Row k="Kicks taken" v={fmtNum(m.interruptsSuffered)} />
      <Row k="Precognition (you)" v={fmtSeconds(m.precognitionUptimeSec)} />
      <Row k="Precognition (enemy)" v={fmtSeconds(m.enemyPrecognitionUptimeSec)} />
      <button className="open-detail" onClick={() => onOpenDetail(m.matchId)}>Open full detail →</button>
      <div className="soon">Compare to history → (coming in C)</div>
    </aside>
  );
}
