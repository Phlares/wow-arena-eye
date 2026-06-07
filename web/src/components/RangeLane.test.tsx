import { render, fireEvent } from '@testing-library/react';
import { RangeLane } from './RangeLane.js';
import type { RangeTarget } from '../api.js';

it('plots a polyline from the range series and a melee reference line', () => {
  const { container, getByText } = render(<RangeLane series={[{ tSec: 0, dist: 30 }, { tSec: 1, dist: 5 }, { tSec: 2, dist: null }]} matchEnd={2} />);
  expect(container.querySelector('polyline')).toBeTruthy();        // the distance line
  expect(container.querySelector('line.melee-ref')).toBeTruthy();  // 8yd reference
  expect(getByText(/Range to/)).toBeInTheDocument();               // labeled with its target
});

it('breaks the polyline across null gaps (no interpolation through unknown range)', () => {
  const { container } = render(<RangeLane series={[{ tSec: 0, dist: 10 }, { tSec: 1, dist: null }, { tSec: 2, dist: 20 }]} matchEnd={2} />);
  expect(container.querySelectorAll('polyline').length).toBe(2);   // two segments, gap in the middle
});

const targets: RangeTarget[] = [
  { unitId: 'E', name: 'Foe', className: 'Mage', team: 'enemy', isHealer: false, isPrimaryThreat: true, series: [{ tSec: 0, dist: 10 }, { tSec: 1, dist: 12 }] },
  { unitId: 'H', name: 'Healz', className: 'Priest', team: 'friendly', isHealer: true, isPrimaryThreat: false, series: [{ tSec: 0, dist: 25 }] },
];

it('defaults to the primary threat and re-targets the lane on selection', () => {
  const { container, getByDisplayValue } = render(<RangeLane targets={targets} matchEnd={1} />);
  const select = container.querySelector('select.range-target') as HTMLSelectElement;
  expect(select).toBeTruthy();
  // default-selected = primary threat (Foe), so the lane plots Foe's series (one polyline)
  getByDisplayValue(/Foe/);
  expect(container.querySelectorAll('polyline').length).toBe(1);
  // switch to the healer → the lane re-plots the healer's series
  fireEvent.change(select, { target: { value: 'H' } });
  getByDisplayValue(/Healz/);
});
