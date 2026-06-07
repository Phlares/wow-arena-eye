import { render, screen, waitFor } from '@testing-library/react';
import { ComparePanel } from './ComparePanel.js';
import * as api from '../api.js';

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  fetchScorecard: vi.fn(),
}));

const fixture: api.Scorecard = {
  matchId: 'M1', cohort: { description: 'Overall', n: 14, wins: 9, losses: 5 },
  metrics: [{ id: 'damageDone', label: 'Damage done', polarity: 'higher-better', value: 1_000_000, mean: 900_000, stdev: 1, n: 14, z: 1, verdict: 'better', seasonBest: null, isNewBest: false, winLikeness: 'win-like' }],
};

it('fetches and renders the scorecard table with the default Overall baseline', async () => {
  (api.fetchScorecard as ReturnType<typeof vi.fn>).mockResolvedValue(fixture);
  render(<ComparePanel matchId="M1" />);
  await waitFor(() => expect(screen.getByText('Damage done')).toBeInTheDocument());
  expect(api.fetchScorecard).toHaveBeenCalledWith('M1', expect.objectContaining({ mode: 'overall' }));
});

it('shows a not-in-store message when the match has no scorecard', async () => {
  (api.fetchScorecard as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not-in-store'));
  render(<ComparePanel matchId="M9" />);
  await waitFor(() => expect(screen.getByText(/not in the store/i)).toBeInTheDocument());
});
