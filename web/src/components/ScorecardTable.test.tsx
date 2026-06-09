import { render, screen } from '@testing-library/react';
import { ScorecardTable } from './ScorecardTable.js';
import type { Scorecard } from '../api.js';

function sc(over: Partial<Scorecard> = {}): Scorecard {
  return {
    matchId: 'M1',
    cohort: { description: 'Past 20 games · same comp', n: 14, wins: 9, losses: 5 },
    metrics: [
      { id: 'damageDone', label: 'Damage done', polarity: 'higher-better', value: 1_600_000, mean: 1_500_000, stdev: 100000, n: 14, z: 1, verdict: 'better', seasonBest: 1_600_000, isNewBest: true, winLikeness: 'win-like' },
      { id: 'avgHealerDistanceYd', label: 'Avg dist from healer (yd)', polarity: 'neutral', value: 21.4, mean: 17.8, stdev: 4, n: 14, z: null, verdict: 'descriptive', seasonBest: null, isNewBest: false, winLikeness: 'loss-like' },
    ],
    ...over,
  };
}

it('renders rate metrics with /min, verdict + win/loss styling, and the season-best star', () => {
  const { container } = render(<ScorecardTable scorecard={sc()} />);
  expect(screen.getAllByText(/\/min/).length).toBeGreaterThan(0);    // damageDone is a rate metric
  expect(screen.getByText(/better/)).toBeInTheDocument();
  expect(screen.getByText(/\+100\.0k/)).toBeInTheDocument();          // signed delta vs avg (1.6M − 1.5M)
  expect(screen.getByText(/win-like/)).toBeInTheDocument();
  expect(screen.getByText(/loss-like/)).toBeInTheDocument();
  expect(container.querySelector('.star')).toBeTruthy();             // isNewBest → ★
  expect(screen.getByText(/info/)).toBeInTheDocument();              // descriptive verdict for healer dist
});

it('shows a small-baseline note when the cohort is below MIN_COHORT', () => {
  render(<ScorecardTable scorecard={sc({ cohort: { description: 'Past 3 games', n: 3, wins: 2, losses: 1 } })} />);
  expect(screen.getByText(/small baseline/i)).toBeInTheDocument();
});
