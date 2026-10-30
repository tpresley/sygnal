/**
 * The editor's model: one state tree, reducers as plain functions. Undo is a list of earlier
 * `shapes` arrays (structural sharing: an edit replaces only the shapes it touches).
 */
import {ABORT} from 'sygnal'
import {
  aabb, union, centre, rotate, rectOf, viewport, overlaps, zoomAt, fit, toSVG, gesture, snap, snapTargets,
  type Camera, type Guide, type Pointer, type Box, type Gesture, type Targets, CAMERA,
} from '../lib/canvas'
import {make, fitText, byId, subtree, withDescendants, patch, remove, moveTo, after, frameAt, insert, inRect, cloneAll, stress, type Shape, type Type} from './doc'

export type Tool = 'select' | Type
export type Row = {id: string, name: string, type: Type, depth: number, hidden: boolean, locked: boolean}

type Starts = Record<string, Shape>
export type G = Gesture<{
  before: Shape[], ids?: string[], starts?: Starts, box?: Box, part?: string,
  targets?: Targets, base?: string[], id?: string, follow?: {ids: string[], from: {x: number, y: number}},
}> & {kind: 'move' | 'resize' | 'rotate' | 'marquee' | 'create'}

export type State = {
  shapes: Shape[], past: Shape[][], future: Shape[][],
  selection: string[], tool: Tool, camera: Camera, size: {width: number, height: number},
  gesture: G | null, guides: Guide[], hover: string | null,
  editing: string | null, editBefore: Shape[] | null, renaming: string | null,
  clipboard: Shape[], seq: number,
  dragRow: string | null, drop: {id: string, where: 'before' | 'after' | 'inside'} | null,
  // experiments (README §3, §4): how drags reach the canvas, how it repaints
  input: 'queue' | 'transient', repaint: 'layers' | 'full',
}

export const initialState = (shapes: Shape[] = []): State => ({
  shapes, past: [], future: [], selection: [], tool: 'select', camera: CAMERA, size: {width: 800, height: 600},
  gesture: null, guides: [], hover: null, editing: null, editBefore: null, renaming: null,
  clipboard: [], seq: shapes.length, dragRow: null, drop: null, input: 'queue', repaint: 'layers',
})

// ---------------------------------------------------------------- history

const HISTORY = 200
/** a document edit: the old shapes go on the undo stack */
export const commit = (s: State, shapes: Shape[], before = s.shapes): State =>
  shapes === before ? {...s, shapes} : {...s, shapes, past: [...s.past.slice(-HISTORY + 1), before], future: []}
const live = (s: State, sel: string[]) => sel.filter(id => s.shapes.some(x => x.id === id))

export const undo = (s: State): State => {
  if (!s.past.length) return ABORT as any
  const prev = s.past[s.past.length - 1]
  return {...s, shapes: prev, past: s.past.slice(0, -1), future: [s.shapes, ...s.future], selection: s.selection.filter(id => prev.some(x => x.id === id)), gesture: null, editing: null}
}
export const redo = (s: State): State => {
  if (!s.future.length) return ABORT as any
  const next = s.future[0]
  return {...s, shapes: next, past: [...s.past, s.shapes], future: s.future.slice(1), selection: s.selection.filter(id => next.some(x => x.id === id))}
}

// ---------------------------------------------------------------- selection geometry

/** the box the handles go around: one shape's own box (rotated), or the selection's bounds */
export function selectionBox(s: State): Box | null {
  const sel = s.selection.map(id => byId(s.shapes, id)).filter(Boolean) as Shape[]
  if (!sel.length) return null
  if (sel.length == 1) return sel[0]
  const a = union(sel)!
  return {x: a.x0, y: a.y0, width: a.x1 - a.x0, height: a.y1 - a.y0, rotation: 0}
}

export const HANDLES: Record<string, [number, number]> = {nw: [0, 0], n: [.5, 0], ne: [1, 0], e: [1, .5], se: [1, 1], s: [.5, 1], sw: [0, 1], w: [0, .5]}
export const ROTATE_OFFSET = 24 // screen px above the top edge

/** a point of the box in world coordinates: (u, v) in 0..1 of its width/height, rotated */
export const boxPoint = (b: Box, u: number, v: number, dy = 0) => rotate({x: b.x + b.width * u, y: b.y + b.height * v + dy}, centre(b), b.rotation || 0)

function resizeBox(b: Box, part: string, p: {x: number, y: number}, keep: boolean): Box {
  const rot = b.rotation || 0, c = centre(b), u = rotate(p, c, -rot)
  let l = b.x, t = b.y, r = b.x + b.width, btm = b.y + b.height
  if (part.includes('w')) l = u.x
  if (part.includes('e')) r = u.x
  if (part.includes('n')) t = u.y
  if (part.includes('s')) btm = u.y
  if (keep && b.width && b.height) {
    const ar = b.width / b.height
    let w = r - l, h = btm - t
    if (part.length == 2) {
      if (Math.abs(w) / b.width > Math.abs(h) / b.height) h = Math.sign(h || 1) * Math.abs(w) / ar
      else w = Math.sign(w || 1) * Math.abs(h) * ar
      if (part.includes('w')) l = r - w; else r = l + w
      if (part.includes('n')) t = btm - h; else btm = t + h
    } else if (part == 'e' || part == 'w') { h = Math.abs(w) / ar; t = c.y - h / 2; btm = c.y + h / 2 }
    else { w = Math.abs(h) * ar; l = c.x - w / 2; r = c.x + w / 2 }
  }
  const x0 = Math.min(l, r), x1 = Math.max(l, r), y0 = Math.min(t, btm), y1 = Math.max(t, btm)
  const nc = rotate({x: (x0 + x1) / 2, y: (y0 + y1) / 2}, c, rot), w = x1 - x0, h = y1 - y0
  return {x: nc.x - w / 2, y: nc.y - h / 2, width: w, height: h, rotation: rot}
}

// ---------------------------------------------------------------- pointer: the tool state machine

const nextIds = (s: State) => { let n = s.seq; return {next: () => 'n' + (++n), seq: () => n} }

export function down(s: State, p: Pointer): State {
  if (s.editing) s = textDone(s)
  const before = s.shapes
  // a handle of the selection
  if (p.part && s.selection.length) {
    const box = selectionBox(s)!, ids = [...withDescendants(s.shapes, s.selection)]
    const starts: Starts = {}
    for (const id of p.part == 'rotate' ? ids : s.selection) starts[id] = byId(s.shapes, id)!
    return {...s, gesture: gesture.start(p.part == 'rotate' ? 'rotate' : 'resize', p, {before, box, part: p.part, starts, ids: Object.keys(starts)}) as G}
  }
  if (s.tool != 'select') {
    const g = nextIds(s), id = g.next(), parent = s.tool == 'frame' ? null : frameAt(s.shapes, p.x, p.y)?.id ?? null
    const n = s.shapes.filter(x => x.type == s.tool).length + 1
    const shape = make(s.tool, id, n, s.tool == 'text' ? {x: p.x, y: p.y, text: ''} : {x: p.x, y: p.y, width: 0, height: 0}, parent)
    // text: placed at the press, edited at once
    if (s.tool == 'text') {
      return {...s, shapes: insert(s.shapes, shape), seq: g.seq(), selection: [id], tool: 'select', editing: id, editBefore: before}
    }
    return {...s, shapes: insert(s.shapes, shape), seq: g.seq(), selection: [id], gesture: gesture.start('create', p, {before, id}) as G}
  }
  if (p.hit != null) {
    const hit = p.hit as string
    let sel = s.selection
    if (p.shift) sel = sel.includes(hit) ? sel.filter(x => x !== hit) : [...sel, hit]
    else if (!sel.includes(hit)) sel = [hit]
    if (!sel.includes(hit)) return {...s, selection: sel}
    return startMove({...s, selection: sel}, p)
  }
  return {...s, selection: p.shift ? s.selection : [], gesture: gesture.start('marquee', p, {before, base: p.shift ? s.selection : []}) as G}
}

function startMove(s: State, p: Pointer): State {
  const ids = [...withDescendants(s.shapes, s.selection)], moving = new Set(ids), starts: Starts = {}
  for (const id of ids) starts[id] = byId(s.shapes, id)!
  // snap targets: the visible shapes that don't move (Figma snaps to what you can see)
  const view = viewport(s.camera, s.size.width, s.size.height)
  const others = s.shapes.filter(x => !moving.has(x.id) && !x.hidden && overlaps(aabb(x), view)).map(aabb)
  const follow = s.input == 'transient' ? {ids, from: {x: p.x, y: p.y}} : undefined
  return {...s, gesture: gesture.start('move', p, {before: s.shapes, ids, starts, targets: snapTargets(others), follow}) as G}
}

export function move(s: State, p: Pointer): State {
  const g0 = s.gesture
  if (!g0) return s.hover === p.hit ? ABORT as any : {...s, hover: p.hit}
  const g = gesture.move(g0, p, s.camera.zoom) as G
  if (!g.moved) return {...s, gesture: g}
  const {dx, dy} = gesture.delta(g)
  if (g.kind == 'move') return applyMove({...s, gesture: g}, dx, dy, !p.mod)
  if (g.kind == 'marquee') {
    const r = rectOf(g.from, g.at)
    const hits = inRect(s.shapes.filter(x => x.parent == null), r)
    return {...s, gesture: g, selection: [...new Set([...g.base!, ...hits])]}
  }
  if (g.kind == 'create') {
    let w = Math.abs(dx), h = Math.abs(dy)
    if (p.shift) w = h = Math.max(w, h)
    const box = {x: dx < 0 ? g.from.x - w : g.from.x, y: dy < 0 ? g.from.y - h : g.from.y, width: w, height: h}
    return {...s, gesture: g, shapes: patch(s.shapes, x => x.id === g.id ? {...x, ...box} : x)}
  }
  if (g.kind == 'resize') {
    const b = g.box!, nb = resizeBox(b, g.part!, p, p.shift), ids = new Set(g.ids)
    const one = g.ids!.length == 1
    const sx = b.width ? nb.width / b.width : 1, sy = b.height ? nb.height / b.height : 1
    return {...s, gesture: g, shapes: patch(s.shapes, x => {
      const o = g.starts![x.id]
      let n: Shape = one ? {...o, ...nb, rotation: o.rotation} as Shape
        : {...o, x: nb.x + (o.x - b.x) * sx, y: nb.y + (o.y - b.y) * sy, width: o.width * sx, height: o.height * sy}
      if (o.type == 'text') n = fitText({...n, fontSize: Math.max(1, Math.round((o.fontSize || 16) * (n.height / (o.height || 1)) * 10) / 10)})
      return n
    }, ids)}
  }
  if (g.kind == 'rotate') {
    const b = g.box!, c = centre(b)
    const a0 = Math.atan2(g.from.y - c.y, g.from.x - c.x), a1 = Math.atan2(p.y - c.y, p.x - c.x)
    let d = (a1 - a0) * 180 / Math.PI
    const base = b.rotation || 0
    if (p.shift) d = Math.round((base + d) / 15) * 15 - base
    const ids = new Set(g.ids)
    return {...s, gesture: g, shapes: patch(s.shapes, x => {
      const o = g.starts![x.id], oc = rotate(centre(o), c, d)
      return {...o, x: oc.x - o.width / 2, y: oc.y - o.height / 2, rotation: norm(o.rotation + d)}
    }, ids)}
  }
  return {...s, gesture: g}
}
const norm = (deg: number) => { const r = Math.round(deg * 100) / 100 % 360; return r < 0 ? r + 360 : r }

function applyMove(s: State, dx: number, dy: number, snapping: boolean): State {
  const g = s.gesture!
  if (g.follow) return {...s, gesture: g} // transient: the canvas paints the drag, the up commits
  let guides: Guide[] = []
  if (snapping) {
    const box = union(s.selection.map(id => g.starts![id]).filter(Boolean))!
    const r = snap(box, dx, dy, g.targets!, 6 / s.camera.zoom)
    dx = r.dx; dy = r.dy; guides = r.guides
  }
  const ids = new Set(g.ids)
  return {...s, guides, shapes: patch(s.shapes, x => { const o = g.starts![x.id]; return {...o, x: o.x + dx, y: o.y + dy} }, ids)}
}

export function up(s: State, p: Pointer): State {
  let g = s.gesture
  if (!g) return ABORT as any
  if (g.follow) {
    // the transient drag ends: the one state change of the whole gesture
    g = gesture.move(g, p, s.camera.zoom) as G
    if (g.moved) { const {dx, dy} = gesture.delta(g); s = applyMove({...s, gesture: {...g, follow: undefined}}, dx, dy, !p.mod) }
  }
  let shapes = s.shapes
  if (g.kind == 'create' && !g.moved) {
    const size = s.tool == 'frame' ? 200 : 100
    shapes = patch(shapes, x => x.id === g!.id ? {...x, x: g!.from.x - size / 2, y: g!.from.y - size / 2, width: size, height: size} : x)
  }
  if (g.kind == 'move' && g.moved) shapes = reparent(shapes, s.selection, p)
  const done = {...s, gesture: null, guides: [], tool: g.kind == 'create' ? 'select' as Tool : s.tool}
  return commit(done, shapes, g.before)
}

/** dropped shapes join the frame under the pointer (or leave theirs) */
function reparent(shapes: Shape[], sel: string[], p: Pointer): Shape[] {
  const moving = withDescendants(shapes, sel), f = frameAt(shapes, p.x, p.y, moving)
  for (const id of sel) {
    const sh = byId(shapes, id)
    if (!sh || (sh.parent ?? null) === (f?.id ?? null) || sel.includes(sh.parent!)) continue
    if (sh.type == 'frame' && f) continue
    const t = subtree(shapes, id), rest = shapes.filter(x => !t.includes(x.id))
    shapes = moveTo(shapes, id, f?.id ?? null, f ? after(rest, f.id) : rest.length)
  }
  return shapes
}

export function dbl(s: State, p: Pointer): State {
  const sh = byId(s.shapes, p.hit)
  if (sh?.type != 'text' || sh.locked) return ABORT as any
  return {...s, selection: [sh.id], editing: sh.id, editBefore: s.shapes, gesture: null}
}

export const editText = (s: State, text: string): State =>
  s.editing ? {...s, shapes: patch(s.shapes, x => x.id === s.editing ? fitText({...x, text}) : x)} : ABORT as any

export function textDone(s: State): State {
  if (!s.editing) return s
  const sh = byId(s.shapes, s.editing)
  const shapes = sh && !String(sh.text || '').trim() ? remove(s.shapes, [sh.id]) : s.shapes
  return commit({...s, editing: null, editBefore: null, selection: live({...s, shapes}, s.selection)}, shapes, s.editBefore || s.shapes)
}

// ---------------------------------------------------------------- commands

export const del = (s: State): State => s.selection.length ? commit({...s, selection: []}, remove(s.shapes, s.selection)) : ABORT as any

export function nudge(s: State, {dx, dy}: {dx: number, dy: number}): State {
  if (!s.selection.length) return ABORT as any
  const ids = withDescendants(s.shapes, s.selection)
  return commit(s, patch(s.shapes, x => ({...x, x: x.x + dx, y: x.y + dy}), ids))
}

export const copy = (s: State): State => s.selection.length ? {...s, clipboard: s.shapes.filter(x => withDescendants(s.shapes, s.selection).has(x.id))} : ABORT as any

function pasteShapes(s: State, src: Shape[], dx: number, dy: number): State {
  if (!src.length) return ABORT as any
  const g = nextIds(s), ids = src.map(x => x.id)
  const roots = src.filter(x => x.parent == null || !ids.includes(x.parent)).map(x => x.id)
  const copies = cloneAll(src, roots, g.next, dx, dy)
  let shapes = s.shapes
  const exists = new Set(shapes.map(x => x.id))
  // roots keep their frame if it is still there (duplicate inside a frame stays inside)
  for (const c of copies) shapes = insert(shapes, c.parent != null && !exists.has(c.parent) && !copies.some(o => o.id === c.parent) ? {...c, parent: null} : c)
  const newRoots = copies.filter(c => c.parent == null || !copies.some(o => o.id === c.parent)).map(c => c.id)
  return commit({...s, seq: g.seq(), selection: newRoots}, shapes)
}
export const paste = (s: State) => pasteShapes(s, s.clipboard, 10, 10)
export const duplicate = (s: State) => pasteShapes(s, s.shapes.filter(x => withDescendants(s.shapes, s.selection).has(x.id)), 10, 10)
export const selectAll = (s: State): State => ({...s, selection: s.shapes.filter(x => x.parent == null && !x.locked && !x.hidden).map(x => x.id)})
export const escape = (s: State): State => s.editing ? textDone(s) : s.gesture ? {...s, shapes: s.gesture.before, gesture: null, guides: []} : s.tool != 'select' ? {...s, tool: 'select'} : {...s, selection: []}

// ---------------------------------------------------------------- properties panel

const NUM = /^(x|y|width|height|rotation|radius|strokeWidth|opacity|fontSize)$/
export function setProp(s: State, {key, value}: {key: string, value: string}): State {
  if (!s.selection.length) return ABORT as any
  let v: any = value
  if (NUM.test(key)) {
    v = parseFloat(value)
    if (!isFinite(v)) return ABORT as any
    if (key == 'opacity') v = Math.max(0, Math.min(100, v)) / 100
    if (key == 'width' || key == 'height' || key == 'radius' || key == 'strokeWidth' || key == 'fontSize') v = Math.max(key == 'fontSize' ? 1 : 0, v)
  }
  let shapes = s.shapes
  for (const id of s.selection) {
    const o = byId(shapes, id)!
    if (key == 'x' || key == 'y') {
      // a frame's children move with it
      const d = v - o[key], ids = new Set(subtree(shapes, id))
      shapes = patch(shapes, x => ({...x, [key]: x[key] + d}), ids)
    } else {
      shapes = patch(shapes, x => {
        if (x.id !== id) return x
        let n: Shape = {...x, [key]: v}
        // a stroke colour on a shape with no stroke gets a visible width
        if (key == 'stroke' && v != 'none' && !x.strokeWidth) n.strokeWidth = 1
        return x.type == 'text' && key == 'fontSize' ? fitText(n) : n
      })
    }
  }
  return shapes === s.shapes ? ABORT as any : commit(s, shapes)
}

// ---------------------------------------------------------------- layers panel

/** the layers panel's rows: top of the stack first, children under their frame */
const rowCache = new WeakMap<Shape, Row>()
export function rows(shapes: Shape[]): Row[] {
  const kids = new Map<string | null, Shape[]>()
  for (const x of shapes) { const k = x.parent ?? null; let a = kids.get(k); if (!a) kids.set(k, a = []); a.push(x) }
  const out: Row[] = []
  const walk = (p: string | null, d: number) => {
    const a = kids.get(p)
    if (a) for (let i = a.length - 1; i >= 0; i--) {
      const x = a[i]
      let r = rowCache.get(x)
      if (!r || r.depth != d) rowCache.set(x, r = {id: x.id, name: x.name, type: x.type, depth: d, hidden: !!x.hidden, locked: !!x.locked})
      out.push(r)
      if (x.type == 'frame') walk(x.id, d + 1)
    }
  }
  walk(null, 0)
  return out
}

export type LayerMsg =
  | {kind: 'select', id: string, shift: boolean} | {kind: 'hide' | 'lock' | 'rename-start' | 'dragstart' | 'dragend', id: string}
  | {kind: 'rename', id: string, name: string} | {kind: 'rename-cancel', id: string}
  | {kind: 'dragover', id: string, where: 'before' | 'after' | 'inside'} | {kind: 'drop', id: string}

export function layer(s: State, m: LayerMsg): State {
  switch (m.kind) {
    case 'select': return {...s, selection: m.shift ? (s.selection.includes(m.id) ? s.selection.filter(x => x !== m.id) : [...s.selection, m.id]) : [m.id]}
    case 'hide': case 'lock': {
      const k = m.kind == 'hide' ? 'hidden' : 'locked'
      return commit({...s, selection: s.selection.filter(x => x !== m.id || m.kind == 'lock')}, patch(s.shapes, x => x.id === m.id ? {...x, [k]: !x[k]} : x))
    }
    case 'rename-start': return {...s, renaming: m.id}
    case 'rename-cancel': return {...s, renaming: null}
    case 'rename': {
      const name = m.name.trim()
      const sh = byId(s.shapes, m.id)
      if (!name || !sh || sh.name === name) return {...s, renaming: null}
      return commit({...s, renaming: null}, patch(s.shapes, x => x.id === m.id ? {...x, name} : x))
    }
    case 'dragstart': return {...s, dragRow: m.id}
    case 'dragend': return s.dragRow || s.drop ? {...s, dragRow: null, drop: null} : ABORT as any
    case 'dragover': {
      if (!s.dragRow || s.dragRow === m.id) return ABORT as any
      const where = m.where == 'inside' && byId(s.shapes, m.id)?.type != 'frame' ? 'after' : m.where
      return s.drop?.id === m.id && s.drop.where === where ? ABORT as any : {...s, drop: {id: m.id, where}}
    }
    case 'drop': {
      const d = s.drop, id = s.dragRow
      const done = {...s, dragRow: null, drop: null}
      if (!d || !id || subtree(s.shapes, id).includes(d.id)) return done
      return commit(done, reorder(s.shapes, id, d.id, d.where))
    }
  }
  return ABORT as any
}

/** the layers panel lists the top of the stack first: "before" a row is above it, later in the array */
export function reorder(shapes: Shape[], id: string, target: string, where: 'before' | 'after' | 'inside'): Shape[] {
  const t = byId(shapes, target)!
  const block = subtree(shapes, id), rest = shapes.filter(x => !block.includes(x.id))
  if (where == 'inside') return moveTo(shapes, id, t.id, after(rest, t.id))
  if (where == 'before') return moveTo(shapes, id, t.parent ?? null, after(rest, t.id))
  return moveTo(shapes, id, t.parent ?? null, rest.findIndex(x => x.id === t.id))
}

// ---------------------------------------------------------------- view commands

export const zoomBy = (s: State, f: number): State => ({...s, camera: zoomAt(s.camera, s.camera.zoom * f, s.size.width / 2, s.size.height / 2)})
export const zoomTo = (s: State, z: number): State => ({...s, camera: zoomAt(s.camera, z, s.size.width / 2, s.size.height / 2)})
export const zoomFit = (s: State): State => ({...s, camera: fit(union(s.shapes.filter(x => !x.hidden)), s.size.width, s.size.height, 40, 8)})
export const loadStress = (s: State, n: number): State => {
  const shapes = stress(n), st = {...s, shapes, past: [], future: [], selection: [], seq: n, gesture: null}
  return {...st, camera: fit(union(shapes), s.size.width, s.size.height, 40, 1)}
}

export const exportSVG = (s: State, which: 'selection' | 'page') => toSVG(s.shapes, which == 'selection' && s.selection.length ? s.selection : null, 0)
