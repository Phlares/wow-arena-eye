import type { Pt } from './occluderFit.js';

/** Vector LoS over fitted occluder polygons: a sightline is blocked when it crosses any
 *  wall/pillar edge, or when an endpoint sits inside a pillar (position-sampling noise). */

export interface VectorOccluders { walls: Pt[][]; pillars: Pt[][] }

const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Proper or touching segment intersection (collinear overlap counts as touching). */
export function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const EPS = 1e-9; // float-safe collinearity (exact ===0 misses touching after world transforms)
  const on = (a: Pt, b: Pt, p: Pt): boolean =>
    Math.abs(cross(a, b, p)) < EPS &&
    Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
  return on(p3, p4, p1) || on(p3, p4, p2) || on(p1, p2, p3) || on(p1, p2, p4);
}

/** Ray-cast point-in-polygon (even-odd). */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function crossesPolygon(a: Pt, b: Pt, poly: Pt[]): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentsIntersect(a, b, poly[j], poly[i])) return true;
  }
  return false;
}

/** True when the a→b sightline is blocked by the fitted geometry. */
export function losBlockedVector(occ: VectorOccluders, a: Pt, b: Pt): boolean {
  for (const pillar of occ.pillars) {
    if (pointInPolygon(a, pillar) || pointInPolygon(b, pillar)) return true;
    if (crossesPolygon(a, b, pillar)) return true;
  }
  for (const wall of occ.walls) {
    if (crossesPolygon(a, b, wall)) return true;
  }
  return false;
}
