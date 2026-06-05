import type { MatchSummary, SessionSummary } from '../api.js';
import { fmtNum, fmtRatingDelta, fmtClock } from '../format.js';

interface Props {
  matches: MatchSummary[]; sessions: SessionSummary[];
  selectedId: string | null; onSelect: (id: string) => void;
}

function SessionHeader({ s }: { s: SessionSummary }) {
  const delta = s.ratingStart !== null && s.ratingEnd !== null ? s.ratingEnd - s.ratingStart : null;
  return (
    <tr className="sep"><td colSpan={8}>
      ▸ session · {fmtClock(s.startMs)} · {s.count} games · {s.wins}W–{s.losses}L
      {delta !== null ? ` · ${fmtRatingDelta(delta)}` : ''} · {s.comps.join(', ')}
    </td></tr>
  );
}

export function MatchTable({ matches, sessions, selectedId, onSelect }: Props) {
  if (matches.length === 0) return <div className="empty">No matches yet — run <code>npm run ingest-db</code>.</div>;
  const order = sessions.map((s) => s.id);
  const bySession = new Map<string, MatchSummary[]>();
  for (const m of matches) {
    const key = m.sessionId ?? '∅';
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key)!.push(m);
  }
  const rank = (k: string) => { const i = order.indexOf(k); return i === -1 ? order.length : i; };
  const groups = [...bySession.keys()].sort((a, b) => rank(a) - rank(b));
  return (
    <table className="matches">
      <thead><tr>
        <th>When</th><th>R</th><th>My comp</th><th>Enemy</th><th>Map</th><th>Rating</th><th>Dmg</th><th>Kicks</th>
      </tr></thead>
      <tbody>
        {groups.flatMap((key) => {
          const s = sessions.find((s) => s.id === key);
          const rows = bySession.get(key)!;
          return [
            s ? <SessionHeader key={`s-${key}`} s={s} /> : null,
            ...rows.map((m) => (
              <tr key={m.matchId} className={m.matchId === selectedId ? 'sel' : ''} onClick={() => onSelect(m.matchId)}>
                <td>{fmtClock(m.startMs)}</td>
                <td className={m.result === 'win' ? 'win' : 'loss'}>{m.result === 'win' ? 'W' : 'L'}</td>
                <td>{m.allyCompLabel}</td><td>{m.enemyCompLabel}</td><td>{m.mapName}</td>
                <td>{m.rating ?? '—'} {fmtRatingDelta(m.ratingDelta)}</td>
                <td>{fmtNum(m.damageDone)}</td><td>{m.interruptsLanded ?? '—'}</td>
              </tr>
            )),
          ];
        })}
      </tbody>
    </table>
  );
}
