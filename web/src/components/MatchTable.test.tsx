import { render, screen, fireEvent } from '@testing-library/react';
import { MatchTable } from './MatchTable.js';
import type { MatchSummary, SessionSummary } from '../api.js';

function m(over: Partial<MatchSummary>): MatchSummary {
  return { matchId: 'A', startMs: 1000, durationSec: 120, bracket: '3v3', character: 'Me-R', mapId: '2547',
    mapName: 'Enigma Crucible', allyComp: 'x', allyCompLabel: 'WLS', enemyComp: 'y', enemyCompLabel: 'RMP',
    rating: 2000, ratingDelta: 10, cr: 1800, crDelta: 14, buildVersion: '12.0.5',
    result: 'win', sessionId: 'A', damageDone: 4_200_000, dps: 26_000,
    interruptsLanded: 3, ...over };
}
const sessions: SessionSummary[] = [{ id: 'A', startMs: 1000, endMs: 2000, count: 2, wins: 1, losses: 1, ratingStart: 2000, ratingEnd: 2016, comps: ['WLS'] }];

it('renders a session header row and its matches, no Deaths column', () => {
  render(<MatchTable matches={[m({ matchId: 'A' }), m({ matchId: 'B', result: 'loss', ratingDelta: -12, mapName: 'Dalaran Sewers', damageDone: 3_800_000 })]} sessions={sessions} selectedId={null} onSelect={() => {}} sort={null} onSort={() => {}} />);
  expect(screen.getAllByText(/1W–1L/).length).toBeGreaterThan(0);
  expect(screen.getByText('Enigma Crucible')).toBeInTheDocument();
  expect(screen.queryByText('Deaths')).toBeNull();
  expect(screen.getByText('4.2M')).toBeInTheDocument();
});

it('clicking a row calls onSelect with the match id', () => {
  const onSelect = vi.fn();
  render(<MatchTable matches={[m({ matchId: 'A' })]} sessions={sessions} selectedId={null} onSelect={onSelect} sort={null} onSort={() => {}} />);
  fireEvent.click(screen.getByText('Enigma Crucible'));
  expect(onSelect).toHaveBeenCalledWith('A');
});

it('shows an empty state when there are no matches', () => {
  render(<MatchTable matches={[]} sessions={[]} selectedId={null} onSelect={() => {}} sort={null} onSort={() => {}} />);
  expect(screen.getByText(/No matches/i)).toBeInTheDocument();
});

it('places unsessioned (∅ bucket) matches after sessioned ones', () => {
  const matches = [
    m({ matchId: 'A', sessionId: 'A', mapName: 'Enigma Crucible' }),
    m({ matchId: 'Z', sessionId: null, mapName: 'Black Rook Hold' }),
  ];
  render(<MatchTable matches={matches} sessions={sessions} selectedId={null} onSelect={() => {}} sort={null} onSort={() => {}} />);
  const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
  const sessioned = rows.findIndex((t) => t.includes('Enigma Crucible'));
  const unsessioned = rows.findIndex((t) => t.includes('Black Rook Hold'));
  expect(sessioned).toBeLessThan(unsessioned);
});

it('applies the sel class to the selected row', () => {
  render(<MatchTable matches={[m({ matchId: 'A' })]} sessions={sessions} selectedId={'A'} onSelect={() => {}} sort={null} onSort={() => {}} />);
  expect(screen.getByText('Enigma Crucible').closest('tr')).toHaveClass('sel');
});

it('renders em dashes for null rating/damage/kicks', () => {
  render(<MatchTable matches={[m({ matchId: 'A', rating: null, ratingDelta: null, damageDone: null, interruptsLanded: null })]} sessions={sessions} selectedId={null} onSelect={() => {}} sort={null} onSort={() => {}} />);
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});

it('shows a version fold header and a sum/avg totals footer', () => {
  render(<MatchTable matches={[m({ matchId: 'A', damageDone: 4_000_000 }), m({ matchId: 'B', damageDone: 2_000_000 })]}
    sessions={sessions} selectedId={null} onSelect={() => {}} sort={null} onSort={() => {}} />);
  expect(screen.getByText(/12\.0\.5/)).toBeInTheDocument();   // version fold
  expect(screen.getByText('Σ')).toBeInTheDocument();          // sum row
  expect(screen.getByText('6.0M')).toBeInTheDocument();       // 4M + 2M sum
  expect(screen.getByText('avg')).toBeInTheDocument();
  expect(screen.getByText('3.0M')).toBeInTheDocument();       // avg
});

it('shows CR/MMR averages as raw ratings, not k-abbreviated', () => {
  render(<MatchTable matches={[m({ matchId: 'A', cr: 1800 }), m({ matchId: 'B', cr: 1820 })]}
    sessions={sessions} selectedId={null} onSelect={() => {}} sort={null} onSort={() => {}} />);
  expect(screen.getByText('1810')).toBeInTheDocument(); // (1800+1820)/2 raw, not '1.8k'
});
it('shows the sort indicator on the active column header', () => {
  render(<MatchTable matches={[m({ matchId: 'A' })]} sessions={sessions} selectedId={null} onSelect={() => {}}
    sort={{ col: 'damageDone', dir: 'desc' }} onSort={() => {}} />);
  expect(screen.getByText(/Dmg ▼/)).toBeInTheDocument();
});
it('renders a separate version fold per build_version', () => {
  render(<MatchTable matches={[m({ matchId: 'A', buildVersion: '12.0.5' }), m({ matchId: 'B', buildVersion: '12.1.0', sessionId: null })]}
    sessions={sessions} selectedId={null} onSelect={() => {}} sort={null} onSort={() => {}} />);
  expect(screen.getByText(/12\.0\.5/)).toBeInTheDocument();
  expect(screen.getByText(/12\.1\.0/)).toBeInTheDocument();
});

// Two sessions, neutral order = [B, A] (B uppermost). A is the chronologically older session.
const twoSessions: SessionSummary[] = [
  { id: 'B', startMs: 3000, endMs: 4000, count: 1, wins: 1, losses: 0, ratingStart: null, ratingEnd: null, comps: [] },
  { id: 'A', startMs: 1000, endMs: 2000, count: 1, wins: 1, losses: 0, ratingStart: null, ratingEnd: null, comps: [] },
];
it('reorders sessions chronologically under a When-ascending sort', () => {
  const matches = [
    m({ matchId: 'b1', sessionId: 'B', startMs: 3000, mapName: 'Black Rook Hold' }),
    m({ matchId: 'a1', sessionId: 'A', startMs: 1000, mapName: 'Enigma Crucible' }),
  ];
  render(<MatchTable matches={matches} sessions={twoSessions} selectedId={null} onSelect={() => {}}
    sort={{ col: 'startMs', dir: 'asc' }} onSort={() => {}} />);
  const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
  // older session A (Enigma) must rise above newer session B (Black Rook), not stay in neutral [B,A] order
  expect(rows.findIndex((t) => t.includes('Enigma Crucible'))).toBeLessThan(rows.findIndex((t) => t.includes('Black Rook Hold')));
});
it('reorders sessions by a metric sort, highest-leading session first', () => {
  // neutral order is [B, A] (Black Rook first); the higher-damage session A must override that under Dmg↓
  const matches = [
    m({ matchId: 'a1', sessionId: 'A', mapName: 'Enigma Crucible', damageDone: 5_000_000 }),
    m({ matchId: 'b1', sessionId: 'B', mapName: 'Black Rook Hold', damageDone: 2_000_000 }),
  ];
  render(<MatchTable matches={matches} sessions={twoSessions} selectedId={null} onSelect={() => {}}
    sort={{ col: 'damageDone', dir: 'desc' }} onSort={() => {}} />);
  const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
  expect(rows.findIndex((t) => t.includes('Enigma Crucible'))).toBeLessThan(rows.findIndex((t) => t.includes('Black Rook Hold')));
});
