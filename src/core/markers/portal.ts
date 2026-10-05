/**
 * PLAN-4.6 next core: the Portal marker (R2), registered on import by the public `Portal` module.
 * A template rewrite (registry `pres`): the `portal` marker becomes a hidden placeholder whose
 * hooks patch its children into the target with a separate snabbdom patch function. As today
 * (component.ts createPortalPlaceholder; a copy until R5 deletes that core):
 * - the target is looked up on insert; one rendered later is retried 10 times, 5 ms apart, and a
 *   late mount pokes the DOM driver (G-261 pokeDOM); never found: SYG417;
 * - an update patches the portal's content; a removal removes it;
 * - the children move into the placeholder unprocessed (components inside a Portal are not
 *   instantiated, as today).
 * G-316 (next core only): the mount state lives in one object the placeholder's successive
 * vnodes share (`_p`, handed on by postpatch), so a late-target retry mounts the latest children
 * once, and a removal cancels a pending retry. `_portalVnode` stays on the current vnode (testing).
 */
import {pres} from '../registry'
import {init as snabbdomInit} from '../../cycle/dom/snabbdom'
import defaultModules from '../../cycle/dom/modules'
import {pokeDOM} from '../../cycle/dom/utils'
import {warn} from '../../extra/diagnostics/legacy'

let patch: any
const notFound = (target: string) => warn('SYG417', 'Portal', `Target '${target}' not found; content not rendered`, 'Render the target first')
const box = (children: any[]) => ({sel: 'div', data: {}, children, text: undefined, elm: undefined, key: undefined})

interface PortalState { v: any; kids: any[]; pv: any; c: any; t: any; dead: boolean }

function mount(st: PortalState, target: string): boolean {
  const container = document.querySelector(target)
  if (!container) return false
  const anchor = document.createElement('div')
  container.appendChild(anchor)
  st.pv = st.v.data._portalVnode = (patch ||= snabbdomInit(defaultModules))(anchor, box(st.kids))
  st.c = st.v.data._portalContainer = container
  return true
}

/** mount the portal's children into its target (retried while the target isn't rendered yet) */
function start(vnode: any, target: string, kids: any[]) {
  const st: PortalState = vnode.data._p = {v: vnode, kids, pv: null, c: null, t: 0, dead: false}
  let attempts = 0
  const tryMount = () => {
    st.t = 0
    if (st.dead || st.pv) return
    if (mount(st, target)) { if (attempts) pokeDOM(st.c) }
    else if (attempts++ < 10) st.t = setTimeout(tryMount, 5)
    else notFound(target)
  }
  tryMount()
}

export function portalPlaceholder(target: string, children: any[]): any {
  const portalChildren = children || []
  return {
    sel: 'div',
    data: {
      style: {display: 'none'},
      attrs: {'data-sygnal-portal': target},
      portalChildren,
      hook: {
        insert: (vnode: any) => start(vnode, target, portalChildren),
        postpatch: (oldVnode: any, newVnode: any) => {
          const st: PortalState | undefined = oldVnode.data?._p
          // G-318: reached by a patch, never inserted (hydration over server markup, or a plain
          // div at the same position before): it starts here, as the current core mounts it
          if (!st) return void start(newVnode, target, newVnode.data?.portalChildren || [])
          newVnode.data._p = st
          st.v = newVnode
          st.kids = newVnode.data?.portalChildren || []
          // not mounted yet: the pending retry mounts these children
          if (!st.pv) return
          st.pv = newVnode.data._portalVnode = patch(st.pv, box(st.kids))
          newVnode.data._portalContainer = st.c
        },
        destroy: (vnode: any) => {
          const st: PortalState | undefined = vnode.data?._p
          if (!st) return
          st.dead = true
          clearTimeout(st.t)
          const el = st.pv?.elm
          if (el && el.parentNode) el.parentNode.removeChild(el)
        },
      },
    },
    children: [],
    text: undefined,
    elm: undefined,
    key: undefined,
  }
}

pres.portal = (n) => portalPlaceholder(n.data?.props?.target, n.children || [])
