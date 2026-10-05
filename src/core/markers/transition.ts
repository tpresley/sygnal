/**
 * PLAN-4.6 next core: the Transition marker (R2), registered on import by the public `Transition`
 * module. A template rewrite (registry `pres`): the `transition` marker is replaced by its first
 * child (walked on, at the marker's path), with snabbdom hooks that add the classes as today
 * (component.ts applyTransitionHooks; a copy until R5 deletes that core):
 * `${name}-enter|leave-from` + `-active`, two frames later `-from` becomes `-to`, and at the end
 * (transitionend, or `duration` ms) `-active` and `-to` go. A user's insert/remove hooks on the
 * child still run. G-279: a leaving element pokes the DOM driver once it is gone.
 */
import {pres} from '../registry'
import {NEXT_CORE} from '../build'
import {pokeDOM} from '../../cycle/dom/utils'

function onEnd(el: any, duration: number | undefined, cb: () => void): void {
  if (typeof duration === 'number') return void setTimeout(cb, duration)
  const h = () => { el.removeEventListener('transitionend', h); cb() }
  el.addEventListener('transitionend', h)
}

export function transitionHooks(vnode: any, name: string, duration?: number): any {
  vnode.data = vnode.data || {}
  const hook = vnode.data.hook = vnode.data.hook || {}
  const {insert, remove} = hook
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
  return vnode
}

// D175: registered only where the next core can run (a production build drops it)
if (NEXT_CORE) pres.transition = (n) => {
  const child = n.children?.[0], props = n.data?.props || {}
  // no element child: the text child (or the marker itself, left as it is: today's behaviour)
  if (!child?.sel) return child || n
  return transitionHooks(child, props.name || 'v', props.duration)
}
