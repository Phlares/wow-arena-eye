import { render, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { TimeSeriesChart, type ChartSeries } from './TimeSeriesChart.js';

const series: ChartSeries[] = [
  { id: 'a', label: 'Foe', color: '#3FC7EB', points: [{ tSec: 0, v: 30 }, { tSec: 10, v: 5 }, { tSec: 20, v: null }, { tSec: 30, v: 12 }] },
  { id: 'b', label: 'Healz', color: '#FFFFFF', points: [{ tSec: 0, v: 25 }, { tSec: 12, v: 18 }] },
];
const thresholds = [
  { value: 8, label: '8 yd' }, { value: 10, label: '10' }, { value: 20, label: '20' },
  { value: 30, label: '30' }, { value: 40, label: '40' },
];

function mockRect(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 1000, height: 220, right: 1000, bottom: 220, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

it('superimposes one polyline group per series, broken across null gaps', () => {
  const { container } = render(<TimeSeriesChart series={series} thresholds={thresholds} matchEnd={40} yMax={40} />);
  // series a: null at t=20 splits it into two segments; series b: one segment → 3 polylines
  expect(container.querySelectorAll('polyline').length).toBe(3);
  const colored = [...container.querySelectorAll('polyline')].map((p) => (p as SVGElement).style.stroke);
  expect(colored.filter((c) => c !== '').length).toBe(3);
});

it('draws a labeled dotted line per threshold', () => {
  const { container, getByText } = render(<TimeSeriesChart series={series} thresholds={thresholds} matchEnd={40} yMax={40} />);
  expect(container.querySelectorAll('line.ts-threshold').length).toBe(5);
  for (const l of container.querySelectorAll('line.ts-threshold')) {
    expect(l.getAttribute('stroke-dasharray')).toBeTruthy();
  }
  expect(getByText('8 yd')).toBeInTheDocument();
  expect(getByText('40')).toBeInTheDocument();
});

it('hover shows the nearest at-or-before timestamp and each series value', () => {
  mockRect();
  const { container, getByTestId } = render(<TimeSeriesChart series={series} thresholds={thresholds} matchEnd={40} yMax={40} unit="yd" />);
  const hover = getByTestId('ts-hover');
  // x=350/1000 → t=14s → series a nearest-before point is t=10 (v=5); series b is t=12 (v=18)
  fireEvent.mouseMove(hover, { clientX: 350 });
  const tip = getByTestId('ts-tooltip');
  expect(tip.textContent).toContain('14.0s');
  expect(tip.textContent).toContain('Foe');
  expect(tip.textContent).toContain('5 yd (10s)');
  expect(tip.textContent).toContain('Healz');
  expect(tip.textContent).toContain('18 yd (12s)');
  fireEvent.mouseLeave(hover);
  expect(container.querySelector('[data-testid="ts-tooltip"]')).toBeNull();
});

it('hover skips a series whose nearest-before value is a null gap', () => {
  mockRect();
  const { getByTestId } = render(<TimeSeriesChart series={series} matchEnd={40} yMax={40} unit="yd" />);
  // t=25s: series a nearest-before point is the t=20 null → series a omitted; series b shows t=12
  fireEvent.mouseMove(getByTestId('ts-hover'), { clientX: 625 });
  const tip = getByTestId('ts-tooltip');
  expect(tip.textContent).not.toContain('Foe');
  expect(tip.textContent).toContain('Healz');
});
