import { render, screen } from '@testing-library/react';
import { SummaryDrawer } from './SummaryDrawer.js';
import type { MatchSummary } from '../api.js';

const m: MatchSummary = { matchId: 'A', startMs: 1000, durationSec: 161, bracket: '3v3', character: 'Me-R',
  mapId: '2547', mapName: 'Enigma Crucible', allyComp: 'x', allyCompLabel: 'WLS', enemyComp: 'y', enemyCompLabel: 'RMP',
  rating: 2008, ratingDelta: -12, cr: null, crDelta: null, buildVersion: '12.0.5',
  result: 'loss', sessionId: 'A', damageDone: 4_200_000, dps: 26_100, interruptsLanded: 3,
  interruptsSuffered: 1, precognitionUptimeSec: null, enemyPrecognitionUptimeSec: null };

it('renders nothing when no match is selected', () => {
  const { container } = render(<SummaryDrawer match={null} onOpenDetail={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});
it('shows matchup, map, rating, duration and stats for the selected match', () => {
  render(<SummaryDrawer match={m} onOpenDetail={() => {}} />);
  expect(screen.getByText(/WLS vs RMP/)).toBeInTheDocument();
  expect(screen.getByText('Enigma Crucible')).toBeInTheDocument();
  expect(screen.getByText('2:41')).toBeInTheDocument();
  expect(screen.getByText('4.2M')).toBeInTheDocument();
  expect(screen.getByText(/full detail/i)).toBeInTheDocument(); // inert affordance for sub-project B
});
it('shows CR and MMR as separate rows, each with its chronological delta', () => {
  render(<SummaryDrawer match={{ ...m, cr: 1834, crDelta: 8 }} onOpenDetail={() => {}} />);
  expect(screen.getByText('CR')).toBeInTheDocument();
  expect(screen.getByText('1834 +8')).toBeInTheDocument();
  expect(screen.getByText('MMR')).toBeInTheDocument();
  expect(screen.getByText('2008 −12')).toBeInTheDocument(); // U+2212 minus, per fmtRatingDelta
});
it('shows kicks taken and both Precognition uptimes', () => {
  render(<SummaryDrawer match={{ ...m, interruptsSuffered: 2, precognitionUptimeSec: 6.2, enemyPrecognitionUptimeSec: 12.4 }} onOpenDetail={() => {}} />);
  expect(screen.getByText('Kicks taken')).toBeInTheDocument();
  expect(screen.getByText('Precognition (you)')).toBeInTheDocument();
  expect(screen.getByText('6.2s')).toBeInTheDocument();
  expect(screen.getByText('Precognition (enemy)')).toBeInTheDocument();
  expect(screen.getByText('12.4s')).toBeInTheDocument();
});
it('shows the result badge with its color and em-dashes null stats', () => {
  render(<SummaryDrawer match={{ ...m, result: 'win', rating: null, ratingDelta: null, interruptsLanded: null }} onOpenDetail={() => {}} />);
  expect(screen.getByText('WIN')).toHaveClass('win');
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});
