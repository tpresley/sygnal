/**
 * PLAN-4.6 core: the Transition marker (R2), registered by the public `Transition`
 * when used (G-751). A template rewrite (registry `pres`): the `transition` marker is replaced by its first
 * child (walked on, at the marker's path), with snabbdom hooks that add the classes as today
 * (the 5.x core's applyTransitionHooks):
 * `${name}-enter|leave-from` + `-active`, two frames later `-from` becomes `-to`, and at the end
 * (the element's CSS transition or animation, or `duration` ms) `-active` and `-to` go. A user's insert/remove hooks on the
 * child still run. G-279: a leaving element pokes the DOM driver once it is gone. Around a
 * Collection (4-I G-559): on each item.
 */
import {pres} from '../registry'
import {pokeDOM} from '../../cycle/dom/utils'

// a computed `<type>-duration` list's longest time with its delay (ms), and the list's length
const longest = (s: any, type: string): number[] => {
  const of = (k: string) => String(s?.[type + k] || '0').split(',').map(v => parseFloat(v) * 1000 || 0), d = of('Duration'), l = of('Delay')
  return [Math.max(...d.map((v, i) => v + l[i % l.length])), d.length]
}

// CSS-9 (Vue's rule): `transitionend` alone never came with no CSS transition on the element (an
// unstyled name, reduced motion), a property that doesn't change or a CSS animation, so a leaving
// element stayed. The computed style says what to wait for (none: done now), only the element's own
// end events count (not a child's, which bubble), and a timer ends what never fires one
function onEnd(el: any, duration: number | undefined, cb: () => void): void {
  if (typeof duration === 'number') return void setTimeout(cb, duration)
  const s = el.ownerDocument?.defaultView?.getComputedStyle?.(el), t = longest(s, 'transition'), a = longest(s, 'animation')
  const anim = a[0] > t[0], [ms, count] = anim ? a : t, type = (anim ? 'animation' : 'transition') + 'end'
  if (!(ms > 0)) return cb()
  let n = 0
  const done = () => { clearTimeout(timer); el.removeEventListener(type, h); cb() }
  const h = (e: any) => { if (e.target == el && ++n >= count) done() }
  const timer = setTimeout(done, ms + 50)
  el.addEventListener(type, h)
}

/** a copy of the vnode with the hooks (4-I: a copy, so an item's own vnode keeps its hooks) */
export function transitionHooks(vnode: any, p: {name?: string, duration?: number}): any {
  const hook = {...vnode.data?.hook}, {insert, remove} = hook, name = p.name || 'v', duration = p.duration
  const run = (el: any, phase: string, done?: () => void) => {
    const c = (s: string) => `${name}-${phase}-${s}`
    el.classList.add(c('from'), c('active'))
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.remove(c('from'))
        el.classList.add(c('to'))
        onEnd(el, duration, () => {
          el.classList.remove(c('active'), c('to'))
          done && done()
        })
      })
    })
  }
  hook.insert = (vn: any) => {
    if (insert) insert(vn)
    const el = vn.elm
    if (el && el.classList) run(el, 'enter')
  }
  hook.remove = (vn: any, rm: () => void) => {
    if (remove) remove(vn, () => {})
    const el = vn.elm
    if (!el || !el.classList) return void rm()
    run(el, 'leave', () => {
      const p = el.parentNode, f = () => el.parentNode || pokeDOM(p)
      rm()
      f()
      el.addEventListener('transitionend', f)
    })
  }
  return {...vnode, data: {...vnode.data, hook}}
}

// 4-J G-566 / 4-K G-573: an item vnode's copies, per name and duration, under a private symbol
// (no global symbol registry entry per name)
const T = Symbol()

const pre = (n: any) => {
  const child = n.children?.[0], p = n.data?.props || {}, k = p.name + ' ' + p.duration
  // no element child: the text child (or the marker itself, left as it is: today's behaviour)
  if (!child?.sel) return child || n
  // 4-I G-559 (D229): a Collection has no element of its own: each item's root element takes the
  // hooks (each item enters and leaves on its own). The host calls `tr` per item vnode; the copy is
  // kept on that vnode for the name and duration, so an unchanged item keeps its vnode (4-J G-566:
  // under a symbol, which nothing that walks a vnode's fields sees). An item whose root is a
  // fragment or text has no element to animate: nothing happens
  return child.sel == 'collection' ? {...child, data: {...child.data, tr: (v: any) => (v[T] ||= {})[k] ||= transitionHooks(v, p)}} : transitionHooks(child, p)
}

/** G-751: registers the rewrite; the public `Transition` calls it when used (its `$reg`) */
export const enableTransition = () => { pres.transition = pre }
