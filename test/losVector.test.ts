import { describe, it, expect } from 'vitest';
import { losBlockedVector, pointInPolygon, segmentsIntersect } from '../src/metrics/losVector.js';

const PILLAR = [{ x: 10, y: 10 }, { x: 16, y: 10 }, { x: 16, y: 16 }, { x: 10, y: 16 }];
const OCC = { walls: [], pillars: [PILLAR] };

describe('segmentsIntersect', () => {
  it('detects crossing and rejects parallel-disjoint', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBe(false);
  });
});

describe('pointInPolygon', () => {
  it('inside true, outside false', () => {
    expect(pointInPolygon({ x: 13, y: 13 }, PILLAR)).toBe(true);
    expect(pointInPolygon({ x: 9, y: 13 }, PILLAR)).toBe(false);
  });
});

describe('losBlockedVector', () => {
  it('blocks a segment through the pillar', () => {
    expect(losBlockedVector(OCC, { x: 5, y: 13 }, { x: 20, y: 13 })).toBe(true);
  });
  it('clears a segment beside the pillar', () => {
    expect(losBlockedVector(OCC, { x: 5, y: 5 }, { x: 20, y: 5 })).toBe(false);
  });
  it('blocks when an endpoint sits inside an occluder (sampling noise)', () => {
    expect(losBlockedVector(OCC, { x: 13, y: 13 }, { x: 30, y: 13 })).toBe(true);
  });
});
