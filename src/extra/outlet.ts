/*
 * <Outlet>: one page or step of a map of components, alive only while it is the current one
 * (research: dev-plans/research/wizard). Spike.
 *
 *   <Outlet of={PAGES} route={state.route} query={['session']} />   // route mode
 *   <Outlet of={{ source: Source, review: Review }} from="wizard" /> // a `wizard` behavior's steps
 *   <Outlet of={PANELS} current={state.panel} identity={state.panelFor} />
 *
 * A marker (registered on first use, as widgets: `pres.outlet`) that the owner's reconcile walk
 * rewrites into an ordinary keyed component vnode, `<Current key={identity} state={binding} />`,
 * inside a `display: contents` wrapper. So the page is a tag child of the host (its PARENT reaches
 * the host's CHILD.select(Page)), and a new identity disposes the old instance (DISPOSE, aborted
 * requests, closed connections, stopped timers and watches) and mounts a new one (INITIALIZE,
 * BOOTSTRAP). Nothing in the core.
 *
 * - route mode: current = route.name; identity = name + path (params) + the `query` keys named.
 * - `from`: the host's `wizard` behavior under that key: current = its step; identity = flow key
 *   + step + visit; the step's state is a lens: its own slice (local[step]) over its component's
 *   initialState, with `draft` the flow's draft. Nothing renders until the flow started and while
 *   the flow key the host state names isn't the slice's yet (no step against the old record).
 * - other props pass through to the page (not `of`, `from`, `route`, `query`, `current`,
 *   `identity`, `focus`; `state` binds the page in route / plain mode).
 * - focus: after an identity change (not the first one shown), the first match of `focus`
 *   (default '[data-wizard-focus],h1,h2,h3', tried in order) inside the outlet gets focus, with
 *   tabindex=-1 added when needed; retried each frame for about a second while the page renders.
 *   `focus={false}` turns it off.
 */
import {pres} from '../core/registry'
import {createElement} from '../pragma/index'
import {h} from '../cycle/dom/snabbdom'

const FOCUS = '[data-wizard-focus],h1,h2,h3'

const focusIn = (el: any, sel: string) => {
  let n = 0
  const tryIt = () => {
    if (!el.isConnected && n) return
    for (const s of sel.split(',')) {
      const t = el.querySelector?.(s.trim())
      if (t) {
        if (t.tabIndex < 0 && !t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1')
        return t.focus()
      }
    }
    if (n++ < 60 && typeof requestAnimationFrame == 'function') requestAnimationFrame(tryIt)
  }
  queueMicrotask(tryIt)
}

const shallow = (a: any, b: any) => {
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length == kb.length && ka.every(k => Object.is(a[k], b[k]))
}

// a step's state: its own slice over its component's initialState, plus the flow's draft
const stepLens = (from: string, name: string, C: any, calc: (w: any) => any) => {
  const init = C?.initialState && typeof C.initialState == 'object' ? C.initialState : {}
  let last: any, lo: any, ld: any
  return {
    get: (s: any) => {
      const w = s?.[from]
      if (!w) return undefined
      const own = w.local?.[name], d = w.draft
      if (last && own === lo && d === ld) return last
      lo = own, ld = d
      return last = {...init, ...own, draft: d}
    },
    set: (s: any, v: any) => {
      const w = s?.[from]
      if (!w || !v || typeof v != 'object') return s
      const {draft, ...own} = v, same = shallow(own, {...init, ...w.local?.[name]})
      if (same && draft === w.draft) return s
      return {...s, [from]: calc({...w, draft, local: same ? w.local : {...w.local, [name]: own}})}
    },
  }
}

// owner -> identity -> lens (one per step visit, so the child's binding stays the same object)
const lenses = new WeakMap<any, Map<string, any>>()

function rewrite(n: any, owner: any): any {
  const {of = {}, from, route, query, current, identity, focus, state: bind, ...rest} = n.data.props || {}
  let cur: any = null, id: any = null, st = bind
  if (from != null) {
    const W = owner.def?.view?.uses?.[from]?.$wizard, s = owner.cell?.get(), w = s?.[from]
    if (!W) console.error(`[Sygnal] Outlet: from="${from}" names no wizard() in the component's uses`)
    else if (w?.visit && (!W.keyOf || Object.is(W.keyOf(s) ?? null, w.key))) {
      cur = w.step
      id = `${w.key}:${w.step}:${w.visit}`
      let m = lenses.get(owner)
      if (!m?.has(id)) lenses.set(owner, m = new Map([[id, stepLens(from, cur, of[cur], W.calc)]]))
      st = m.get(id)
    }
  } else if (route) {
    cur = route.name
    const q = (query || []).filter((k: string) => route.query?.[k] != null).map((k: string) => k + '=' + route.query[k]).join('&')
    id = `${route.name}:${route.path}${q ? '?' + q : ''}`
  } else {
    cur = current
    id = identity ?? current
  }
  const C = cur != null ? of[cur] : null
  if (cur != null && !C) console.error(`[Sygnal] Outlet: no component for '${cur}' in of`)
  const child = C ? createElement(C, {...rest, key: id, ...st !== undefined && {state: st}}) : null
  const sel = focus === false ? '' : typeof focus == 'string' ? focus : FOCUS
  const seen = (v: any) => {
    const e = v.elm, was = e.__oid
    e.__oid = C ? id : was
    if (sel && C && was != null && was !== id) focusIn(e, sel)
  }
  return h('div', {attrs: {'data-outlet': ''}, style: {display: 'contents'}, hook: {insert: seen, postpatch: (_: any, v: any) => seen(v)}}, child ? [child] : [])
}

/** One page or step of `of` at a time, keyed by its identity (see the module comment) */
// (a pure expression: a top-level assignment would keep this module in every app's bundle)
export const Outlet: any = /*#__PURE__*/ Object.assign((_props: any): any => null,
  {componentName: 'outlet', preventInstantiation: true, $reg: () => { pres.outlet ||= rewrite }})
