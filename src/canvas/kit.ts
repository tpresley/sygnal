/**
 * The editor kit (level 2): what every canvas editor writes in the same shape. Pure functions over
 * plain data; no new concepts.
 *
 * - history('shapes'): commit / undo / redo on one field of the state tree. When `uses` makes the
 *   field shared (sygnal/yjs `shared()`), the same entries route to this user's Yjs UndoManager:
 *   shared() finds `h.undo` / `h.redo` in the model, sends `{ undo: field }` / `{ redo: field }` to
 *   its driver instead, and `commit` closes an undo step (one step per gesture) instead of keeping
 *   snapshots.
 * - handles(box, camera): the selection box, 8 resize handles and the rotate handle as screen-space
 *   JSX nodes with `data-part`
 * - resize(box, part, point, keepAspect) / rotation(box, from, to, step) / turn / scaleInto: the
 *   transform math, rotated boxes included
 */
import {ABORT, createElement as h} from '../index'
import {centre, rotate, toScreen, type Box, type Camera, type Pt} from './geometry'

// ---------------------------------------------------------------- history

/** the marker sygnal/yjs's shared() reads on `h.undo` / `h.redo` (no import either way) */
const HISTORY = Symbol.for('sygnal.history')

export interface History<S> {
  readonly field: string
  /** `next` as the field's new value, one undo step back to `before` (default: the field's value now) */
  commit(s: S, next: any, before?: any): S
  /** model entries: the previous / next step, ABORT when there is none */
  undo(s: S): S
  redo(s: S): S
  canUndo(s: S): boolean
  canRedo(s: S): boolean
}

/**
 * Undo / redo over one field. `commit(s, next, before?)` records `before` when the field changes; a
 * gesture passes the value from its start, so a whole drag is one step. `after(s)` fixes up the
 * rest of the state after an undo / redo (a selection of shapes that no longer exist). The local
 * history keeps `past` / `future` arrays in state (structural sharing keeps them cheap).
 *
 * Shared (sygnal/yjs): `commit` bumps `state[step]` (default `<field>Step`), which closes this
 * user's current undo step; canUndo / canRedo read shared()'s `history` key.
 */
export function history<S extends Record<string, any>>(field: string, {limit = 200, after = (s: S) => s, step = field + 'Step'}: {limit?: number, after?: (s: S) => S, step?: string} = {}): History<S> {
  const self: any = {
    field, after, step,
    // set by shared() when it syncs `field`: { history: its history key }
    shared: null as null | {history?: string},
    commit(s: any, next: any, before = s[field]) {
      if (self.shared) return {...s, [field]: next, [step]: (s[step] || 0) + 1}
      return next === before ? {...s, [field]: next} : {...s, [field]: next, past: [...(s.past || []).slice(-limit + 1), before], future: []}
    },
    undo(s: any) {
      const p = s.past || []
      return p.length ? after({...s, [field]: p[p.length - 1], past: p.slice(0, -1), future: [s[field], ...(s.future || [])]}) : ABORT
    },
    redo(s: any) {
      const f = s.future || []
      return f.length ? after({...s, [field]: f[0], past: [...(s.past || []), s[field]], future: f.slice(1)}) : ABORT
    },
    canUndo: (s: any) => self.shared ? !!s[self.shared.history]?.canUndo : !!s.past?.length,
    canRedo: (s: any) => self.shared ? !!s[self.shared.history]?.canRedo : !!s.future?.length,
  }
  self.undo[HISTORY] = self.redo[HISTORY] = self
  return self
}

// ---------------------------------------------------------------- transform handles and math

export const PARTS: Record<string, [number, number]> = {nw: [0, 0], n: [.5, 0], ne: [1, 0], e: [1, .5], se: [1, 1], s: [.5, 1], sw: [0, 1], w: [0, .5]}
/** a point of the box (u, v in 0..1 of its size, dy world units below), rotated with it */
export const boxPoint = (b: Box, u: number, v: number, dy = 0): Pt => rotate({x: b.x + b.width * u, y: b.y + b.height * v + dy}, centre(b), b.rotation || 0)

/** the selection box, its eight resize handles and the rotate handle (24 px above the top edge), screen-space JSX nodes; `grips: false` (a move in progress): the box alone */
export function handles(box: Box, cam: Camera, {color = '#0d99ff', size = 8, rotateOffset = 24, grips = true} = {}): any[] {
  const out: any[] = [], z = cam.zoom, r = box.rotation || 0
  const p0 = toScreen(cam, box.x, box.y)
  out.push(h('rect', {className: 'sel-box', space: 'screen', x: p0.x, y: p0.y, width: box.width * z, height: box.height * z, rotation: r, fill: 'none', stroke: color, strokeWidth: 1.5, pointerEvents: 'none'}))
  if (!grips) return out
  for (const part in PARTS) {
    const [u, v] = PARTS[part], w = boxPoint(box, u, v), p = toScreen(cam, w.x, w.y)
    out.push(h('rect', {className: 'handle', data: {part}, 'aria-label': `Resize ${part}`, space: 'screen', x: p.x - size / 2, y: p.y - size / 2, width: size, height: size, rotation: r, fill: '#fff', stroke: color, strokeWidth: 1}))
  }
  const w = boxPoint(box, 0.5, 0, -rotateOffset / z), p = toScreen(cam, w.x, w.y)
  out.push(h('ellipse', {className: 'handle rotate', data: {part: 'rotate'}, 'aria-label': 'Rotate', space: 'screen', x: p.x - 5, y: p.y - 5, width: 10, height: 10, fill: '#fff', stroke: color, strokeWidth: 1}))
  return out
}

/** the box after dragging handle `part` to world point p; keep: the aspect ratio (shift) */
export function resize(b: Box, part: string, p: Pt, keep = false): Box {
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

/** a box `o` inside group box `b` after the group became `nb` (positions and sizes scale) */
export const scaleInto = <T extends Box>(o: T, b: Box, nb: Box): T => {
  const sx = b.width ? nb.width / b.width : 1, sy = b.height ? nb.height / b.height : 1
  return {...o, x: nb.x + (o.x - b.x) * sx, y: nb.y + (o.y - b.y) * sy, width: o.width * sx, height: o.height * sy}
}

/** degrees turned around the box's centre from `from` to `to`; `step` snaps the resulting angle */
export function rotation(b: Box, from: Pt, to: Pt, step = 0): number {
  const c = centre(b)
  let d = (Math.atan2(to.y - c.y, to.x - c.x) - Math.atan2(from.y - c.y, from.x - c.x)) * 180 / Math.PI
  if (step) d = Math.round(((b.rotation || 0) + d) / step) * step - (b.rotation || 0)
  return d
}

/** a box turned by `deg` around point c (its own rotation adds up) */
export const turn = <T extends Box>(o: T, c: Pt, deg: number): T => {
  const oc = rotate(centre(o), c, deg), r = Math.round(((o.rotation || 0) + deg) * 100) / 100 % 360
  return {...o, x: oc.x - o.width / 2, y: oc.y - o.height / 2, rotation: r < 0 ? r + 360 : r}
}
