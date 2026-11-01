// Smart guides: snap the moving selection's edges and centre to other shapes'
// edges and centres. Targets are built once per drag and binary searched per frame.
import type { Rect } from './geometry';

interface Axis {
  /** sorted coordinates */
  values: Float64Array;
  /** perpendicular extent of the target that produced each value (for drawing the guide) */
  lo: Float64Array;
  hi: Float64Array;
}
export interface SnapTargets { x: Axis; y: Axis }
export interface Guide { axis: 'x' | 'y'; at: number; from: number; to: number }
export interface SnapResult { dx: number; dy: number; guides: Guide[] }

function buildAxis(entries: [number, number, number][]): Axis {
  entries.sort((a, b) => a[0] - b[0]);
  const n = entries.length;
  const axis = { values: new Float64Array(n), lo: new Float64Array(n), hi: new Float64Array(n) };
  entries.forEach(([v, lo, hi], i) => { axis.values[i] = v; axis.lo[i] = lo; axis.hi[i] = hi; });
  return axis;
}

export function buildSnapTargets(rects: Iterable<Rect>): SnapTargets {
  const xs: [number, number, number][] = [];
  const ys: [number, number, number][] = [];
  for (const r of rects) {
    for (const x of [r.x, r.x + r.w / 2, r.x + r.w]) xs.push([x, r.y, r.y + r.h]);
    for (const y of [r.y, r.y + r.h / 2, r.y + r.h]) ys.push([y, r.x, r.x + r.w]);
  }
  return { x: buildAxis(xs), y: buildAxis(ys) };
}

/** Index of the first value >= v. */
function lowerBound(values: Float64Array, v: number): number {
  let lo = 0, hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function nearest(axis: Axis, v: number): number | null {
  const i = lowerBound(axis.values, v);
  let best: number | null = null;
  for (const j of [i - 1, i]) {
    if (j < 0 || j >= axis.values.length) continue;
    if (best === null || Math.abs(axis.values[j] - v) < Math.abs(best - v)) best = axis.values[j];
  }
  return best;
}

function snapAxis(axis: Axis, edges: number[], threshold: number): number {
  let best = 0, bestDist = Infinity;
  for (const e of edges) {
    const t = nearest(axis, e);
    if (t === null) continue;
    const d = Math.abs(t - e);
    if (d <= threshold && d < bestDist) { bestDist = d; best = t - e; }
  }
  return best;
}

function guidesFor(axis: Axis, which: 'x' | 'y', edges: number[], lo: number, hi: number, eps: number): Guide[] {
  const out: Guide[] = [];
  const seen = new Set<number>();
  for (const e of edges) {
    let i = lowerBound(axis.values, e - eps);
    let from = lo, to = hi, any = false;
    for (; i < axis.values.length && axis.values[i] <= e + eps; i++) {
      any = true;
      from = Math.min(from, axis.lo[i]);
      to = Math.max(to, axis.hi[i]);
    }
    if (any && !seen.has(e)) { seen.add(e); out.push({ axis: which, at: e, from, to }); }
  }
  return out;
}

/**
 * Snaps a rect that the user moved to `moving`. Returns the correction to add to
 * the raw delta and the guides to draw. `threshold` is in world units
 * (screen pixels / zoom).
 */
export function snapRect(moving: Rect, targets: SnapTargets, threshold: number): SnapResult {
  const xEdges = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const yEdges = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];
  const dx = snapAxis(targets.x, xEdges, threshold);
  const dy = snapAxis(targets.y, yEdges, threshold);
  const eps = 1e-6 + threshold * 1e-3;
  const snappedX = xEdges.map((e) => e + dx);
  const snappedY = yEdges.map((e) => e + dy);
  const guides = [
    ...(dx !== 0 || hasExact(targets.x, xEdges, eps)
      ? guidesFor(targets.x, 'x', snappedX, moving.y + dy, moving.y + dy + moving.h, eps) : []),
    ...(dy !== 0 || hasExact(targets.y, yEdges, eps)
      ? guidesFor(targets.y, 'y', snappedY, moving.x + dx, moving.x + dx + moving.w, eps) : []),
  ];
  return { dx, dy, guides };
}

function hasExact(axis: Axis, edges: number[], eps: number): boolean {
  return edges.some((e) => { const t = nearest(axis, e); return t !== null && Math.abs(t - e) <= eps; });
}
