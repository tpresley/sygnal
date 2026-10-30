/**
 * Smart snapping: edges and centres of a moving box to other boxes' edges and centres. Pure: a
 * reducer calls it per move.
 *
 *   const targets = snapTargets(others)              // once per gesture (sorted, O(n log n))
 *   const {dx, dy, guides} = snap(movingBox, dx, dy, targets, 6 / zoom)
 *
 * Guides are world-space segments `{ x1, y1, x2, y2 }` across the boxes that line up.
 */
import type {AABB} from './geometry'

export type Targets = {xs: Float64Array, xb: AABB[], ys: Float64Array, yb: AABB[]}
export type Guide = {x1: number, y1: number, x2: number, y2: number}

/** the candidate lines of `boxes`: three per axis per box (start, centre, end), sorted */
export function snapTargets(boxes: AABB[]): Targets {
  const xs: [number, AABB][] = [], ys: [number, AABB][] = []
  for (const b of boxes) {
    xs.push([b.x0, b], [(b.x0 + b.x1) / 2, b], [b.x1, b])
    ys.push([b.y0, b], [(b.y0 + b.y1) / 2, b], [b.y1, b])
  }
  xs.sort((a, b) => a[0] - b[0]); ys.sort((a, b) => a[0] - b[0])
  return {xs: Float64Array.from(xs, a => a[0]), xb: xs.map(a => a[1]), ys: Float64Array.from(ys, a => a[0]), yb: ys.map(a => a[1])}
}

// the index of the first value >= v
function lower(a: Float64Array, v: number) {
  let lo = 0, hi = a.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m }
  return lo
}

/** the nearest candidate to any of `vals` within `tol`: [offset, candidate value] */
function nearest(a: Float64Array, vals: number[], tol: number): [number, number] | null {
  let best: [number, number] | null = null
  for (const v of vals) {
    const i = lower(a, v - tol)
    for (let j = i; j < a.length && a[j] <= v + tol; j++) {
      const d = a[j] - v
      if (!best || Math.abs(d) < Math.abs(best[0])) best = [d, a[j]]
    }
  }
  return best
}

export function snap(box: AABB, dx: number, dy: number, t: Targets, tol: number): {dx: number, dy: number, guides: Guide[]} {
  const m = {x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy}
  const vx = [m.x0, (m.x0 + m.x1) / 2, m.x1], vy = [m.y0, (m.y0 + m.y1) / 2, m.y1]
  const sx = nearest(t.xs, vx, tol), sy = nearest(t.ys, vy, tol)
  if (sx) dx += sx[0]
  if (sy) dy += sy[0]
  const s = {x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy}
  const guides: Guide[] = []
  // a guide through every box on the snapped line, spanning them and the moving box
  if (sx) {
    const x = sx[1]
    let y1 = s.y0, y2 = s.y1
    for (let i = lower(t.xs, x - 1e-6); i < t.xs.length && t.xs[i] <= x + 1e-6; i++) { y1 = Math.min(y1, t.xb[i].y0); y2 = Math.max(y2, t.xb[i].y1) }
    guides.push({x1: x, y1, x2: x, y2})
  }
  if (sy) {
    const y = sy[1]
    let x1 = s.x0, x2 = s.x1
    for (let i = lower(t.ys, y - 1e-6); i < t.ys.length && t.ys[i] <= y + 1e-6; i++) { x1 = Math.min(x1, t.yb[i].x0); x2 = Math.max(x2, t.yb[i].x1) }
    guides.push({x1, y1: y, x2, y2: y})
  }
  return {dx, dy, guides}
}
