import { describe, it, expect } from 'vitest';
import { computeAnchors } from '../src/metrics/anchors.js';
import type { PositionTrack } from '../src/metrics/types.js';
import type { CastEvent } from '../src/metrics/cooldownTimeline.js';

const match = { events: [{ event: 'X', timestamp: 0 }, { event: 'Y', timestamp: 10000 }] };

describe('computeAnchors', () => {
  it('records a Demonic Circle placement at the caster position at cast time', () => {
    const tracks = new Map<string, PositionTrack>([
      ['P', { unitId: 'P', samples: [{ tSec: 4, x: 10, y: 20 }, { tSec: 5, x: 10, y: 20 }], breaks: [] }],
    ]);
    const casts = new Map<string, CastEvent[]>([
      ['P', [{ spellId: 48018, name: 'Demonic Circle: Summon', ms: 5000 }]],
    ]);
    const anchors = computeAnchors(match, tracks, casts);
    expect(anchors).toEqual([{ unitId: 'P', placements: [{ tSec: 5, x: 10, y: 20 }] }]);
  });

  it('ignores non-anchor casts and players with no resolvable position', () => {
    const tracks = new Map<string, PositionTrack>([['P', { unitId: 'P', samples: [], breaks: [] }]]);
    const casts = new Map<string, CastEvent[]>([
      ['P', [{ spellId: 48018, name: 'Demonic Circle: Summon', ms: 5000 }]], // anchor, but no position
      ['Q', [{ spellId: 686, name: 'Shadow Bolt', ms: 5000 }]],               // not an anchor
    ]);
    expect(computeAnchors(match, tracks, casts)).toEqual([]);
  });
});
