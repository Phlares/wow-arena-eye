import { render, screen } from '@testing-library/react';
import { Roster } from './Roster.js';
import type { RosterEntry } from '../api.js';

const roster: RosterEntry[] = [
  { name: 'Me', className: 'Warlock', specLabel: 'Affliction', team: 'friendly', isHealer: false },
  { name: 'Healz', className: 'Priest', specLabel: 'Discipline', team: 'friendly', isHealer: true },
  { name: 'Foe', className: 'Mage', specLabel: 'Frost', team: 'enemy', isHealer: false },
];

it('renders class-colored chips with specs, healer marked, grouped by team', () => {
  render(<Roster roster={roster} />);
  expect(screen.getByText('Me')).toBeInTheDocument();
  expect(screen.getByText(/Affliction/)).toBeInTheDocument();
  expect(screen.getByText('Foe').closest('.roster-chip')).toBeTruthy();
  expect(screen.getByText('Healz').closest('.roster-chip')).toHaveClass('healer');
});
