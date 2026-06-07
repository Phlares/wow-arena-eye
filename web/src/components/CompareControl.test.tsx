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

it('shows the N selector only outside Overall mode', () => {
  const { rerender } = render(<CompareControl baseline={{ mode: 'overall' }} onChange={() => {}} />);
  expect(screen.queryByRole('combobox')).toBeNull();
  rerender(<CompareControl baseline={{ mode: 'games', n: 20 } as BaselineQuery} onChange={() => {}} />);
  expect(screen.getByRole('combobox')).toBeInTheDocument();
});
