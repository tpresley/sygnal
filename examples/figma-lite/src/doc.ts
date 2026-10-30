/**
 * The document: shapes as plain data in one array, in paint order (a tree in depth-first order:
 * a frame's descendants follow it). Pure functions; the model calls them.
 *
 * A shape is a canvas node (sygnal/canvas's box-based vocabulary) plus `name`, `parent` (a frame's id),
 * `hidden`, `locked`: the array is the canvas's data layer as it is, no mapping.
 */
import {aabb, overlaps, contains, measureText, type AABB} from 'sygnal/canvas'

export type Type = 'rect' | 'ellipse' | 'text' | 'frame'
export type Shape = {
  id: string, type: Type, name: string, parent: string | null,
  x: number, y: number, width: number, height: number, rotation: number,
  fill: string, stroke: string, strokeWidth: number, radius: number, opacity: number,
  text?: string, fontSize?: number, hidden?: boolean, locked?: boolean,
}

export const DEFAULTS: Record<Type, Partial<Shape>> = {
  rect: {fill: '#d9d9d9', stroke: 'none', strokeWidth: 0, radius: 0},
  ellipse: {fill: '#d9d9d9', stroke: 'none', strokeWidth: 0, radius: 0},
  text: {fill: '#000000', stroke: 'none', strokeWidth: 0, radius: 0, fontSize: 24, text: 'Text'},
  frame: {fill: '#ffffff', stroke: 'none', strokeWidth: 0, radius: 0},
}
const LABEL: Record<Type, string> = {rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text', frame: 'Frame'}

export function make(type: Type, id: string, n: number, box: Partial<Shape>, parent: string | null = null): Shape {
  const s = {id, type, name: `${LABEL[type]} ${n}`, parent, x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, ...DEFAULTS[type], ...box} as Shape
  return type == 'text' ? fitText(s) : s
}

/** a text shape's box follows its text */
export const fitText = (s: Shape): Shape => {
  const m = measureText(s.text || '', s)
  return m.width == s.width && m.height == s.height ? s : {...s, width: Math.max(m.width, 4), height: m.height}
}

// id → index, once per array (arrays are immutable: identity is the cache key), so lookups over a
// 10k selection stay O(1) each
const positions = new WeakMap<Shape[], Map<string, number>>()
export const posOf = (shapes: Shape[]) => {
  let m = positions.get(shapes)
  if (!m) { m = new Map(); shapes.forEach((s, i) => m!.set(s.id, i)); positions.set(shapes, m) }
  return m
}
export const byId = (shapes: Shape[], id: string | null) => id == null ? undefined : shapes[posOf(shapes).get(id) ?? -1]

/** ids of a shape and everything inside it */
export function subtree(shapes: Shape[], id: string): string[] {
  const i = posOf(shapes).get(id) ?? -1
  if (i < 0) return []
  const out = [id], set = new Set(out)
  for (let j = i + 1; j < shapes.length && shapes[j].parent != null && set.has(shapes[j].parent!); j++) out.push(shapes[j].id), set.add(shapes[j].id)
  return out
}

/** the selection plus the descendants of selected frames, without duplicates */
export function withDescendants(shapes: Shape[], ids: string[]): Set<string> {
  const out = new Set<string>()
  // only frames have descendants
  for (const id of ids) if (byId(shapes, id)?.type == 'frame') { for (const d of subtree(shapes, id)) out.add(d) } else out.add(id)
  return out
}

/** replace shapes by id (one pass; untouched shapes keep their identity: the canvas caches them) */
export function patch(shapes: Shape[], f: (s: Shape) => Shape | null | undefined, ids?: Set<string>): Shape[] {
  let changed = false
  const out = shapes.map(s => {
    if (ids && !ids.has(s.id)) return s
    const n = f(s)
    if (n && n !== s) { changed = true; return n }
    return s
  })
  return changed ? out : shapes
}

/** remove ids and their descendants */
export function remove(shapes: Shape[], ids: string[]): Shape[] {
  const gone = withDescendants(shapes, ids)
  return gone.size ? shapes.filter(s => !gone.has(s.id)) : shapes
}

/** move subtree `id` to `index` of the array (an index in the array without the subtree), under `parent` */
export function moveTo(shapes: Shape[], id: string, parent: string | null, index: number): Shape[] {
  const ids = new Set(subtree(shapes, id))
  if (parent != null && ids.has(parent)) return shapes
  const block = shapes.filter(s => ids.has(s.id)).map(s => s.id === id ? {...s, parent} : s)
  const rest = shapes.filter(s => !ids.has(s.id))
  return [...rest.slice(0, index), ...block, ...rest.slice(index)]
}

/** the index right after the subtree of `id` (inserting there puts something above it) */
export const after = (shapes: Shape[], id: string) => {
  const t = subtree(shapes, id)
  return (posOf(shapes).get(t[t.length - 1]) ?? -1) + 1
}

/** the topmost frame containing the point (world), skipping `skip` */
export function frameAt(shapes: Shape[], x: number, y: number, skip?: Set<string>): Shape | undefined {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]
    if (s.type == 'frame' && !s.hidden && !skip?.has(s.id)) {
      const a = aabb(s)
      if (x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1) return s
    }
  }
}

/** insert a new shape: inside `parent` (after its last descendant), else on top */
export function insert(shapes: Shape[], s: Shape): Shape[] {
  if (s.parent == null) return [...shapes, s]
  const i = after(shapes, s.parent)
  return [...shapes.slice(0, i), s, ...shapes.slice(i)]
}

/** depth of a shape in the tree */
export function depth(shapes: Shape[], s: Shape): number {
  let d = 0
  for (let p = s.parent; p != null; p = byId(shapes, p)?.parent ?? null) d++
  return d
}

/** shapes whose box intersects the marquee (Figma: touching selects), not hidden or locked; top-level or inside frames */
export function inRect(shapes: Shape[], r: AABB, mode: 'touch' | 'contain' = 'touch'): string[] {
  return shapes.filter(s => !s.hidden && !s.locked && (mode == 'touch' ? overlaps(aabb(s), r) : contains(r, aabb(s)))).map(s => s.id)
}

/** copies of `ids` (with their descendants) under fresh ids, offset by (dx, dy) */
export function cloneAll(shapes: Shape[], ids: string[], nextId: () => string, dx = 10, dy = 10): Shape[] {
  const all = withDescendants(shapes, ids), map = new Map<string, string>()
  const src = shapes.filter(s => all.has(s.id))
  for (const s of src) map.set(s.id, nextId())
  return src.map(s => ({...s, id: map.get(s.id)!, parent: s.parent != null && map.has(s.parent) ? map.get(s.parent)! : s.parent, x: s.x + dx, y: s.y + dy, name: s.name}))
}

/** a deterministic stress document: n shapes in a grid (rects, ellipses, every 50th a text) */
export function stress(n: number): Shape[] {
  const cols = Math.ceil(Math.sqrt(n)), out: Shape[] = []
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < n; i++) {
    const type: Type = i % 50 == 49 ? 'text' : i % 3 == 1 ? 'ellipse' : 'rect'
    const c = i % cols, r = Math.floor(i / cols)
    out.push(make(type, 's' + i, i + 1, {
      x: c * 60, y: r * 60, width: 40, height: 40,
      fill: `hsl(${Math.floor(rnd() * 360)} 70% 60%)`,
      ...(type == 'text' ? {text: 'T' + i, fontSize: 14} : {}),
    }))
  }
  return out
}
