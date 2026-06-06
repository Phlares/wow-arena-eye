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
  { key: 'interruptsSuffered', label: 'Taken', sortable: true, num: (m) => m.interruptsSuffered },
];

/** The numeric accessor for a sortable column, defaulting to chronological (startMs). */
const colGetter = (col: string): ((m: MatchSummary) => number | null) =>
  COLS.find((c) => c.key === col)?.num ?? ((m) => m.startMs);

function sortRows(rows: MatchSummary[], sort: Props['sort']): MatchSummary[] {
  if (!sort) return rows;
  const f = colGetter(sort.col);
  const out = [...rows].sort((a, b) => ((f(a) ?? -Infinity) - (f(b) ?? -Infinity)));
  return sort.dir === 'desc' ? out.reverse() : out;
}

/** A session fold's rank value under an active sort: the value of its leading row in the sort
 *  direction (max for desc, min for asc) — so a session sorts by the row that would top it. */
function sessionRank(rows: MatchSummary[], sort: NonNullable<Props['sort']>): number {
  const f = colGetter(sort.col);
  const vals = rows.map((m) => f(m) ?? -Infinity);
  return sort.dir === 'desc' ? Math.max(...vals) : Math.min(...vals);
}

function Row({ m, selectedId, onSelect }: { m: MatchSummary; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <tr className={m.matchId === selectedId ? 'sel' : ''} onClick={() => onSelect(m.matchId)}>
      <td>{fmtClock(m.startMs)}</td>
      <td className={m.result === 'win' ? 'win' : 'loss'}>{m.result === 'win' ? 'W' : 'L'}</td>
      <td>{m.allyCompLabel}</td><td>{m.enemyCompLabel}</td><td>{m.mapName}</td>
      <td>{fmtRating(m.cr, m.crDelta)}</td><td>{fmtRating(m.rating, m.ratingDelta)}</td>
      <td>{fmtNum(m.damageDone)}</td><td>{fmtNum(m.dps)}</td><td>{fmtNum(m.interruptsLanded)}</td><td>{fmtNum(m.interruptsSuffered)}</td>
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
  const avg = (f: (m: MatchSummary) => number | null) => {
    const vals = matches.map(f).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const avgRating = (f: (m: MatchSummary) => number | null) => { const a = avg(f); return a === null ? null : Math.round(a); };

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
          // Patches (version folds) keep their fixed order; sessions within a patch reorder under an
          // active sort (by their leading row) so the sort is coherent across folds, not just within one.
          // The unsessioned '∅' bucket always sinks last.
          const groups = [...bySession.keys()].sort((a, b) => {
            if (a === '∅' || b === '∅') return a === '∅' ? 1 : -1;
            if (!sort) return sessRank(a) - sessRank(b);
            const ra = sessionRank(bySession.get(a)!, sort), rb = sessionRank(bySession.get(b)!, sort);
            return sort.dir === 'desc' ? rb - ra : ra - rb;
          });
          return [
            <tr key={`v-${version}`} className="vsep"><td colSpan={COLS.length}>▾ {version} · {vMatches.length} games</td></tr>,
            ...groups.flatMap((key) => {
              const s = sessions.find((s) => s.id === key);
              return [
                s ? <tr key={`s-${key}`} className="sep"><td colSpan={COLS.length}>▸ session · {fmtClock(s.startMs)} · {s.count} games · {s.wins}W–{s.losses}L</td></tr> : null,
                ...sortRows(bySession.get(key)!, sort).map((m) => <Row key={m.matchId} m={m} selectedId={selectedId} onSelect={onSelect} />),
              ];
            }),
          ];
        })}
      </tbody>
      <tfoot>
        <tr className="totals"><td>Σ</td><td>{wins}W–{n - wins}L</td><td colSpan={3} /><td></td><td></td><td>{fmtNum(sum((m) => m.damageDone))}</td><td>{fmtNum(sum((m) => m.dps))}</td><td>{fmtNum(sum((m) => m.interruptsLanded))}</td><td>{fmtNum(sum((m) => m.interruptsSuffered))}</td></tr>
        <tr className="totals"><td>avg</td><td colSpan={4} /><td>{fmtRating(avgRating((m) => m.cr), null)}</td><td>{fmtRating(avgRating((m) => m.rating), null)}</td><td>{fmtNum(avg((m) => m.damageDone))}</td><td>{fmtNum(avg((m) => m.dps))}</td><td>{fmtNum(avg((m) => m.interruptsLanded))}</td><td>{fmtNum(avg((m) => m.interruptsSuffered))}</td></tr>
      </tfoot>
    </table>
  );
}
