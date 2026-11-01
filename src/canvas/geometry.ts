/**
 * World/screen coordinates and box geometry for canvas apps.
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

const index = new WeakMap<any[], Map<any, any>>()
/** id → node, once per array (arrays are immutable: identity is the key) */
export const indexOf = (items: any[]): Map<any, any> => {
  let m = index.get(items)
  if (!m) { m = new Map(); for (const n of items) if (n.id != null) m.set(n.id, n); index.set(items, m) }
  return m
}

const places = new WeakMap<any[], Map<any, number>>()
/**
 * id → index, once per array; an array that differs from `prev` only in nodes that keep their id
 * (a drag replaces a few nodes) shares prev's map after identity checks: no map of n ids per frame
 */
export function positionsOf(items: any[], prev?: any[] | null): Map<any, number> {
  let m = places.get(items)
  if (m) return m
  const pm = prev && places.get(prev)
  if (pm && prev!.length == items.length) {
    let i = 0
    for (; i < items.length && (items[i] === prev![i] || items[i].id === prev![i].id); i++);
    if (i == items.length) m = pm
  }
  if (!m) { m = new Map(); items.forEach((n, i) => n.id != null && !m!.has(n.id) && m!.set(n.id, i)) }
  places.set(items, m)
  return m
}

/** an AABB as a box (unrotated) */
export const boxOf = (a: AABB): Box => ({x: a.x0, y: a.y0, width: a.x1 - a.x0, height: a.y1 - a.y0, rotation: 0})

/**
 * the box the handles go around: one node's own box (rotated), or the selection's bounds; null when
 * none of `ids` is in `nodes`
 */
export function selectionBox<T extends Box & {id?: any}>(nodes: T[], ids: Iterable<any>): Box | null {
  // by the array's index when one exists (the painter's, the hit test's, positionsOf's); else one pass that stops
  // when all are found: no index built per frame for a drag's new array
  const idx = index.get(nodes), pos = places.get(nodes), sel: T[] = []
  if (idx) for (const id of ids) { const n = idx.get(id); if (n) sel.push(n) }
  else if (pos) for (const id of ids) { const j = pos.get(id); if (j !== undefined) sel.push(nodes[j]) }
  else {
    const want = new Set(ids)
    for (let i = 0; i < nodes.length && sel.length < want.size; i++) if (want.has(nodes[i].id)) sel.push(nodes[i])
  }
  if (!sel.length) return null
  return sel.length == 1 ? sel[0] : boxOf(union(sel)!)
}

/** the camera a `parallax={[fx, fy]}` layer is seen through: it scrolls at f times the camera */
export const layerCamera = (c: Camera, f: [number, number] | null | undefined): Camera => f ? {x: c.x * f[0], y: c.y * f[1], zoom: c.zoom} : c

export type FollowOptions = {
  /** the canvas size in CSS pixels */
  width: number, height: number
  /** a box around the anchor (screen pixels) the target moves in freely; the camera moves only when it leaves */
  deadzone?: {width?: number, height?: number}
  /** where the target sits relative to the view's centre (screen pixels): `{ x: -100 }` keeps it left of centre, a look-ahead */
  offset?: Partial<Pt>
  /** the share of the way the camera moves per call (0–1, `[x, y]` per axis; default 1: at once) */
  lerp?: number | [number, number]
  /** the time since the last call (ms): `lerp` is then per 1/60 s, so a variable frame time eases the same */
  dt?: number
  /** the world the camera never shows past (a level's bounds); a world smaller than the view is centred */
  bounds?: AABB | null
  /** whole screen pixels (a pixel-art game): the camera moves at least a pixel while it has a pixel to go */
  round?: boolean
}

/**
 * The camera after one step of following `target` (a point, or a box: its centre), as Phaser's
 * `startFollow` and Godot's Camera2D do: a dead zone, a look-ahead offset, smoothing, world bounds.
 * Pure: the model calls it each step with the camera in state and stores the result (the same
 * camera object when it didn't move), so a run replays to the same pixel.
 */
export function follow(c: Camera, target: Pt | Box, o: FollowOptions): Camera {
  const z = c.zoom, t = (target as Box).width != null ? centre(target as Box) : target
  const lerp = Array.isArray(o.lerp) ? o.lerp : [o.lerp ?? 1, o.lerp ?? 1]
  const b = o.bounds
  const axis = (pos: number, tp: number, size: number, dz: number, off: number, lo: number, hi: number, l: number) => {
    // where the target should be, and how far it may stray from there
    const at = pos + size / 2 + off / z, half = dz / 2 / z
    let want = tp > at + half ? pos + tp - at - half : tp < at - half ? pos + tp - at + half : pos
    if (hi - lo <= size) want = (lo + hi - size) / 2
    else want = Math.max(lo, Math.min(hi - size, want))
    // whole pixels: the nearest one to where it should be (inside the bounds)
    if (o.round) {
      want = Math.round(want * z) / z
      if (hi - lo > size) want = Math.max(Math.ceil(lo * z) / z, Math.min(Math.floor((hi - size) * z) / z, want))
    }
    if (want == pos) return pos
    const f = o.dt != null && l < 1 ? 1 - (1 - l) ** (o.dt / (1000 / 60)) : l
    let next = pos + (want - pos) * Math.max(0, Math.min(1, f))
    // toward it by at least a pixel, never past it: no stall short of it, no bounce around it
    if (o.round) next = want > pos ? Math.min(want, Math.ceil(next * z - 1e-9) / z) : Math.max(want, Math.floor(next * z + 1e-9) / z)
    return next
  }
  const x = axis(c.x, t.x, o.width / z, o.deadzone?.width || 0, o.offset?.x || 0, b ? b.x0 : -Infinity, b ? b.x1 : Infinity, lerp[0])
  const y = axis(c.y, t.y, o.height / z, o.deadzone?.height || 0, o.offset?.y || 0, b ? b.y0 : -Infinity, b ? b.y1 : Infinity, lerp[1])
  return x == c.x && y == c.y ? c : {...c, x, y}
}
