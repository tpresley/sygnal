/**
 * Pointer routing for a painted scene: raw input at canvas pixels → DOM events on the picked
 * element, as sygnal/three's `pointerRouter` does (src/three/events.ts), plus two things an editor
 * needs that it doesn't have yet:
 *
 * - **Pointer capture**, as the sygnal/three drag work defines it (side-session note
 *   three-assets-drag: a `capture` prop or `el.setPointerCapture(id)` on a scene element): between
 *   pointerdown and pointerup every move and the up go to the captured element with no hit test,
 *   carrying `captured: true` and `delta` (world units since the last move); `gotpointercapture` /
 *   `lostpointercapture` fire on it; no hover events while captured; a drag of more than 3 px sends
 *   no click. A canvas editor captures every press (implicit, DOM touch semantics: `capture="all"`,
 *   the default); `capture="explicit"` captures only elements with a `capture` prop or whose
 *   `setPointerCapture` a listener called during the pointerdown.
 * - **Every event has a target**: a miss goes to `root` (the background), so one listener on the
 *   canvas sees every press, with `hit` null.
 *
 * Extra fields on every event (`fire()`'s own properties): world {x, y}, screen {x, y}, hit (a data
 * layer's node id, else null), node (the node data).
 */
import {fire} from '../../../../../../src/three/events'

export type Hit = {el: any, hit?: any, node?: any, world?: any, screen?: any}

const chain = (el: any, root: any): any[] => { const o: any[] = []; for (let e = el; e && e !== root; e = e.parentNode) o.push(e); return o }

export function captureRouter(pick: (x: number, y: number) => Hit, root: any, at: (x: number, y: number, h?: Hit) => Hit, mode: () => 'all' | 'explicit' = () => 'all') {
  let over: Hit | null = null, cap: Hit | null = null, downEl: any = null, start: any = null, last: any = null, dragged = false
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
        const h: any = at(x, y, cap)
        h.captured = true
        h.delta = {x: h.world.x - last.x, y: h.world.y - last.y}
        last = h.world
        if (Math.hypot(x - start.x, y - start.y) > 3) dragged = true
        if (type == 'move') { fire(cap.el, 'pointermove', init, h); return h }
        const el = cap.el
        cap = null
        fire(el, type == 'up' ? 'pointerup' : 'pointercancel', init, h)
        fire(el, 'lostpointercapture', init, h, false)
        if (type == 'up') {
          // click on the nearest common ancestor of the down and up targets (the DOM's rule); a drag sends none
          const now = pick(x, y), cu = chain(now.el, root), t = chain(downEl, root).find(e => cu.includes(e)) || root
          if (!dragged) fire(t, 'click', init, {...now, world: h.world, screen: h.screen})
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
        // explicit mode: a listener may call setPointerCapture on the element during the pointerdown
        let asked = mode() == 'all' || !!h.node?.capture
        const el = h.el
        if (!asked) el.setPointerCapture = () => { asked = true }
        try { fire(el, 'pointerdown', init, h) } finally { if (!asked || mode() != 'all') delete el.setPointerCapture }
        downEl = el; start = {x, y}; last = h.world; dragged = false
        if (asked) { cap = h; fire(el, 'gotpointercapture', init, h, false) }
      } else if (type == 'up') {
        fire(h.el, 'pointerup', init, h)
        const cu = chain(h.el, root), t = downEl && (chain(downEl, root).find(e => cu.includes(e)) || root)
        if (t && Math.hypot(x - start.x, y - start.y) <= 3) fire(t, 'click', init, h)
        downEl = null
      }
      else fire(h.el, type, init, h)
      return h
    },
  }
}
