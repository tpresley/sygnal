/**
 * World/screen coordinates and box geometry for canvas apps (sygnal/canvas proposal).
 *
 * The camera is `{ x, y, zoom }`: the world point at the canvas's top-left corner and the scale.
 *   screen = (world - camera) * zoom
 * Every node is a box: x, y (top-left, world units), width, height, rotation (degrees, about the
 * box's centre). Plain functions on plain data: reducers and views use them as they are.
 */
export type Camera = {x: number, y: number, zoom: number}
export type Box = {x: number, y: number, width: number, height: number, rotation?: number}
export type Pt = {x: number, y: number}
export type AABB = {x0: number, y0: number, x1: number, y1: number}

export const CAMERA: Camera = {x: 0, y: 0, zoom: 1}

export const toWorld = (c: Camera, sx: number, sy: number): Pt => ({x: sx / c.zoom + c.x, y: sy / c.zoom + c.y})
export const toScreen = (c: Camera, wx: number, wy: number): Pt => ({x: (wx - c.x) * c.zoom, y: (wy - c.y) * c.zoom})

/** the camera after zooming to `zoom` with the world point under screen (sx, sy) kept in place */
export function zoomAt(c: Camera, zoom: number, sx: number, sy: number, min = 0.02, max = 256): Camera {
  const z = Math.min(max, Math.max(min, zoom)), w = toWorld(c, sx, sy)
  return {x: w.x - sx / z, y: w.y - sy / z, zoom: z}
}
export const panBy = (c: Camera, dsx: number, dsy: number): Camera => ({...c, x: c.x - dsx / c.zoom, y: c.y - dsy / c.zoom})

/** the camera showing `b` (world) inside a w × h canvas with `pad` screen pixels around it */
export function fit(b: AABB | null, w: number, h: number, pad = 40, max = 1): Camera {
  if (!b) return CAMERA
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0)
  const zoom = Math.min(max, (w - pad * 2) / bw, (h - pad * 2) / bh)
  return {x: (b.x0 + b.x1) / 2 - w / 2 / zoom, y: (b.y0 + b.y1) / 2 - h / 2 / zoom, zoom}
}

const RAD = Math.PI / 180
export const centre = (b: Box): Pt => ({x: b.x + b.width / 2, y: b.y + b.height / 2})

/** rotate p about o by deg */
export function rotate(p: Pt, o: Pt, deg: number): Pt {
  if (!deg) return p
  const r = deg * RAD, c = Math.cos(r), s = Math.sin(r), dx = p.x - o.x, dy = p.y - o.y
  return {x: o.x + dx * c - dy * s, y: o.y + dx * s + dy * c}
}

/** a world point in the box's own unrotated frame */
export const toLocal = (b: Box, p: Pt): Pt => rotate(p, centre(b), -(b.rotation || 0))

/** the box's four corners, rotated (world) */
export function corners(b: Box): Pt[] {
  const o = centre(b), r = b.rotation || 0
  return [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]].map(([x, y]) => rotate({x, y}, o, r))
}

// one AABB per rotated node object: nodes are immutable data, so identity is the cache key
const aabbs = new WeakMap<object, AABB>()
export function aabb(b: Box): AABB {
  // unrotated: cheaper to compute than to cache (a drag makes thousands of new nodes per frame)
  if (!b.rotation) return {x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height}
  let a = aabbs.get(b)
  if (a) return a
  const c = corners(b)
  a = {x0: Math.min(...c.map(p => p.x)), y0: Math.min(...c.map(p => p.y)), x1: Math.max(...c.map(p => p.x)), y1: Math.max(...c.map(p => p.y))}
  aabbs.set(b, a)
  return a
}
export function union(bs: Box[]): AABB | null {
  if (!bs.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const b of bs) { const a = aabb(b); x0 = Math.min(x0, a.x0); y0 = Math.min(y0, a.y0); x1 = Math.max(x1, a.x1); y1 = Math.max(y1, a.y1) }
  return {x0, y0, x1, y1}
}
export const overlaps = (a: AABB, b: AABB) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0
export const contains = (a: AABB, b: AABB) => b.x0 >= a.x0 && b.x1 <= a.x1 && b.y0 >= a.y0 && b.y1 <= a.y1
export const rectOf = (p: Pt, q: Pt): AABB => ({x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y)})

/** the visible world rectangle of a w × h canvas */
export const viewport = (c: Camera, w: number, h: number): AABB => ({x0: c.x, y0: c.y, x1: c.x + w / c.zoom, y1: c.y + h / c.zoom})

/** point-in-shape in world coordinates, honouring rotation; `type` ellipse tests the ellipse */
export function hitBox(b: Box & {type?: string}, p: Pt, slop = 0): boolean {
  const l = toLocal(b, p), x = l.x - b.x, y = l.y - b.y
  if (b.type == 'ellipse') {
    const rx = b.width / 2 + slop, ry = b.height / 2 + slop, dx = x - b.width / 2, dy = y - b.height / 2
    return rx > 0 && ry > 0 && (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1
  }
  return x >= -slop && x <= b.width + slop && y >= -slop && y <= b.height + slop
}
