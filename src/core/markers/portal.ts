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
 */
import {pres} from '../registry'
import {init as snabbdomInit} from '../../cycle/dom/snabbdom'
import defaultModules from '../../cycle/dom/modules'
import {pokeDOM} from '../../cycle/dom/utils'
import {warn} from '../../extra/diagnostics/legacy'

let patch: any
const notFound = (target: string) => warn('SYG417', 'Portal', `Target '${target}' not found; content not rendered`, 'Render the target first')
const box = (children: any[]) => ({sel: 'div', data: {}, children, text: undefined, elm: undefined, key: undefined})

function mount(vnode: any, target: string, children: any[]): void {
  const container = document.querySelector(target)
  if (!container) return void notFound(target)
  const anchor = document.createElement('div')
  container.appendChild(anchor)
  vnode.data._portalVnode = (patch ||= snabbdomInit(defaultModules))(anchor, box(children))
  vnode.data._portalContainer = container
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
        insert: (vnode: any) => {
          let attempts = 0
          const tryMount = () => {
            if (vnode.data._portalVnode) return
            if (document.querySelector(target)) {
              mount(vnode, target, portalChildren)
              if (attempts) pokeDOM(vnode.data._portalContainer)
            } else if (attempts++ < 10) setTimeout(tryMount, 5)
            else notFound(target)
          }
          tryMount()
        },
        postpatch: (oldVnode: any, newVnode: any) => {
          const prev = oldVnode.data?._portalVnode, container = oldVnode.data?._portalContainer
          const kids = newVnode.data?.portalChildren || []
          if (!prev || !container) {
            if (!newVnode.data._portalVnode) mount(newVnode, target, kids)
            return
          }
          newVnode.data._portalVnode = patch(prev, box(kids))
          newVnode.data._portalContainer = container
        },
        destroy: (vnode: any) => {
          const pv = vnode.data?._portalVnode
          if (pv && pv.elm && pv.elm.parentNode) pv.elm.parentNode.removeChild(pv.elm)
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
