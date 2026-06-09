import { render, screen } from '@testing-library/react';
import { Settings } from './Settings.js';
import type { MetadataView } from '../api.js';

const meta: MetadataView = {
  offensive: [
    { id: 360194, name: 'Deathmark', cooldownSec: 120, kind: 'debuff' },
    { id: 205180, name: 'Summon Darkglare', cooldownSec: 120, kind: 'pet-summon', windowSec: 20 },
    { id: 107574, name: 'Avatar' },
  ],
  denied: [{ id: 36554, name: 'Shadowstep', reason: 'mobility, not a burst marker' }],
  cc: [{ id: 6358, name: 'Seduction', category: 'disorient' }],
  defensives: [{ id: 104773, cooldownSec: 180, category: 'defensive' }],
};

it('renders grouped read-only tables from the metadata view', () => {
  render(<Settings meta={meta} />);
  expect(screen.getByText(/Offensive CDs \(3\)/)).toBeInTheDocument();
  expect(screen.getByText('Deathmark')).toBeInTheDocument();
  expect(screen.getByText('Summon Darkglare')).toBeInTheDocument();
  expect(screen.getByText(/pet-summon/)).toBeInTheDocument();
  expect(screen.getByText(/Excluded \(1\)/)).toBeInTheDocument();
  expect(screen.getByText('Shadowstep')).toBeInTheDocument();
  expect(screen.getByText(/mobility, not a burst marker/)).toBeInTheDocument();
  expect(screen.getByText('Seduction')).toBeInTheDocument();
  expect(screen.getByText('104773')).toBeInTheDocument();
});
