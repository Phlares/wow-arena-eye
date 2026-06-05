import { render, screen } from '@testing-library/react';
import { SummaryDrawer } from './SummaryDrawer.js';
import type { MatchSummary } from '../api.js';

const m: MatchSummary = { matchId: 'A', startMs: 1000, durationSec: 161, bracket: '3v3', character: 'Me-R',
  mapId: '2547', mapName: 'Enigma Crucible', allyComp: 'x', allyCompLabel: 'WLS', enemyComp: 'y', enemyCompLabel: 'RMP',
  rating: 2008, ratingDelta: -12, result: 'loss', sessionId: 'A', damageDone: 4_200_000, dps: 26_100, interruptsLanded: 3 };

it('renders nothing when no match is selected', () => {
  const { container } = render(<SummaryDrawer match={null} />);
  expect(container).toBeEmptyDOMElement();
});
it('shows matchup, map, rating, duration and stats for the selected match', () => {
  render(<SummaryDrawer match={m} />);
  expect(screen.getByText(/WLS vs RMP/)).toBeInTheDocument();
  expect(screen.getByText('Enigma Crucible')).toBeInTheDocument();
  expect(screen.getByText('2:41')).toBeInTheDocument();
  expect(screen.getByText('4.2M')).toBeInTheDocument();
  expect(screen.getByText(/full detail/i)).toBeInTheDocument(); // inert affordance for sub-project B
});
