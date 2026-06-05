import { render, screen, fireEvent } from '@testing-library/react';
import { FilterRail } from './FilterRail.js';
import type { FilterOptions } from '../api.js';

const opts: FilterOptions = {
  characters: ['Me-R', 'Alt-R'], brackets: ['3v3', '2v2'],
  myComps: [{ value: '105_265', label: 'Resto·Affli' }],
  enemyComps: [{ value: '62_64', label: 'Arcane·Frost' }],
  classSpecTree: [{ className: 'Warlock', specs: [{ id: '265', specName: 'Affliction' }] }],
  maps: [{ value: '2547', label: 'Enigma Crucible' }],
  ratingRange: { min: 1900, max: 2100 }, dateRange: null,
};

it('renders character and bracket options and reports changes', () => {
  const onChange = vi.fn();
  render(<FilterRail options={opts} filters={{}} onChange={onChange} />);
  expect(screen.getByText('Enigma Crucible')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Character'), { target: { value: 'Me-R' } });
  expect(onChange).toHaveBeenCalledWith({ character: 'Me-R' });
});

it('toggling a result checkbox updates the filter', () => {
  const onChange = vi.fn();
  render(<FilterRail options={opts} filters={{ result: 'win' }} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText('Loss'));
  expect(onChange).toHaveBeenCalledWith({ result: '' }); // win+loss = no filter
});

it('reports a search-box change', () => {
  const onChange = vi.fn();
  render(<FilterRail options={opts} filters={{}} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'druid' } });
  expect(onChange).toHaveBeenCalledWith({ q: 'druid' });
});

it('from both-on, toggling Win narrows to loss-only', () => {
  const onChange = vi.fn();
  render(<FilterRail options={opts} filters={{}} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText('Win'));
  expect(onChange).toHaveBeenCalledWith({ result: 'loss' });
});

it('a non-character dropdown (Map) reports its key', () => {
  const onChange = vi.fn();
  render(<FilterRail options={opts} filters={{}} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Map'), { target: { value: '2547' } });
  expect(onChange).toHaveBeenCalledWith({ map: '2547' });
});

it('renders the My team and Enemy comp trees and forwards their params', () => {
  const onChange = vi.fn();
  render(<FilterRail options={opts} filters={{}} onChange={onChange} />);
  expect(screen.getByText(/My team:/)).toBeInTheDocument();
  expect(screen.getByText(/Enemy:/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Enemy/ }));
  fireEvent.click(screen.getByLabelText('Warlock'));
  expect(onChange).toHaveBeenCalledWith({ enemyClasses: 'Warlock', enemySpecs: '' });
});
