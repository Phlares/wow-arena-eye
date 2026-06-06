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

it('checking a spec (after expanding its class) emits the spec id', () => {
  const onChange = vi.fn();
  render(<CompFilterTree label="Enemy" tree={tree} specs="" classes="" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /Enemy/ }));
  fireEvent.click(screen.getAllByText('▸')[0]); // expand Death Knight (first class)
  fireEvent.click(screen.getByLabelText('Blood'));
  expect(onChange).toHaveBeenCalledWith({ specs: '250', classes: '' });
});
it('unchecking a selected class removes it from the set', () => {
  const onChange = vi.fn();
  render(<CompFilterTree label="Enemy" tree={tree} specs="" classes="Death Knight" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /Enemy/ }));
  fireEvent.click(screen.getByLabelText('Death Knight')); // already checked -> uncheck
  expect(onChange).toHaveBeenCalledWith({ classes: '', specs: '' });
});
it('adding a second class widens the selection (union)', () => {
  const onChange = vi.fn();
  render(<CompFilterTree label="Enemy" tree={tree} specs="" classes="Warlock" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /Enemy/ }));
  fireEvent.click(screen.getByLabelText('Death Knight'));
  expect(onChange).toHaveBeenCalledWith({ classes: 'Warlock,Death Knight', specs: '' });
});
it('the button shows the selected count', () => {
  render(<CompFilterTree label="Enemy" tree={tree} specs="265" classes="Death Knight" onChange={() => {}} />);
  expect(screen.getByRole('button', { name: /Enemy: 2/ })).toBeInTheDocument();
});
