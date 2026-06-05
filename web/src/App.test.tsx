import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from './App.js';
import type { FilterOptions, MatchesResponse } from './api.js';

const filters: FilterOptions = { characters: ['Me-R'], brackets: ['3v3'], myComps: [], enemyComps: [],
  classSpecTree: [],
  maps: [{ value: '1825', label: 'Hook Point' }], ratingRange: { min: 1900, max: 2100 }, dateRange: null };
const matches: MatchesResponse = {
  matches: [{ matchId: 'A', startMs: 1000, durationSec: 161, bracket: '3v3', character: 'Me-R', mapId: '2547',
    mapName: 'Enigma Crucible', allyComp: 'x', allyCompLabel: 'WLS', enemyComp: 'y', enemyCompLabel: 'RMP',
    rating: 2008, ratingDelta: -12, cr: null, crDelta: null, buildVersion: '12.0.5',
    result: 'loss', sessionId: 'A', damageDone: 4_200_000, dps: 26_100, interruptsLanded: 3 }],
  sessions: [{ id: 'A', startMs: 1000, endMs: 2000, count: 1, wins: 0, losses: 1, ratingStart: 2008, ratingEnd: 2008, comps: ['WLS'] }],
  total: 1,
};

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = String(url);
    const body = u.includes('/api/filters') ? filters : matches;
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
});

it('loads matches and opens the drawer on row click', async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByText('Enigma Crucible')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Enigma Crucible'));
  await waitFor(() => expect(screen.getByText(/WLS vs RMP/)).toBeInTheDocument());
});

it('clears the open drawer when a filter changes', async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByText('Enigma Crucible')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Enigma Crucible'));
  await waitFor(() => expect(screen.getByText(/WLS vs RMP/)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Character'), { target: { value: 'Me-R' } });
  await waitFor(() => expect(screen.queryByText(/WLS vs RMP/)).toBeNull());
});

it('shows an error banner when the API fails', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
  render(<App />);
  await waitFor(() => expect(screen.getByText(/viewer server running/i)).toBeInTheDocument());
});
