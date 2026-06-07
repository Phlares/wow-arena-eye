import { render, screen, fireEvent } from '@testing-library/react';
import { CompareControl } from './CompareControl.js';
import type { BaselineQuery } from '../api.js';

it('emits mode and filter changes', () => {
  const onChange = vi.fn();
  render(<CompareControl baseline={{ mode: 'overall' }} onChange={onChange} />);
  fireEvent.click(screen.getByText('Past games'));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'games' }));
  fireEvent.click(screen.getByText('Same comp'));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ comp: true }));
});

it('resets N to the mode default when switching games↔sessions (no stale out-of-range N)', () => {
  const onChange = vi.fn();
  render(<CompareControl baseline={{ mode: 'games', n: 50 } as BaselineQuery} onChange={onChange} />);
  fireEvent.click(screen.getByText('Past sessions'));
  // 50 is not a valid session count — must reset to the sessions default, not carry 50 over
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'sessions', n: 1 }));
});

it('shows the N selector only outside Overall mode', () => {
  const { rerender } = render(<CompareControl baseline={{ mode: 'overall' }} onChange={() => {}} />);
  expect(screen.queryByRole('combobox')).toBeNull();
  rerender(<CompareControl baseline={{ mode: 'games', n: 20 } as BaselineQuery} onChange={() => {}} />);
  expect(screen.getByRole('combobox')).toBeInTheDocument();
});
