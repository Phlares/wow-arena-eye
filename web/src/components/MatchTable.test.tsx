import { render, screen, fireEvent, within } from '@testing-library/react';
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
