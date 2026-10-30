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
 */

export type Hit = {el: any, [k: string]: any}
export type Pick = (x: number, y: number) => Hit | null

// fields every pointer event carries from the input (clientX, buttons, shiftKey, …)
const BASE = ['clientX', 'clientY', 'offsetX', 'offsetY', 'button', 'buttons', 'pointerId', 'pointerType', 'shiftKey', 'ctrlKey', 'altKey', 'metaKey']

/** dispatch `type` on `el`; `extra` fields (point, distance, object, …) are added to the event */
export function fire(el: any, type: string, init: Record<string, any> = {}, extra: Record<string, any> = {}, bubbles = true): boolean {
  const win: any = el.ownerDocument?.defaultView || {}
  const base: any = {bubbles, cancelable: true}
  for (const k of BASE) if (init[k] !== undefined) base[k] = init[k]
  const E = (/^pointer/.test(type) && win.PointerEvent) || win.MouseEvent || win.Event
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
  /** a native pointer event at scene coordinates (x, y): move, down, up, leave, or any other type (dblclick, contextmenu, wheel) */
  input(type: string, x: number, y: number, init?: Record<string, any>): Hit | null
  /** the hovered element (per the last input) */
  hovered(): any
}

/** `root`: the element enter/leave stop at (the island's children container) */
export function pointerRouter(pick: Pick, root: any): PointerRouter {
  let over: Hit | null = null, down: any = null
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
  return {
    hovered: () => over?.el || null,
    input(type, x, y, init = {}) {
      const hit = type == 'leave' ? null : pick(x, y)
      if (type == 'leave' || type == 'move' || type == 'down' || type == 'up') hover(hit, init)
      if (!hit) { if (type == 'up') down = null; return null }
      const el = hit.el
      if (type == 'move') fire(el, 'pointermove', init, hit)
      else if (type == 'down') { fire(el, 'pointerdown', init, hit); down = el }
      else if (type == 'up') {
        fire(el, 'pointerup', init, hit)
        // click goes to the nearest common ancestor of the down and up targets
        if (down) {
          const cu = chain(el, root), target = chain(down, root).find(e => cu.includes(e))
          if (target) fire(target, 'click', init, hit)
        }
        down = null
      } else if (type != 'leave') fire(el, type, init, hit)
      return hit
    },
  }
}
