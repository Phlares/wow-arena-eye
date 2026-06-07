import { render, screen } from '@testing-library/react';
import { DetailView } from './DetailView.js';
import type { MatchDetail } from '../api.js';

const empty: MatchDetail = { metrics: { playerUnitId: 'P', timeline: [], offensiveWindows: [], losDisruptors: [] }, rangeSeries: [], roster: [], goTracks: [] };

it('renders a close control', () => {
  render(<DetailView detail={empty} error={null} matchId="M1" onClose={() => {}} />);
  expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
});
it('shows a re-ingest message on the no-detail error', () => {
  render(<DetailView detail={null} error="no-detail" matchId="M1" onClose={() => {}} />);
  expect(screen.getByText(/re-ingest/i)).toBeInTheDocument();
});
