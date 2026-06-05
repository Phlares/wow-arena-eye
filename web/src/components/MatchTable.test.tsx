import { render, screen, fireEvent } from '@testing-library/react';
import { MatchTable } from './MatchTable.js';
import type { MatchSummary, SessionSummary } from '../api.js';

function m(over: Partial<MatchSummary>): MatchSummary {
  return { matchId: 'A', startMs: 1000, durationSec: 120, bracket: '3v3', character: 'Me-R', mapId: '2547',
    mapName: 'Enigma Crucible', allyComp: 'x', allyCompLabel: 'WLS', enemyComp: 'y', enemyCompLabel: 'RMP',
    rating: 2000, ratingDelta: 14, result: 'win', sessionId: 'A', damageDone: 4_200_000, dps: 26_000,
    interruptsLanded: 3, ...over };
}
const sessions: SessionSummary[] = [{ id: 'A', startMs: 1000, endMs: 2000, count: 2, wins: 1, losses: 1, ratingStart: 2000, ratingEnd: 2016, comps: ['WLS'] }];

it('renders a session header row and its matches, no Deaths column', () => {
  render(<MatchTable matches={[m({ matchId: 'A' }), m({ matchId: 'B', result: 'loss', ratingDelta: -12, mapName: 'Dalaran Sewers', damageDone: 3_800_000 })]} sessions={sessions} selectedId={null} onSelect={() => {}} />);
  expect(screen.getByText(/1W–1L/)).toBeInTheDocument();
  expect(screen.getByText('Enigma Crucible')).toBeInTheDocument();
  expect(screen.queryByText('Deaths')).toBeNull();
  expect(screen.getByText('4.2M')).toBeInTheDocument();
});

it('clicking a row calls onSelect with the match id', () => {
  const onSelect = vi.fn();
  render(<MatchTable matches={[m({ matchId: 'A' })]} sessions={sessions} selectedId={null} onSelect={onSelect} />);
  fireEvent.click(screen.getByText('Enigma Crucible'));
  expect(onSelect).toHaveBeenCalledWith('A');
});

it('shows an empty state when there are no matches', () => {
  render(<MatchTable matches={[]} sessions={[]} selectedId={null} onSelect={() => {}} />);
  expect(screen.getByText(/No matches/i)).toBeInTheDocument();
});

it('places unsessioned (∅ bucket) matches after sessioned ones', () => {
  const matches = [
    m({ matchId: 'A', sessionId: 'A', mapName: 'Enigma Crucible' }),
    m({ matchId: 'Z', sessionId: null, mapName: 'Black Rook Hold' }),
  ];
  render(<MatchTable matches={matches} sessions={sessions} selectedId={null} onSelect={() => {}} />);
  const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
  const sessioned = rows.findIndex((t) => t.includes('Enigma Crucible'));
  const unsessioned = rows.findIndex((t) => t.includes('Black Rook Hold'));
  expect(sessioned).toBeLessThan(unsessioned);
});

it('applies the sel class to the selected row', () => {
  render(<MatchTable matches={[m({ matchId: 'A' })]} sessions={sessions} selectedId={'A'} onSelect={() => {}} />);
  expect(screen.getByText('Enigma Crucible').closest('tr')).toHaveClass('sel');
});

it('renders em dashes for null rating/damage/kicks', () => {
  render(<MatchTable matches={[m({ matchId: 'A', rating: null, ratingDelta: null, damageDone: null, interruptsLanded: null })]} sessions={sessions} selectedId={null} onSelect={() => {}} />);
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});
