import { render } from '@testing-library/react';
import { GoTracks } from './GoTracks.js';
import type { GoTrack } from '../api.js';

const tracks: GoTrack[] = [
  { unitId: 'F1', name: 'Me', team: 'friendly', className: 'Warlock', intervals: [{ startSec: 10, endSec: 20 }] },
  { unitId: 'F2', name: 'Ally', team: 'friendly', className: 'Rogue', intervals: [{ startSec: 30, endSec: 40 }] },
  { unitId: 'E1', name: 'Foe1', team: 'enemy', className: 'Mage', intervals: [{ startSec: 12, endSec: 22 }] },
  { unitId: 'E2', name: 'Foe2', team: 'enemy', className: 'Hunter', intervals: [{ startSec: 14, endSec: 24 }] },
];

it('renders enemy tracks above friendly, with class-colored segments', () => {
  const { container } = render(<GoTracks tracks={tracks} matchEnd={60} />);
  const rows = [...container.querySelectorAll('.go-track')];
  expect(rows.length).toBe(4);
  expect(rows[0].textContent).toContain('Foe1');  // enemy attackers on top
  expect(rows[1].textContent).toContain('Foe2');
  expect(rows[2].textContent).toContain('Me');    // friendly attackers below
  expect(container.querySelector('.go-seg')).toBeTruthy();
});
