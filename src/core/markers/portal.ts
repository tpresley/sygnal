/**
 * PLAN-4.6 core: the Portal marker (R2), registered by the public `Portal` when used (G-751).
 * A post-processor (registry `posts`) of the injected vnode of an instance whose template has a
 * `portal` marker: the marker becomes a hidden placeholder whose hooks patch its children into
 * the target with a separate snabbdom patch function. The core walks and injects the marker's
 * children as any element's first, so components (and widgets) inside a Portal are the owner's
 * children as anywhere else. As the 5.x core's createPortalPlaceholder:
 * - the target is looked up on insert; one rendered later is retried 10 times, 5 ms apart, and a
 *   late mount pokes the DOM driver (G-261 pokeDOM); never found: SYG417;
 * - an update patches the portal's content; a removal patches it to empty (its destroy hooks
 *   run: G-359) and removes it;
 * - the (injected) children move into the placeholder (`data.portalChildren`).
 * G-316: the mount state lives in one object the placeholder's successive
 * vnodes share (`_p`, handed on by postpatch), so a late-target retry mounts the latest children
 * once, and a removal cancels a pending retry. `_portalVnode` stays on the current vnode (testing).
 * Sift #4: events from the content bubble to the placeholder, through the components around it
 * (as React's portals): the anchor's home (`__sygnalHome`, IsolateModule's upOf) is the
 * placeholder, the app's DOM driver listens on the anchor too, and the content is patched with
 * that driver's isolate module (the components inside keep their scopes). The driver is asked
 * through pokeDOM; with none (a driver without it, a root replaced in the same patch) it is
 * patched with the default modules, its events unheard, as before.
 */
import {posts} from '../registry'
import {init as snabbdomInit} from '../../cycle/dom/snabbdom'
import defaultModules from '../../cycle/dom/modules'
import {pokeDOM, flat} from '../../cycle/dom/utils'
import {warn} from '../../extra/diagnostics/legacy'

let patch: any
// a patch function per app (its DOM driver's isolate module)
const patches = new WeakMap<any, any>()
const notFound = (target: string) => warn('SYG417', 'Portal', `Target '${target}' not found; content not rendered`, 'Render the target first')
// (fragments among the children are flattened, as the DOM driver does)
const box = (children: any[]) => flat({sel: 'div', data: {}, children, text: undefined, elm: undefined, key: undefined})

interface PortalState { v: any; kids: any[]; pv: any; c: any; t: any; dead: boolean; p: any; m: any }

function mount(st: PortalState, target: string): boolean {
  const container = document.querySelector(target)
  if (!container) return false
  const anchor: any = document.createElement('div'), q: any = {}
  container.appendChild(anchor)
  if (st.v.elm) pokeDOM(anchor.__sygnalHome = st.v.elm, q)
  const m = st.m = q.m
  st.p = m ? patches.get(m) || (patches.set(m, snabbdomInit([m.createModule(), ...defaultModules])), patches.get(m)) : patch ||= snabbdomInit(defaultModules)
  st.pv = st.v.data._portalVnode = st.p(anchor, box(st.kids))
  m?.portal(anchor, true)
  st.c = st.v.data._portalContainer = container
  // ui-sweep R4: the placeholder names its content, so ELEMENT commands and sygnal/ui parts find
  // elements the component renders into the portal (extra/elementCommands.ts, ui/shared.ts)
  if (st.v.elm) st.v.elm.__portal = st.pv.elm
  return true
}

/** mount the portal's children into its target (retried while the target isn't rendered yet) */
function start(vnode: any, target: string, kids: any[]) {
  const st: PortalState = vnode.data._p = {v: vnode, kids, pv: null, c: null, t: 0, dead: false, p: null, m: null}
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
    // G-328: a selector a plain div can't match, so snabbdom replaces (destroy / insert) the
    // placeholder when a plain div takes its place, or the reverse, instead of patching it
    sel: 'div.sygnal-portal',
    data: {
      style: {display: 'none'},
      attrs: {'data-sygnal-portal': target},
      portalChildren,
      hook: {
        insert: (vnode: any) => start(vnode, target, vnode.data.portalChildren),
        postpatch: (oldVnode: any, newVnode: any) => {
          const st: PortalState | undefined = oldVnode.data?._p
          // G-318: reached by a patch, never inserted (hydration over server markup, or a plain
          // div at the same position before): it starts here, as the 5.x core mounted it
          if (!st) return void start(newVnode, target, newVnode.data?.portalChildren || [])
          newVnode.data._p = st
          st.v = newVnode
          st.kids = newVnode.data?.portalChildren || []
          // not mounted yet: the pending retry mounts these children
          if (!st.pv) return
          st.pv = newVnode.data._portalVnode = st.p(st.pv, box(st.kids))
          newVnode.data._portalContainer = st.c
          if (newVnode.elm) newVnode.elm.__portal = st.pv.elm, st.pv.elm.__sygnalHome = newVnode.elm
        },
        destroy: (vnode: any) => {
          const st: PortalState | undefined = vnode.data?._p
          if (!st) return
          st.dead = true
          clearTimeout(st.t)
          const el = st.pv?.elm
          // G-359: patched to empty first, so the content's destroy hooks run (a widget unmounts)
          if (el) st.p(st.pv, box([])), el.remove(), st.m?.portal(el, false)
        },
      },
    },
    children: [],
    text: undefined,
    elm: undefined,
    key: undefined,
  }
}

// (a child instance's vnode, data.isolate, was processed by its own instance; nested portals first)
const post = (v: any): any => {
  if (!v || v.data?.isolate) return v
  const c = v.children
  let out: any
  for (let i = 0; c && i < c.length; i++) {
    const o = post(c[i])
    if (o !== c[i]) (out ||= c.slice())[i] = o
  }
  return v.sel === 'portal' ? portalPlaceholder(v.data?.props?.target, out || c || []) : out ? {...v, children: out} : v
}
/** G-751: registers the post-processor; the public `Portal` calls it when used (its `$reg`), not on import */
export const enablePortal = () => { posts.portal = post }
