import { describe, it, expect } from 'vitest';
import { renderReport, type ParsedMatchView } from '../src/view/renderReport.js';
import type { SidecarIndex } from '../src/sidecar/sidecarIndex.js';

function match(over: Partial<ParsedMatchView> = {}): ParsedMatchView {
  return {
    kind: 'arena',
    bracket: '3v3',
    zone: 'Nagrand',
    isRanked: true,
    startTimeMs: 1_780_013_360_342,
    startTimeIso: '2026-05-28T20:09:20.342Z',
    endTimeMs: 1_780_013_489_342,
    durationSec: 129,
    result: 3,
    winningTeamId: '1',
    eventCounts: { SPELL_INTERRUPT: 4, SPELL_DISPEL: 2, UNIT_DIED: 1 },
    combatants: [{ name: "Phlér'gus", spec: 'Warlock_Affliction', type: 'Player', reaction: 'Friendly' }],
    rawStartInfo: { bracket: '3v3' },
    rawEndInfo: { winningTeamId: '1' },
    ...over,
  };
}

function index(over: Partial<SidecarIndex> = {}): SidecarIndex {
  return { entries: [], loaded: 0, skipped: 0, ...over };
}

describe('renderReport', () => {
  it('renders boundaries, combatants (HTML-escaped), and event counts', () => {
    const html = renderReport([match()], index());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('3v3');
    expect(html).toContain('129');
    expect(html).toContain('SPELL_INTERRUPT');
    expect(html).toContain('Phl&#233;r&#39;gus');
  });

  it('shows the nearest sidecar and the delta in seconds when in window', () => {
    const idx = index({
      loaded: 1,
      entries: [
        {
          jsonPath: '/v/clip.json',
          videoPath: '/v/clip.mp4',
          startEpochMs: 1_780_013_360_342 + 5000,
          category: '3v3',
          zoneName: 'Nagrand',
          result: true,
          durationSec: 130,
          combatants: [],
        },
      ],
    });
    const html = renderReport([match()], idx);
    expect(html).toContain('clip.mp4');
    expect(html).toContain('5.0');
  });

  it('shows "no video match" when the nearest sidecar is outside the window', () => {
    const idx = index({
      loaded: 1,
      entries: [
        {
          jsonPath: '/v/far.json',
          videoPath: '/v/far.mp4',
          startEpochMs: 1_780_013_360_342 + 60 * 60 * 1000,
          category: '3v3',
          zoneName: 'Nagrand',
          result: true,
          durationSec: 130,
          combatants: [],
        },
      ],
    });
    const html = renderReport([match()], idx);
    expect(html).toContain('no video match');
  });

  it('renders a valid document with zero matches', () => {
    const html = renderReport([], index());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('0 matches');
  });
});
