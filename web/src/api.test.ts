import { vi } from 'vitest';
import { fetchMatches, fetchFilters, type MatchesResponse } from './api.js';

it('fetchMatches builds a query string from non-empty filters and returns JSON', async () => {
  const body: MatchesResponse = { matches: [], sessions: [], total: 0 };
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body)));
  await fetchMatches({ character: 'Me-R', bracket: '3v3', result: '' });
  const url = (spy.mock.calls[0][0] as string);
  expect(url).toContain('/api/matches?');
  expect(url).toContain('character=Me-R');
  expect(url).toContain('bracket=3v3');
  expect(url).not.toContain('result='); // empty omitted
  spy.mockRestore();
});

it('fetchFilters hits /api/filters', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ characters: [] })));
  await fetchFilters();
  expect((spy.mock.calls[0][0] as string)).toContain('/api/filters');
  spy.mockRestore();
});
it('fetchMatches returns the parsed body', async () => {
  const body: MatchesResponse = { matches: [], sessions: [], total: 0 };
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body)));
  expect(await fetchMatches({})).toEqual(body);
  spy.mockRestore();
});
it('fetchFilters encodes a character into the query', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ characters: [] })));
  await fetchFilters('Me-R');
  expect((spy.mock.calls[0][0] as string)).toContain('character=Me-R');
  spy.mockRestore();
});
