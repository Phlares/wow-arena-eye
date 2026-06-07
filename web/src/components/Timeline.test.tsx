import { render, screen } from '@testing-library/react';
import { Timeline } from './Timeline.js';
import type { MatchDetail } from '../api.js';

const detail: MatchDetail = {
  rangeSeries: [],
  roster: [],
  metrics: {
    playerUnitId: 'P',
    losDisruptors: [{ kind: 'smoke-bomb', startSec: 40 }],
    timeline: [
      { tSec: 5, unitId: 'P', unitName: 'Me', kind: 'cast', spell: 'Shadow Bolt' },
      { tSec: 12, unitId: 'P', unitName: 'Me', kind: 'interrupt', spell: 'Spell Lock', targetId: 'E', targetName: 'Foe' },
      { tSec: 20, unitId: 'E', unitName: 'Foe', kind: 'interrupt', spell: 'Counter', targetId: 'P', targetName: 'Me' },
      { tSec: 30, unitId: 'P', unitName: 'Me', kind: 'cc', spell: 'Fear', extra: 'disorient', targetId: 'E', targetName: 'Foe' },
      { tSec: 95, unitId: 'P', unitName: 'Me', kind: 'death' },
    ],
    offensiveWindows: [
      { startSec: 10, endSec: 18, attackingTeam: 'enemy', defendingTeam: 'friendly', teamDamageTaken: 50000, damageByTarget: [], mitigation: { available: [], used: [] } },
      { startSec: 90, endSec: 98, attackingTeam: 'friendly', defendingTeam: 'enemy', teamDamageTaken: 120000, damageByTarget: [], mitigation: { available: [], used: [] } },
    ],
  },
};

it('renders lane labels and colors GO bands by attacking team', () => {
  const { container } = render(<Timeline detail={detail} onSelectWindow={() => {}} />);
  expect(screen.getByText('Kicks landed')).toBeInTheDocument();
  expect(screen.getByText('Kicks taken')).toBeInTheDocument();
  expect(screen.getByText('CC')).toBeInTheDocument();
  expect(screen.getByText('LoS / smoke')).toBeInTheDocument();
  expect(container.querySelectorAll('.go-band').length).toBe(2);
  expect(screen.getByTestId('go-band-0')).toHaveClass('enemy-go');     // attackingTeam: enemy
  expect(screen.getByTestId('go-band-1')).toHaveClass('friendly-go');  // attackingTeam: friendly
});
