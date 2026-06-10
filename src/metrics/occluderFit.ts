import type { OccluderGrid } from './types.js';

/** 3-III occluder vectorization: fit wall/pillar POLYGONS from an occupancy void-ness grid.
 *  Blocked cells (void-ness >= threshold) are grouped into 4-connected components; the
 *  component(s) touching the grid border are the arena wall, interior components are pillars.
 *  Each component's boundary is traced along cell edges (rectilinear) then Douglas-Peucker
 *  simplified so raster staircases become the diagonals the real geometry has. */

export interface Pt { x: number; y: number }
export interface FitOptions { threshold?: number; minCells?: number; epsilonYd?: number }
export interface FittedOccluders { zoneId: string; threshold: number; walls: Pt[][]; pillars: Pt[][] }

const DEFAULT_THRESHOLD = 0.85; // = lineOfSight.ts BLOCKED_MIN
const DEFAULT_MIN_CELLS = 3;    // ignore lone noisy cells

interface Component { cells: Set<number>; touchesBorder: boolean }

function components(blocked: boolean[], cols: number, rows: number): Component[] {
  const seen = new Array<boolean>(blocked.length).fill(false);
  const out: Component[] = [];
  for (let i = 0; i < blocked.length; i++) {
    if (!blocked[i] || seen[i]) continue;
    const cells = new Set<number>();
    let touchesBorder = false;
    const stack = [i];
    seen[i] = true;
    while (stack.length) {
      const cur = stack.pop()!;
      cells.add(cur);
      const c = cur % cols, r = Math.floor(cur / cols);
      if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) touchesBorder = true;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (blocked[ni] && !seen[ni]) { seen[ni] = true; stack.push(ni); }
      }
    }
    out.push({ cells, touchesBorder });
  }
  return out;
}

/** Closed boundary loops of a cell component, in CELL-CORNER coordinates. Edges are emitted so
 *  the blocked region stays on a consistent side, then chained into loops. (At a rare diagonal
 *  cell-touch a corner has two outgoing edges — any pick still yields valid closed loops.) */
export function boundaryLoops(cells: Set<number>, cols: number): Pt[][] {
  const key = (x: number, y: number): string => `${x},${y}`;
  const next = new Map<string, Pt[]>();
  const addEdge = (fx: number, fy: number, tx: number, ty: number): void => {
    const k = key(fx, fy);
    const arr = next.get(k) ?? [];
    arr.push({ x: tx, y: ty });
    next.set(k, arr);
  };
  for (const idx of cells) {
    const c = idx % cols, r = Math.floor(idx / cols);
    const open = (dc: number, dr: number): boolean => !cells.has((r + dr) * cols + (c + dc));
    if (open(0, -1)) addEdge(c, r, c + 1, r);             // top edge, walk right
    if (open(1, 0)) addEdge(c + 1, r, c + 1, r + 1);      // right edge, walk down
    if (open(0, 1)) addEdge(c + 1, r + 1, c, r + 1);      // bottom edge, walk left
    if (open(-1, 0)) addEdge(c, r + 1, c, r);             // left edge, walk up
  }
  const loops: Pt[][] = [];
  while (next.size) {
    const [startKey, targets] = next.entries().next().value as [string, Pt[]];
    const [sx, sy] = startKey.split(',').map(Number);
    const loop: Pt[] = [{ x: sx, y: sy }];
    let cur = targets.pop()!;
    if (!targets.length) next.delete(startKey);
    while (cur.x !== sx || cur.y !== sy) {
      loop.push(cur);
      const k = key(cur.x, cur.y);
      const outs = next.get(k);
      if (!outs?.length) break; // degenerate; emit what we have
      cur = outs.pop()!;
      if (!outs.length) next.delete(k);
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

function douglasPeucker(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points;
  let maxD = -1, maxI = 0;
  const a = points[0], b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], a, b);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD <= epsilon) return [a, b];
  const left = douglasPeucker(points.slice(0, maxI + 1), epsilon);
  const right = douglasPeucker(points.slice(maxI), epsilon);
  return [...left.slice(0, -1), ...right];
}

/** Simplify a CLOSED loop: anchor at the two mutually-farthest vertices so the closure point
 *  isn't privileged, DP each half, and rejoin. */
export function simplifyLoop(loop: Pt[], epsilon: number): Pt[] {
  if (loop.length <= 4) return loop;
  let ai = 0, bi = Math.floor(loop.length / 2), best = -1;
  for (let i = 0; i < loop.length; i++) {
    for (let j = i + 1; j < loop.length; j++) {
      const d = Math.hypot(loop[i].x - loop[j].x, loop[i].y - loop[j].y);
      if (d > best) { best = d; ai = i; bi = j; }
    }
  }
  const half1 = loop.slice(ai, bi + 1);
  const half2 = [...loop.slice(bi), ...loop.slice(0, ai + 1)];
  const s1 = douglasPeucker(half1, epsilon);
  const s2 = douglasPeucker(half2, epsilon);
  return [...s1.slice(0, -1), ...s2.slice(0, -1)];
}

/** Fit wall + pillar polygons (world coordinates) from a void-ness grid. */
export function fitOccluders(grid: OccluderGrid, opts: FitOptions = {}): FittedOccluders {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const minCells = opts.minCells ?? DEFAULT_MIN_CELLS;
  const epsilon = opts.epsilonYd ?? grid.cellSize * 0.75;
  const blocked = grid.voidness.map((v) => v >= threshold);
  const toWorld = (p: Pt): Pt => ({
    x: grid.bounds.minX + p.x * grid.cellSize,
    y: grid.bounds.minY + p.y * grid.cellSize,
  });
  const walls: Pt[][] = [];
  const pillars: Pt[][] = [];
  for (const comp of components(blocked, grid.cols, grid.rows)) {
    if (comp.cells.size < minCells) continue;
    for (const loop of boundaryLoops(comp.cells, grid.cols)) {
      const poly = simplifyLoop(loop, epsilon / grid.cellSize).map(toWorld);
      if (poly.length < 3) continue;
      (comp.touchesBorder ? walls : pillars).push(poly);
    }
  }
  return { zoneId: grid.zoneId, threshold, walls, pillars };
}
