/**
 * DOM-shaped events for picked scene nodes (three.js raycasts, canvas 2D hit tests).
 *
 * A scene node is an element: a real DOM element (an island inside a DOM app) or a sygnal/host
 * HostElement (a whole app on a host target). `fire()` makes the event the way that element's
 * document makes events, so the app's DOM driver delegates it like any other: `DOM.click('.cube')`
 * in an intent, isolation per component included.
 *
 * `pointerRouter(pick)` turns raw pointer input at (x, y) into the DOM's sequence on the topmost
 * picked element: pointerover/pointerenter, pointermove, pointerdown, pointerup, click (on the
 * nearest common ancestor of the down and up targets, as the DOM does), pointerout/pointerleave.
 * Only the topmost hit is a target and the event bubbles up the scene graph (DOM semantics, not
 * react-three-fiber's "every intersection" propagation).
 *
 * Pointer capture (the DOM's setPointerCapture): an element with a `capture` prop captures the
 * pointer that went down on it (or inside it), and `el.setPointerCapture(e.pointerId)` on a scene
 * element does the same from code. Until pointerup / pointercancel, pointermove and pointerup go
 * to that element wherever the pointer is (off the object, off the canvas), with
 * `gotpointercapture` / `lostpointercapture` around them. A captured event's `point` is on the
 * drag plane through the point the pointer went down on: `capture="xz"` (the ground), `"xy"`,
 * `"yz"`, else (`capture`, setPointerCapture) facing the camera; `delta` is the move from that
 * point, `ray` the pointer's ray. No hover events while captured; a capture that moved more than
 * SLOP px clicks nothing (a drag is not a click: the one difference from the DOM).
 *
 * `draggable` (HTML drag and drop): after a SLOP px move from a pointerdown on it, `dragstart`
 * (cancelable), `drag` on it per move, `dragenter` / `dragover` / `dragleave` on the element
 * under the pointer (the ray passes through the dragged object), `drop` there if its last
 * dragover was canceled (preventDefault: processDrag's dropZone does), `dragend`. The events carry
 * a DataTransfer-shaped `dataTransfer` (one per drag) and the hit's fields. No pointer events and no
 * click during the drag, unless the element also captures (then it gets pointermove too: it can
 * follow the pointer while the drop target sees dragover).
 */

export type Hit = {el: any, [k: string]: any}
/** (x, y) → the topmost hit; `skip`: an element whose objects the pick passes through */
export type Pick = (x: number, y: number, skip?: any) => Hit | null
export type Ray = {origin: number[], direction: number[], forward?: number[], ndc?: number[]}
export interface RouterOptions {
  /** the pointer's ray at (x, y) (captured events' drag plane) */
  ray?(x: number, y: number): Ray | null
  /** an element's target prop (`capture`, `draggable`) */
  prop?(el: any, key: string): any
}

/** how far (px) a pointer moves before a press is a drag */
export const SLOP = 3

// fields every pointer event carries from the input (clientX, buttons, shiftKey, …)
const BASE = ['clientX', 'clientY', 'offsetX', 'offsetY', 'button', 'buttons', 'pointerId', 'pointerType', 'shiftKey', 'ctrlKey', 'altKey', 'metaKey']

/** dispatch `type` on `el`; `extra` fields (point, distance, object, …) are added to the event */
export function fire(el: any, type: string, init: Record<string, any> = {}, extra: Record<string, any> = {}, bubbles = true): boolean {
  const win: any = el.ownerDocument?.defaultView || {}
  const base: any = {bubbles, cancelable: true}
  for (const k of BASE) if (init[k] !== undefined) base[k] = init[k]
  const E = (/^(pointer|gotp|lostp)/.test(type) && win.PointerEvent) || (/^drag|^drop$/.test(type) && win.DragEvent) || win.MouseEvent || win.Event
  const ev = new E(type, base)
  // a browser event's own fields are read-only getters: the scene's go on as own properties
  for (const k in extra) Object.defineProperty(ev, k, {value: extra[k], configurable: true, enumerable: true})
  return el.dispatchEvent(ev)
}

const chain = (el: any, root: any): any[] => {
  const out: any[] = []
  for (let e = el; e && e !== root; e = e.parentNode) out.push(e)
  return out
}

export interface PointerRouter {
  /** a native pointer event at scene coordinates (x, y): move, down, up, cancel, leave, or any other type (dblclick, contextmenu, wheel) */
  input(type: string, x: number, y: number, init?: Record<string, any>): Hit | null
  /** the hovered element (per the last input) */
  hovered(): any
  /** the element that has the pointer captured, if any */
  captured(): any
  /** whether a press on a draggable element, or its drag, is under way */
  dragging(): boolean
  /** capture the pointer to `el` (`kind`: its drag plane, else its `capture` prop) */
  capture(el: any, pointerId?: number, kind?: any): void
  release(el?: any): void
}

const NORMALS: Record<string, number[]> = {xz: [0, 1, 0], xy: [0, 0, 1], yz: [1, 0, 0]}
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
// where the ray meets the plane through `at` with normal `n` (null: parallel, or behind the camera)
const onPlane = (r: Ray, n: number[], at: number[]) => {
  const d = dot(n, r.direction)
  if (Math.abs(d) < 1e-9) return null
  const t = dot(n, sub(at, r.origin)) / d
  return t < 0 ? null : r.origin.map((o, i) => o + r.direction[i] * t)
}
// a DataTransfer-shaped object: the scene's drag doesn't go through the browser's
const transfer = () => {
  const data = new Map<string, string>()
  return {
    dropEffect: 'none', effectAllowed: 'all', files: [], items: [],
    get types() { return [...data.keys()] },
    setData: (t: string, v: string) => { data.set(t, String(v)) },
    getData: (t: string) => data.get(t) ?? '',
    clearData: (t?: string) => { t == null ? data.clear() : data.delete(t) },
    setDragImage() {},
  }
}
const P = '__sp'
// a hit's fields for an event (its element is the event's target)
const fields = (h: Hit | null) => { const {el, ...f} = h || {} as any; return f }

/** `root`: the element enter/leave stop at (the island's children container) */
export function pointerRouter(pick: Pick, root: any, opts: RouterOptions = {}): PointerRouter {
  let over: Hit | null = null, down: any = null, at: number[] = [0, 0], grab: Hit | null = null
  // the capture: element, pointer, drag plane (normal, point), farthest move (px)
  let cap: {el: any, id: any, n?: number[], p?: number[], last?: number[], moved: number} | null = null
  // the HTML drag: source, started, element under the pointer, its last dragover canceled, dataTransfer
  let drag: {src: any, on: boolean, over: any, ok: boolean, dt: any} | null = null
  const prop = (el: any, k: string) => { const v = opts.prop?.(el, k); return v === false || v == null ? undefined : v }
  const closest = (el: any, k: string) => chain(el, root).find(e => prop(e, k) !== undefined)
  const hover = (hit: Hit | null, init: any) => {
    const a = over?.el, b = hit?.el
    if (a === b) { over = hit; return }
    const ca = chain(a, root), cb = chain(b, root)
    if (a) {
      fire(a, 'pointerout', init, over!)
      for (const e of ca) if (!cb.includes(e)) fire(e, 'pointerleave', init, over!, false)
    }
    over = hit
    if (b) {
      fire(b, 'pointerover', init, hit!)
      for (const e of cb.slice().reverse()) if (!ca.includes(e)) fire(e, 'pointerenter', init, hit!, false)
    }
  }
  const capture = (el: any, id: any = 1, kind?: any) => {
    if (cap?.el === el) return
    if (cap) release()
    kind ??= prop(el, 'capture')
    const r = opts.ray?.(at[0], at[1])
    cap = {el, id, n: NORMALS[kind] || r?.forward, p: grab?.point, moved: 0}
    fire(el, 'gotpointercapture', {pointerId: id})
  }
  const release = (init?: any) => {
    const c = cap
    cap = null
    if (c) fire(c.el, 'lostpointercapture', {...init, pointerId: c.id})
  }
  // setPointerCapture & co. on the scene's elements: the router's capture, not the browser's (which
  // would send the canvas's pointer to a hidden element)
  const patch = (el: any) => {
    for (const e of chain(el, root)) if (!e[P]) Object.defineProperties(e, {
      [P]: {value: 1},
      setPointerCapture: {value: (id: any) => capture(e, id ?? 1), configurable: true},
      releasePointerCapture: {value: () => { if (cap?.el === e) release() }, configurable: true},
      hasPointerCapture: {value: () => cap?.el === e, configurable: true},
    })
  }
  // a captured event's fields: the point on the drag plane, its move from the grab point, the ray
  const capFields = (x: number, y: number, init: any) => {
    const c = cap!, r = opts.ray?.(x, y)
    c.moved = Math.max(c.moved, Math.hypot(x - at[0], y - at[1]))
    const p = r && c.n && c.p && onPlane(r, c.n, c.p) || c.last
    c.last = p
    return {...(p && {point: p, delta: c.p ? sub(p, c.p) : [0, 0, 0]}), ...(r && {ray: {origin: r.origin, direction: r.direction}, ndc: r.ndc}), captured: true, pointerId: init.pointerId ?? c.id}
  }
  // the HTML drag's step; true: the input is the drag's (no pointer events for it)
  const dragStep = (type: string, x: number, y: number, init: any): boolean => {
    const d = drag!
    if (!d.on) {
      if (type != 'move') { drag = null; return false }
      if (Math.hypot(x - at[0], y - at[1]) <= SLOP) return false
      d.dt = transfer()
      if (!fire(d.src, 'dragstart', init, {...fields(grab), dataTransfer: d.dt})) { drag = null; return false }
      d.on = true
    }
    const hit = pick(x, y, d.src), t = hit?.el, ex = {...fields(hit), dataTransfer: d.dt}
    if (type == 'move') {
      fire(d.src, 'drag', init, {dataTransfer: d.dt})
      if (t !== d.over) {
        if (d.over) fire(d.over, 'dragleave', init, ex)
        if (t) fire(t, 'dragenter', init, ex)
        d.over = t
      }
      d.ok = !!t && !fire(t, 'dragover', init, ex)
    } else {
      if (type == 'up' && d.over && d.ok) d.dt.dropEffect = d.dt.effectAllowed == 'all' ? 'move' : d.dt.effectAllowed.replace(/^(copy|link|move).*/i, '$1'), fire(d.over, 'drop', init, ex)
      else if (d.over) fire(d.over, 'dragleave', init, ex)
      fire(d.src, 'dragend', init, {dataTransfer: d.dt})
      drag = null
    }
    return !cap
  }
  return {
    hovered: () => over?.el || null,
    captured: () => cap?.el || null,
    dragging: () => !!drag,
    capture,
    release: (el?: any) => { if (!el || cap?.el === el) release() },
    input(type, x, y, init = {}) {
      const end = type == 'up' || type == 'cancel'
      // a drag (draggable): its events instead of the pointer's
      const wasDrag = !!drag?.on
      if (drag && (type == 'move' || end) && dragStep(type, x, y, init)) {
        if (end) { down = null; hover(type == 'up' ? pick(x, y) : null, init) }
        return null
      }
      if (cap && (type == 'move' || end || type == 'leave')) {
        // captured: the pointer is the element's wherever it is (no hover events, nothing on leave)
        if (type == 'leave') return null
        const c = cap, ex = capFields(x, y, init)
        if (type == 'move') { fire(c.el, 'pointermove', init, ex); return null }
        fire(c.el, type == 'up' ? 'pointerup' : 'pointercancel', init, ex)
        release(init)
        const h = type == 'up' ? pick(x, y) : null
        // the click: on the common ancestor of the down target and the captured one, unless it was a drag
        if (h && down && c.moved <= SLOP && !wasDrag) {
          const cu = chain(c.el, root), target = chain(down, root).find(e => cu.includes(e))
          if (target) fire(target, 'click', init, h.el == c.el ? h : ex)
        }
        down = null
        hover(h, init)
        return null
      }
      const hit = type == 'leave' || type == 'cancel' ? null : pick(x, y)
      if (type == 'leave' || type == 'move' || type == 'down' || end) hover(hit, init)
      if (!hit) { if (end) down = null; return null }
      const el = hit.el
      if (type == 'move') fire(el, 'pointermove', init, hit)
      else if (type == 'down') {
        at = [x, y], grab = hit, down = el
        patch(el)
        fire(el, 'pointerdown', init, hit)
        // a `capture` prop (unless a handler captured it already)
        if (!cap) { const c = closest(el, 'capture'); if (c) capture(c, init.pointerId ?? 1) }
        const d = closest(el, 'draggable')
        drag = d ? {src: d, on: false, over: null, ok: false, dt: null} : null
      } else if (type == 'up') {
        fire(el, 'pointerup', init, hit)
        // click goes to the nearest common ancestor of the down and up targets
        if (down && !wasDrag) {
          const cu = chain(el, root), target = chain(down, root).find(e => cu.includes(e))
          if (target) fire(target, 'click', init, hit)
        }
        down = null
      } else if (type != 'leave' && type != 'cancel') fire(el, type, init, hit)
      return hit
    },
  }
}
