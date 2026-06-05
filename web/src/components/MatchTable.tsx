import type { MatchSummary, SessionSummary } from '../api.js';
import { fmtNum, fmtRating, fmtClock } from '../format.js';

interface Props {
  matches: MatchSummary[]; sessions: SessionSummary[];
  selectedId: string | null; onSelect: (id: string) => void;
  sort: { col: string; dir: 'asc' | 'desc' } | null;
  onSort: (col: string) => void;
}

const COLS: { key: string; label: string; sortable?: boolean; num?: (m: MatchSummary) => number | null }[] = [
  { key: 'startMs', label: 'When', sortable: true },
  { key: 'result', label: 'R' },
  { key: 'ally', label: 'My comp' },
  { key: 'enemy', label: 'Enemy' },
  { key: 'map', label: 'Map' },
  { key: 'cr', label: 'CR', sortable: true, num: (m) => m.cr },
  { key: 'mmr', label: 'MMR', sortable: true, num: (m) => m.rating }, // `rating` field holds MMR
  { key: 'damageDone', label: 'Dmg', sortable: true, num: (m) => m.damageDone },
  { key: 'dps', label: 'DPS', sortable: true, num: (m) => m.dps },
  { key: 'interruptsLanded', label: 'Kicks', sortable: true, num: (m) => m.interruptsLanded },
];

function sortRows(rows: MatchSummary[], sort: Props['sort']): MatchSummary[] {
  if (!sort) return rows;
  const col = COLS.find((c) => c.key === sort.col);
  const f = col?.num ?? ((m: MatchSummary) => m.startMs);
  const out = [...rows].sort((a, b) => ((f(a) ?? -Infinity) - (f(b) ?? -Infinity)));
  return sort.dir === 'desc' ? out.reverse() : out;
}

function Row({ m, selectedId, onSelect }: { m: MatchSummary; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <tr className={m.matchId === selectedId ? 'sel' : ''} onClick={() => onSelect(m.matchId)}>
      <td>{fmtClock(m.startMs)}</td>
      <td className={m.result === 'win' ? 'win' : 'loss'}>{m.result === 'win' ? 'W' : 'L'}</td>
      <td>{m.allyCompLabel}</td><td>{m.enemyCompLabel}</td><td>{m.mapName}</td>
      <td>{fmtRating(m.cr, m.crDelta)}</td><td>{fmtRating(m.rating, m.ratingDelta)}</td>
      <td>{fmtNum(m.damageDone)}</td><td>{fmtNum(m.dps)}</td><td>{fmtNum(m.interruptsLanded)}</td>
    </tr>
  );
}

export function MatchTable({ matches, sessions, selectedId, onSelect, sort, onSort }: Props) {
  if (matches.length === 0) return <div className="empty">No matches yet — run <code>npm run ingest-db</code>.</div>;

  const sessionOrder = new Map(sessions.map((s, i) => [s.id, i]));
  const sessRank = (k: string) => sessionOrder.get(k) ?? sessions.length;
  const byVersion = new Map<string, MatchSummary[]>();
  for (const m of matches) { const v = m.buildVersion || '—'; if (!byVersion.has(v)) byVersion.set(v, []); byVersion.get(v)!.push(m); }

  const sum = (f: (m: MatchSummary) => number | null) => matches.reduce((a, m) => a + (f(m) ?? 0), 0);
  const n = matches.length;
  const wins = matches.filter((m) => m.result === 'win').length;

  return (
    <table className="matches">
      <thead><tr>
        {COLS.map((c) => (
          <th key={c.key} className={c.sortable ? 'sortable' : ''} onClick={c.sortable ? () => onSort(c.key) : undefined}>
            {c.label}{sort?.col === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
          </th>
        ))}
      </tr></thead>
      <tbody>
        {[...byVersion.entries()].flatMap(([version, vMatches]) => {
          const bySession = new Map<string, MatchSummary[]>();
          for (const m of vMatches) { const k = m.sessionId ?? '∅'; if (!bySession.has(k)) bySession.set(k, []); bySession.get(k)!.push(m); }
          const groups = [...bySession.keys()].sort((a, b) => sessRank(a) - sessRank(b));
          return [
            <tr key={`v-${version}`} className="vsep"><td colSpan={10}>▾ {version} · {vMatches.length} games</td></tr>,
            ...groups.flatMap((key) => {
              const s = sessions.find((s) => s.id === key);
              return [
                s ? <tr key={`s-${key}`} className="sep"><td colSpan={10}>▸ session · {fmtClock(s.startMs)} · {s.count} games · {s.wins}W–{s.losses}L</td></tr> : null,
                ...sortRows(bySession.get(key)!, sort).map((m) => <Row key={m.matchId} m={m} selectedId={selectedId} onSelect={onSelect} />),
              ];
            }),
          ];
        })}
      </tbody>
      <tfoot>
        <tr className="totals"><td>Σ</td><td>{wins}W–{n - wins}L</td><td colSpan={3} /><td></td><td></td><td>{fmtNum(sum((m) => m.damageDone))}</td><td>{fmtNum(sum((m) => m.dps))}</td><td>{fmtNum(sum((m) => m.interruptsLanded))}</td></tr>
        <tr className="totals"><td>avg</td><td colSpan={4} /><td>{fmtNum(Math.round(sum((m) => m.cr) / n))}</td><td>{fmtNum(Math.round(sum((m) => m.rating) / n))}</td><td>{fmtNum(sum((m) => m.damageDone) / n)}</td><td>{fmtNum(sum((m) => m.dps) / n)}</td><td>{fmtNum(sum((m) => m.interruptsLanded) / n)}</td></tr>
      </tfoot>
    </table>
  );
}
