import { render, screen, fireEvent } from '@testing-library/react';
import { FilterRail } from './FilterRail.js';
import type { FilterOptions } from '../api.js';

const opts: FilterOptions = {
  characters: ['Me-R', 'Alt-R'], brackets: ['3v3', '2v2'],
  myComps: [{ value: '105_265', label: 'Resto·Affli' }],
  enemyComps: [{ value: '62_64', label: 'Arcane·Frost' }],
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
