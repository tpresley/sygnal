/**
 * PLAN-4.6 core: the Transition marker (R2), registered on import by the public `Transition`
 * module. A template rewrite (registry `pres`): the `transition` marker is replaced by its first
 * child (walked on, at the marker's path), with snabbdom hooks that add the classes as today
 * (the 5.x core's applyTransitionHooks):
 * `${name}-enter|leave-from` + `-active`, two frames later `-from` becomes `-to`, and at the end
 * (transitionend, or `duration` ms) `-active` and `-to` go. A user's insert/remove hooks on the
 * child still run. G-279: a leaving element pokes the DOM driver once it is gone. Around a
 * Collection (4-I G-559): on each item.
 */
import {pres} from '../registry'
import {pokeDOM} from '../../cycle/dom/utils'

function onEnd(el: any, duration: number | undefined, cb: () => void): void {
  if (typeof duration === 'number') return void setTimeout(cb, duration)
  const h = () => { el.removeEventListener('transitionend', h); cb() }
  el.addEventListener('transitionend', h)
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

pres.transition = (n) => {
  const child = n.children?.[0], p = n.data?.props || {}, k = Symbol.for(p.name + ' ' + p.duration)
  // no element child: the text child (or the marker itself, left as it is: today's behaviour)
  if (!child?.sel) return child || n
  // 4-I G-559 (D229): a Collection has no element of its own: each item's root element takes the
  // hooks (each item enters and leaves on its own). The host calls `tr` per item vnode; the copy is
  // kept on that vnode for the name and duration, so an unchanged item keeps its vnode (4-J G-566:
  // under a symbol, which nothing that walks a vnode's fields sees). An item whose root is a
  // fragment or text has no element to animate: nothing happens
  return child.sel == 'collection' ? {...child, data: {...child.data, tr: (v: any) => v[k] ||= transitionHooks(v, p)}} : transitionHooks(child, p)
}
