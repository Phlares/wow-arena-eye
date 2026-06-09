import { render, screen } from '@testing-library/react';
import { Timeline } from './Timeline.js';
import type { MatchDetail } from '../api.js';

const detail: MatchDetail = {
  rangeSeries: [],
  rangeTargets: [],
  roster: [],
  goTracks: [],
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
      { startSec: 10, endSec: 18, attackingTeam: 'enemy', defendingTeam: 'friendly', teamDamageTaken: 50000, damageByTarget: [], damageByAttacker: [], mitigation: { available: [], used: [] } },
      { startSec: 90, endSec: 98, attackingTeam: 'friendly', defendingTeam: 'enemy', teamDamageTaken: 120000, damageByTarget: [], damageByAttacker: [], mitigation: { available: [], used: [] } },
    ],
    deathBlows: [
      { victimId: 'P', tSec: 95, recent: [
        { srcName: 'Foe', spell: 'Shadow Bolt', amount: 30000, tSec: 93 },
        { srcName: 'Foe', spell: 'Chaos Bolt', amount: 40000, tSec: 94 },
      ] },
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

// GO-band safety coloring: defender-perspective favorability ratio mapped onto a 5-stop scale.
it('colors GO bands by favorability when offense-available data exists', () => {
  const d: MatchDetail = { ...detail, metrics: { ...detail.metrics, offensiveWindows: [
    // enemy go, our 3 defensives up vs their 0 offense ready → favor 4 → safest (green)
    { startSec: 10, endSec: 18, attackingTeam: 'enemy', defendingTeam: 'friendly', teamDamageTaken: 0, damageByTarget: [], damageByAttacker: [],
      mitigation: { available: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], used: [] }, attackerOffenseAvailableCount: 0 },
    // enemy go, nothing up vs 3 enemy CDs ready → favor 0.25 → most dangerous (red)
    { startSec: 30, endSec: 38, attackingTeam: 'enemy', defendingTeam: 'friendly', teamDamageTaken: 0, damageByTarget: [], damageByAttacker: [],
      mitigation: { available: [], used: [] }, attackerOffenseAvailableCount: 3 },
    // our go, 2 of ours ready vs 2 of their defensives up → favor 1 → neutral (yellow)
    { startSec: 50, endSec: 58, attackingTeam: 'friendly', defendingTeam: 'enemy', teamDamageTaken: 0, damageByTarget: [], damageByAttacker: [],
      mitigation: { available: [{ name: 'x' }, { name: 'y' }], used: [] }, attackerOffenseAvailableCount: 2 },
  ] } };
  render(<Timeline detail={d} onSelectWindow={() => {}} />);
  expect(screen.getByTestId('go-band-0')).toHaveClass('go-favor-4');
  expect(screen.getByTestId('go-band-0').getAttribute('title')).toMatch(/favor 4\.0/);
  expect(screen.getByTestId('go-band-1')).toHaveClass('go-favor-0');
  expect(screen.getByTestId('go-band-2')).toHaveClass('go-favor-2');
});

it('leaves GO bands uncolored when stored data predates offense-available counts', () => {
  render(<Timeline detail={detail} onSelectWindow={() => {}} />);
  const cls = screen.getByTestId('go-band-0').className;
  expect(cls).not.toMatch(/go-favor/);
});

it('death markers carry a hover tooltip of the preceding damage', () => {
  const { container } = render(<Timeline detail={detail} onSelectWindow={() => {}} />);
  const death = container.querySelector('.ev.death') as HTMLElement;
  expect(death).toBeTruthy();
  const title = death.getAttribute('title') ?? '';
  expect(title).toMatch(/Chaos Bolt/);   // what landed in the last ~5s
  expect(title).toMatch(/Shadow Bolt/);
  expect(title).toMatch(/40\.0k/);        // the killing-blow magnitude
});
