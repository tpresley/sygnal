/**
 * The editor kit (sygnal/canvas proposal, level 2): what every canvas editor wrote by hand in the
 * Figma-lite (app/) and needs in the same shape. Pure functions and intent helpers; no new concepts.
 *
 * - keymap(DOM, { 'mod+z': 'UNDO', 'shift+mod+z': 'REDO', delete: 'DELETE', left: ['NUDGE', { dx: -1 }] })
 *   → one named action stream per entry (merged when several keys name one action), default
 *   prevented, never while typing in a field
 * - history('shapes'): commit / undo / redo on one field of the state tree
 * - handles(box, camera): the resize + rotate handles as screen-space JSX nodes (`data-part`)
 * - resize(box, part, point, keepAspect) / rotation(box, from, to, step): the transform math
 */
import {xs} from 'sygnal'
import {centre, rotate, toScreen, type Box, type Camera, type Pt} from './geometry'

// ---------------------------------------------------------------- keymap

const TYPING = (t: any) => /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName) || t?.isContentEditable
const ALIAS: Record<string, string> = {left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown', del: 'delete', esc: 'escape', space: ' '}

type Combo = {key: string, mod: boolean, shift: boolean, alt: boolean}
const parse = (c: string): Combo => {
  const parts = c.toLowerCase().split('+')
  const key = parts.pop()!
  return {key: ALIAS[key] || key, mod: parts.includes('mod'), shift: parts.includes('shift'), alt: parts.includes('alt')}
}
// shift+1 is "!" in e.key: digits match e.code
const keyOf = (e: any) => /^Digit\d$/.test(e.code || '') ? e.code.slice(5) : (e.key || '').toLowerCase()
const matches = (c: Combo, e: any) => keyOf(e) == c.key && !!(e.metaKey || e.ctrlKey) == c.mod && !!e.altKey == c.alt && !!e.shiftKey == c.shift

export function keymap(DOM: any, table: Record<string, string | [string, any]>): Record<string, any> {
  const entries = Object.entries(table).map(([combo, act]) => ({combo: parse(combo), name: Array.isArray(act) ? act[0] : act, data: Array.isArray(act) ? act[1] : undefined}))
  const find = (e: any) => TYPING(e.target) ? null : entries.find(x => matches(x.combo, e)) || null
  const keys = DOM.select('document').events('keydown', {preventDefault: (e: any) => !!find(e)}).map(find).filter(Boolean)
  const out: Record<string, any> = {}
  for (const name of new Set(entries.map(x => x.name))) out[name] = keys.filter((k: any) => k.name == name).map((k: any) => k.data)
  return out
}
export const merge = (...s: any[]) => xs.merge(...s)

// ---------------------------------------------------------------- history

/**
 * Undo / redo over one field. `commit(s, next, before?)` records `before` (default: the field's
 * value now) when the field changes; a gesture passes the value from its start, so a whole drag is
 * one step. `after(s)` fixes up the rest of the state after undo / redo (a selection of shapes that
 * no longer exist).
 */
export function history<S extends Record<string, any>>(field: keyof S & string, {limit = 200, after = (s: S) => s}: {limit?: number, after?: (s: S) => S} = {}) {
  type H = S & {past: any[], future: any[]}
  return {
    commit: (s: H, next: any, before = s[field]): H => next === before ? {...s, [field]: next} : {...s, [field]: next, past: [...s.past.slice(-limit + 1), before], future: []},
    undo: (s: H): H | null => s.past.length ? after({...s, [field]: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s[field], ...s.future]}) as H : null,
    redo: (s: H): H | null => s.future.length ? after({...s, [field]: s.future[0], past: [...s.past, s[field]], future: s.future.slice(1)}) as H : null,
  }
}

// ---------------------------------------------------------------- transform handles and math

export const PARTS: Record<string, [number, number]> = {nw: [0, 0], n: [.5, 0], ne: [1, 0], e: [1, .5], se: [1, 1], s: [.5, 1], sw: [0, 1], w: [0, .5]}
/** a point of the box (u, v in 0..1 of its size, dy world units below), rotated with it */
export const boxPoint = (b: Box, u: number, v: number, dy = 0): Pt => rotate({x: b.x + b.width * u, y: b.y + b.height * v + dy}, centre(b), b.rotation || 0)

/** the selection box, its eight resize handles and the rotate handle (24 px above the top edge), screen-space JSX nodes; `grips: false` (a move in progress): the box alone */
export function handles(box: Box, cam: Camera, {color = '#0d99ff', size = 8, rotateOffset = 24, grips = true} = {}) {
  const out: any[] = [], z = cam.zoom, r = box.rotation || 0
  const p0 = toScreen(cam, box.x, box.y)
  out.push(<rect className="sel-box" space="screen" x={p0.x} y={p0.y} width={box.width * z} height={box.height * z} rotation={r} fill="none" stroke={color} strokeWidth={1.5} pointerEvents="none" />)
  if (!grips) return out
  for (const [part, [u, v]] of Object.entries(PARTS)) {
    const w = boxPoint(box, u, v), p = toScreen(cam, w.x, w.y)
    out.push(<rect className="handle" data={{part}} aria-label={`Resize ${part}`} space="screen" x={p.x - size / 2} y={p.y - size / 2} width={size} height={size} rotation={r} fill="#fff" stroke={color} strokeWidth={1} />)
  }
  const w = boxPoint(box, 0.5, 0, -rotateOffset / z), p = toScreen(cam, w.x, w.y)
  out.push(<ellipse className="handle rotate" data={{part: 'rotate'}} aria-label="Rotate" space="screen" x={p.x - 5} y={p.y - 5} width={10} height={10} fill="#fff" stroke={color} strokeWidth={1} />)
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
