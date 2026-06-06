import { render } from '@testing-library/react';
import { RangeLane } from './RangeLane.js';

it('plots a polyline from the range series and a melee reference line', () => {
  const { container } = render(<RangeLane series={[{ tSec: 0, dist: 30 }, { tSec: 1, dist: 5 }, { tSec: 2, dist: null }]} matchEnd={2} />);
  expect(container.querySelector('polyline')).toBeTruthy();        // the distance line
  expect(container.querySelector('line.melee-ref')).toBeTruthy();  // 8yd reference
});

it('breaks the polyline across null gaps (no interpolation through unknown range)', () => {
  const { container } = render(<RangeLane series={[{ tSec: 0, dist: 10 }, { tSec: 1, dist: null }, { tSec: 2, dist: 20 }]} matchEnd={2} />);
  expect(container.querySelectorAll('polyline').length).toBe(2);   // two segments, gap in the middle
});
