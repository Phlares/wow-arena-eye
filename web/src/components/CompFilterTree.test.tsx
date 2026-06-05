import { render, screen, fireEvent } from '@testing-library/react';
import { CompFilterTree } from './CompFilterTree.js';
import type { FilterOptions } from '../api.js';

const tree: FilterOptions['classSpecTree'] = [
  { className: 'Death Knight', specs: [{ id: '250', specName: 'Blood' }, { id: '252', specName: 'Unholy' }] },
  { className: 'Warlock', specs: [{ id: '265', specName: 'Affliction' }] },
];

it('checking a class emits its class name; expanding + checking a spec emits the spec id', () => {
  const onChange = vi.fn();
  render(<CompFilterTree label="Enemy" tree={tree} specs="" classes="" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /Enemy/ }));                       // open popover
  fireEvent.click(screen.getByLabelText('Death Knight'));           // class checkbox
  expect(onChange).toHaveBeenCalledWith({ classes: 'Death Knight', specs: '' });
});

it('reflects current selection as a summary on the button', () => {
  render(<CompFilterTree label="Enemy" tree={tree} specs="265" classes="Death Knight" onChange={() => {}} />);
  expect(screen.getByText(/Enemy:/)).toBeInTheDocument();
});
