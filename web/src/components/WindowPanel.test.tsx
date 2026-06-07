import { render, screen } from '@testing-library/react';
import { WindowPanel } from './WindowPanel.js';
import type { OffensiveWindow } from '../api.js';

const w: OffensiveWindow = {
  startSec: 10, endSec: 18, attackingTeam: 'enemy', defendingTeam: 'friendly', teamDamageTaken: 50000,
  damageByTarget: [{ unitId: 'P', name: 'Me', damage: 40000 }],
  damageByAttacker: [{ unitId: 'E1', name: 'Foe', damage: 45000 }],
  mitigation: { available: [{ name: 'Unending Resolve' }], used: [] },
};

it('shows severity and mitigation available vs used', () => {
  render(<WindowPanel window={w} index={0} />);
  expect(screen.getByText(/GO 1/)).toBeInTheDocument();
  expect(screen.getByText(/50\.0k/)).toBeInTheDocument();            // severity (teamDamageTaken)
  expect(screen.getByText(/By attacker/)).toBeInTheDocument();       // per-attacker damage breakdown
  expect(screen.getByText(/Foe/)).toBeInTheDocument();
  expect(screen.getByText('Unending Resolve')).toBeInTheDocument();  // available mitigation
  expect(screen.getByText(/none used/i)).toBeInTheDocument();        // used is empty
});
