/**
 * Pointer routing for a painted scene: raw input at canvas pixels → DOM events on the picked
 * element, as sygnal/three's `pointerRouter` does (src/three/events.ts), plus two things an editor
 * needs that it doesn't have yet:
 *
 * - **Implicit pointer capture** (DOM touch semantics, and what `setPointerCapture` gives a DOM
 *   app): between pointerdown and pointerup every move and the up go to the element the press
 *   started on, with no hit test. A drag that leaves its shape (or the canvas: the canvas element
 *   captures the native pointer) keeps its target. `gotpointercapture` / `lostpointercapture` fire
 *   on it. Hover (over/out/enter/leave) is suspended while captured, as in the DOM.
 * - **Every event has a target**: a miss goes to `root` (the background), so one listener on the
 *   canvas sees every press, with `hit` null.
 *
 * Extra fields on every event (`fire()`'s own properties): world {x, y}, screen {x, y}, hit (a data
 * layer's node id, else null), node (the node data).
 */
import {fire} from '../../../../../../src/three/events'

export type Hit = {el: any, hit?: any, node?: any, world?: any, screen?: any}

const chain = (el: any, root: any): any[] => { const o: any[] = []; for (let e = el; e && e !== root; e = e.parentNode) o.push(e); return o }

export function captureRouter(pick: (x: number, y: number) => Hit, root: any, at: (x: number, y: number, h?: Hit) => Hit) {
  let over: Hit | null = null, cap: Hit | null = null, downEl: any = null
  const hover = (h: Hit | null, init: any) => {
    const a = over?.el, b = h?.el
    if (a === b) { over = h; return }
    const ca = chain(a, root), cb = chain(b, root)
    if (a) { fire(a, 'pointerout', init, over!); for (const e of ca) if (!cb.includes(e)) fire(e, 'pointerleave', init, over!, false) }
    over = h
    if (b) { fire(b, 'pointerover', init, h!); for (const e of cb.slice().reverse()) if (!ca.includes(e)) fire(e, 'pointerenter', init, h!, false) }
  }
  return {
    hovered: () => over?.el || null,
    captured: () => cap?.el || null,
    input(type: string, x: number, y: number, init: any = {}): Hit | null {
      // captured: no hit test, the press's target with the pointer's current coordinates
      if (cap && (type == 'move' || type == 'up' || type == 'cancel')) {
        const h = at(x, y, cap)
        if (type == 'move') { fire(cap.el, 'pointermove', init, h); return h }
        const el = cap.el
        cap = null
        fire(el, type == 'up' ? 'pointerup' : 'pointercancel', init, h)
        fire(el, 'lostpointercapture', init, h, false)
        if (type == 'up') {
          // click on the nearest common ancestor of the down and up targets (the DOM's rule)
          const now = pick(x, y), cu = chain(now.el, root), t = chain(downEl, root).find(e => cu.includes(e)) || root
          fire(t, 'click', init, {...h, ...now, world: h.world, screen: h.screen})
          hover(now, init)
        }
        downEl = null
        return h
      }
      if (type == 'leave') { hover(null, init); return null }
      const h = pick(x, y)
      if (type == 'move' || type == 'down') hover(h, init)
      if (type == 'move') fire(h.el, 'pointermove', init, h)
      else if (type == 'down') {
        fire(h.el, 'pointerdown', init, h)
        cap = h; downEl = h.el
        fire(h.el, 'gotpointercapture', init, h, false)
      } else if (type == 'up') fire(h.el, 'pointerup', init, h)
      else fire(h.el, type, init, h)
      return h
    },
  }
}
