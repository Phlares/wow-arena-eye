import { render, fireEvent } from '@testing-library/react';
import { RangeTrack } from './RangeTrack.js';
import type { RangeTarget } from '../api.js';

const targets: RangeTarget[] = [
  { unitId: 'E', name: 'Foe', className: 'Mage', team: 'enemy', isHealer: false, isPrimaryThreat: true, series: [{ tSec: 0, dist: 10 }, { tSec: 1, dist: 12 }] },
  { unitId: 'H', name: 'Healz', className: 'Priest', team: 'friendly', isHealer: true, isPrimaryThreat: false, series: [{ tSec: 0, dist: 25 }, { tSec: 1, dist: 28 }] },
  { unitId: '__anchor__', name: 'Demon Circle (port)', className: '', team: 'friendly', isHealer: false, isPrimaryThreat: false, series: [{ tSec: 0, dist: 5 }] },
];

it('renders a chip per target, defaults to the primary threat only', () => {
  const { container } = render(<RangeTrack targets={targets} matchEnd={1} />);
  const chips = [...container.querySelectorAll('button.range-chip')];
  expect(chips.length).toBe(3);
  expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
  expect(container.querySelectorAll('polyline').length).toBe(1); // only the primary threat's path
});

it('superimposes paths as chips are toggled on, and removes them when toggled off', () => {
  const { container, getByRole } = render(<RangeTrack targets={targets} matchEnd={1} />);
  fireEvent.click(getByRole('button', { name: /Healz/ }));
  expect(container.querySelectorAll('polyline').length).toBe(2);  // Foe + Healz superimposed
  fireEvent.click(getByRole('button', { name: /Foe/ }));
  expect(container.querySelectorAll('polyline').length).toBe(1);  // Healz only
});

it('draws the labeled range cut-offs (8/10/20/30/40 yd) as dotted lines', () => {
  const { container, getByText } = render(<RangeTrack targets={targets} matchEnd={1} />);
  expect(container.querySelectorAll('line.ts-threshold').length).toBe(4 + 1);
  expect(getByText(/8.*melee/i)).toBeInTheDocument();
  expect(getByText('40')).toBeInTheDocument();
});

it('falls back to the plain series when no targets exist (old stored matches)', () => {
  const { container } = render(<RangeTrack series={[{ tSec: 0, dist: 30 }, { tSec: 1, dist: 5 }]} matchEnd={1} />);
  expect(container.querySelectorAll('polyline').length).toBe(1);
});

it('breaks a path across null gaps (no interpolation through unknown range)', () => {
  const { container } = render(<RangeTrack series={[{ tSec: 0, dist: 10 }, { tSec: 1, dist: null }, { tSec: 2, dist: 20 }]} matchEnd={2} />);
  expect(container.querySelectorAll('polyline').length).toBe(2);
});
