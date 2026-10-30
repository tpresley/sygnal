/**
 * PLAN-5 W-1 (D189/D190/D196): `defineWidget`, a framework-agnostic third-party widget (a date
 * picker, a chart, an editor) as a JSX tag (canonical) that also works as a control spec.
 *
 *   const DatePicker = defineWidget({
 *     tag: 'input',
 *     mount: (el, props, dispatch) => flatpickr(el, { defaultDate: props.value, onChange: ([d]) => dispatch('pick', d) }),
 *     update: (fp, props) => fp.setDate(props.value, false),
 *     unmount: (fp) => fp.destroy(),
 *     events: ['pick'],
 *     commands: { open: (fp) => fp.open() },
 *   })
 *   // view:   <label>Due <DatePicker className="due" value={state.due} /></label>
 *   // intent: DUE: DOM.select('.due').events('pick').detail()
 *   // model:  OPEN_DUE: { ELEMENT: { open: '.due' } }
 *   // alt:    const { Due } = controls({ Due: DatePicker }); DOM.select(Due).events('pick'), { open: Due }
 *
 * 0 B in the core when unused: everything is in this module, and the marker handler is registered
 * by the first defineWidget() call, not on import.
 * - The tag is a function carrying the pragma's control render hook (`__sygnalControl`, CT-1), so
 *   `<DatePicker …/>` never becomes a component. It is also a control spec object (D101/D116:
 *   `kind`, `vnode(props, children, h)`, `commands`), so `controls({ Due: DatePicker })` works.
 * - `vnode()` returns a `widget` marker; the owner's reconcile walk rewrites it through the marker
 *   registry (`pres.widget`, given the marker's path) into the host vnode, with the owner instance
 *   at hand (onError). The host has no children (opaque to snabbdom) and carries the newest props
 *   in `data.wp`; its hooks read the vnode they are given, so `update` always gets the props of
 *   the render being patched (no closure over mount-time props). Each host has its own hook
 *   object: the widget's, then a `ref`'s (the host element), then a `<Transition>`'s (G-363).
 * - 1-R (G-360): the host's key names the widget and the instance (its key in the parent, or its
 *   place when unkeyed), so snabbdom never patches a host into another vnode (a plain element of
 *   the same tag, another widget, the error fallback) or the reverse: the host is destroyed and
 *   the widget unmounts.
 * - The record `{ w (the tag), p (props), i (instance), e (dispatch) }` lives on the host element
 *   as the non-enumerable `__sw` (D200: short, the core reads it), so the instance survives re-renders and keyed moves
 *   (snabbdom moves the element). Mount runs on insert, or on the first patch of an element that
 *   has none (SSR hydration). `update` runs when the props change (shallow; an object host prop
 *   such as `style` one level deep, G-362); without `update`, a change remounts (G-367: a mount
 *   that throws then is SYG660 and leaves no record). `unmount` on destroy (a removed Portal
 *   destroys its content too, G-359).
 * - `className` goes to the host as class-module tokens (G-364): a change toggles only those, not
 *   the classes the library added (flatpickr's `flatpickr-input`).
 * - `dispatch(name, detail)` (mount's third parameter) dispatches a bubbling CustomEvent on the
 *   host: the intent reads it like any DOM event (`.detail()`); isolation (Collection items)
 *   applies as for any element.
 * - Commands: D102's `spec.commands[name](hostElement, options)` resolves the instance from the
 *   host. For selector targets each command whose name the element doesn't already have is also
 *   a method of the host (D190); a declared command whose name is a native method (`focus`,
 *   `close`) is found by the core through `__sw` and wins over the native one, with the
 *   options object (D196, D200).
 * - A widget tag is not a selector: `DOM.select(DatePicker)` matches nothing (SYG143 in dev).
 * - G-413: `ownProps` names props that stay off the host although they'd go there (a part that
 *   puts `aria-label` on its own control).
 * - G-409: mount's fourth parameter `error(e)` reports a later failure the widget caught itself
 *   (fromZag's machine-driven redraws): handled as a throwing `update` (SYG661 + fallback; G-580:
 *   the dev message says the widget reported it through error(e)).
 * - A `mount`/`update` that throws (SYG660/661): reported to the app's onError with phase
 *   'widget' (D105), and the owner's next render shows its `onError` fallback in that instance's
 *   place (G-361: per instance; a render with other props tries again, and the failure is
 *   forgotten when the fallback leaves the page). `unmount` (SYG662): reported, nothing to replace.
 * - Inside `<Portal>`: the Portal's children are rewritten here too (Portal children are not
 *   walked by the core), so a widget works in a portal.
 * - SSR (extra/ssr.ts): the host, with `fallback` inside it; the client patch replaces it with
 *   the keyed host and mounts.
 *
 * - canvas-three (dev-plans/research/canvas-three): `children: true | 'hidden'` makes the widget an
 *   island: its JSX children go (in the marker's `children`, walked by the core like any) into a
 *   container in the host, rendered by the app's DOM driver, so components, Collection, isolation
 *   and intents work inside. `sync(instance, container vnode, host)` runs after mount and after a
 *   patch whose children vnodes changed (by identity: a patch elsewhere doesn't sync). `true`: the
 *   container is visually hidden but accessible (Q4): Enter / Space on a focused child is its
 *   click, and `focus(instance, child | null, host)` hears focus moving. `tags` clears the
 *   pragma's SVG bit for the widget's own vocabulary (F3).
 * - `value` (experimental, Q3): the `value` prop is controlled (extra/controlled.ts): `write` only
 *   for the app's changes, never for echoes of what the widget dispatched as `value.event`
 *   ('change'); `strict` writes back an edit the model didn't take; `read` defines the host's
 *   `value`. `update` isn't called for a change of `value` alone.
 *
 * Dev text lives in the 'sygnal/diagnostics' entry (checks/widgets.ts), reached through the core
 * bridge as `widget(code, widgetTag, owner, extra)`: SYG140 (dispatch of an undeclared event),
 * SYG143, SYG144 (a declared event the host fires natively), SYG660–662. Without the entry, a
 * thrown mount/update/unmount is logged as `[Sygnal SYG66x]` with the error.
 */
import {pres} from '../core/registry'
import {chainHooks, createElement} from '../pragma/index'
import {controlled} from './controlled'

const W = '__sw'

// props that also go to the host element (every prop but key goes to the widget; ref is the host's)
const HOST = /^(id|class(Name)?|style|title|name|placeholder|role|tab[iI]ndex|hidden|lang|dir|attrs)$|^(aria|data)-/

/** the dev entry's reporter (checks/widgets.ts); returns the diagnostic when one was reported
 * (r: G-580, a 661 the widget reported through error(e), not a throwing update) */
const dev = (code: number, w: any, o?: any, x?: any, r?: any): any => (globalThis as any).__SYGNAL_DIAGNOSTICS__?.widget?.(code, w, o, x, r)

let ids = 0

// shallow; G-362: an object host prop (style, attrs, a class map) compares one level deep, so a
// new object with the same entries is no change (snabbdom patches the host from it anyway)
const same = (a: any, b: any, d?: any): any => {
  const k = Object.keys(a)
  return k.length == Object.keys(b).length && k.every(x => a[x] === b[x] ||
    !d && HOST.test(x) && typeof a[x] == 'object' && typeof b[x] == 'object' && a[x] && b[x] && same(a[x], b[x], 1))
}

// k: the host's key, the failure's place; [error, the props of the fallback's last render]; r:
// reported through error(e)
function fail(o: any, w: any, k: any, code: number, e: any, r?: any) {
  e = e instanceof Error ? e : Error(e)
  dev(code, w, o, e, r) || console.error(`[Sygnal SYG${code}]`, e)
  o.app.appError(o, e, 'widget')
  if (code < 662 && !o.disposed) (o.$wf ||= new Map()).set(k, [e]), o.refresh()
}

// visually hidden, still in the accessibility tree (canvas-three Q4): a widget's children
const SR = {position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0', border: '0', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap'}
// what Enter / Space already activates natively
const NATIVE = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/

// without the value prop: whether the widget's own props changed (a `value` widget's value is controlled())
const rest = (p: any, v: any) => { if (!v) return p; const {value, ...r} = p; return r }

/** children widgets: sync(instance, children vnode, host) when the children's vnodes changed (canvas-three D-CT-2) */
function sync(v: any, s: any) {
  const c = v.children?.[0], f = s.w.def.sync
  if (!f || !c) return
  const k = c.children || [], o = s.k
  if (o && o.length == k.length && k.every((x: any, i: number) => x === o[i])) return
  s.k = k
  try { f(s.i, c, v.elm) } catch (x) { fail(v.data.wo, s.w, v.key, 661, x) }
}

function mount(v: any) {
  const el = v.elm, {ww: w, wp: p, wo: o} = v.data, def = w.def, val = def.value
  let s: any
  const d = (n: string, detail?: any) => {
    dev(140, w, o, n)
    // a value widget's own change: recorded before the event, so its echo is known (controlled())
    if (val && n == (val.event || 'change') && s?.c) {
      s.c.local(detail)
      if (s.p.strict ?? val.strict) setTimeout(() => el[W] === s && s.c.settle(s.p.value))
    }
    el.dispatchEvent(new CustomEvent(n, {detail, bubbles: true}))
  }
  let i: any
  dev(144, w, o, el)
  // G-409: mount's fourth parameter reports a later failure (an adapter's own redraw): SYG661,
  // the owner's onError fallback in this instance's place, as for a throwing update (G-580: the
  // dev text says error(e) reported it)
  const err = (x: any) => { el[W] && fail(o, w, v.key, 661, x, 1) }
  try { i = def.mount(el, p, d, err) } catch (x) { return fail(o, w, v.key, 660, x) }
  Object.defineProperty(el, W, {value: s = {w, p, i, e: d}, configurable: true})
  // the tag form's commands: a host method for each one the element doesn't have (D190)
  for (const m in def.commands) m in el || (el[m] = (x: any) => el[W]?.w.commands[m]?.(el, x))
  if (val) {
    s.c = controlled((x: any) => val.write(s.i, x, el), val.equals)
    s.c.prop(p.value)
    if (val.read) Object.defineProperty(el, 'value', {get: () => val.read(s.i, el), configurable: true})
  }
  const c = v.children?.[0]?.elm
  if (c && def.children != 'hidden') {
    // the children are in the accessibility tree: Enter / Space on a focused child is its click,
    // and the widget draws focus where the child is (def.focus(instance, child | null))
    const k = (e: any) => {
      const t = e.target
      if (t == c || NATIVE.test(t.tagName) || e.key != 'Enter' && e.key != ' ') return
      e.preventDefault()
      t.click ? t.click() : t.dispatchEvent(new (t.ownerDocument.defaultView.MouseEvent)('click', {bubbles: true, cancelable: true}))
    }
    const f = (e: any) => def.focus?.(s.i, e.type == 'focusin' ? e.target : null, el)
    c.addEventListener('keydown', k)
    c.addEventListener('focusin', f)
    c.addEventListener('focusout', f)
    s.x = () => { c.removeEventListener('keydown', k); c.removeEventListener('focusin', f); c.removeEventListener('focusout', f) }
  }
  sync(v, s)
}

function destroy(v: any) {
  const el = v.elm, s = el[W]
  if (s) {
    delete el[W]
    s.x?.()
    try { s.w.def.unmount?.(s.i, el) } catch (x) { fail(v.data.wo, s.w, v.key, 662, x) }
  }
}

const hooks: any = {
  insert: mount,
  postpatch(_: any, v: any) {
    const el = v.elm, p = v.data.wp, s = el[W]
    // SSR hydration (the element was patched in place, never inserted): mount now
    if (!s) return mount(v)
    const def = s.w.def, u = def.update, val = def.value
    if (val) s.c.prop(p.value)
    if (!same(rest(s.p, val), rest(p, val))) {
      // G-367: without update, a change remounts
      if (!u) return destroy(v), mount(v)
      try { u(s.i, p, el) } catch (x) { fail(v.data.wo, s.w, v.key, 661, x) }
    }
    s.p = p
    sync(v, s)
  },
  destroy,
}

/** the host vnode for a widget marker (client: the hooks, the owner and the key k; SSR adds the fallback) */
function host(n: any, o?: any, k?: any): any {
  const {ww: w, wp: p, h, attrs, r} = n.data, def = w.def, hp: any = {ref: r}
  for (const x in p) if ((HOST.test(x) || def.hostProps?.includes(x)) && !def.ownProps?.includes(x)) hp[x] = p[x]
  if (hp.className) hp.class = [hp.class, hp.className], delete hp.className
  // canvas-three: a widget's JSX children render (by the app's DOM driver) into a container in the
  // host: visually hidden but accessible, or `hidden` (children: 'hidden'); sync() reads them
  const C = def.children, v = C ? h(def.tag || 'div', hp, h('div', C == 'hidden' ? {hidden: true, 'data-widget-children': ''} : {style: SR, 'data-widget-children': ''}, ...(n.children || []))) : h(def.tag || 'div', hp), d = v.data
  if (attrs) d.attrs = {...d.attrs, ...attrs}
  if (o) {
    v.key = k
    d.ww = w; d.wp = p; d.wo = o
    if (!C) v.children = undefined
    // a hook object per host: a ref's hooks (from h), the widget's, then a Transition's (marker)
    chainHooks(d, hooks)
    n.data.hook && chainHooks(d, n.data.hook)
  }
  return v
}

/** pres.widget: the host, or the owner's fallback where this instance failed */
function rewrite(n: any, o: any, path: string): any {
  const w = n.data.ww, p = n.data.wp, wf = o.$wf
  // the instance: the widget and its key, or its place when unkeyed
  const k = 'w' + w.$i + (n.key == null ? path : '#' + n.key)
  let f = wf?.get(k)
  // a render with other props than the fallback's last one tries again
  if (f && f[1] && !same(f[1], p)) wf.delete(k), f = 0
  if (!f) return host(n, o, k)
  f[1] = p
  const def = o.def, x = n.data.h('div', {attrs: {'data-sygnal-error': def.name}})
  let r: any = x
  try { r = def.onError?.(f[0], {componentName: def.name}) || x } catch (_) {}
  // its own key; the failure is forgotten when it leaves the page (a reopened panel tries again)
  chainHooks((r = {...r, key: k + '!', data: {...r.data}}).data, {destroy: () => wf.delete(k)})
  return r
}

/** widget markers among a Portal's children (the core doesn't walk them): `pres.widget.$k`, which the
 * Portal's rewrite calls (core/markers/portal.ts; G-751: either may be registered first) */
const inPortal = (c: any[], o: any, x: string): any[] =>
  c.map((n, i) => n?.sel == 'widget' ? rewrite(n, o, x + '.' + i) : n?.children ? {...n, children: inPortal(n.children, o, x + '.' + i)} : n)

export function defineWidget(def: any): any {
  // (compile-wasm: set here, not at module level: a top-level assignment kept this module, ~2 KB
  // min, in every app's bundle, used or not)
  pres.widget ||= ((rewrite as any).$k = inPortal, rewrite)
  // canvas-three F3: the widget's own children vocabulary is HTML-namespace, never SVG's (a map's
  // <marker>, a scene's <line>): the pragma's tag bits (src/pragma), bit 2 cleared app-wide
  const t = (createElement as any).$t
  for (const x of def.tags || []) t[x] = /-/.test(x) ? 8 : 0
  const w: any = () => {}, commands: any = {}
  // D200: any name, `close` and `togglePopover` too (the core passes a widget command the options)
  for (const m in def.commands) commands[m] = (el: any, o: any) => el[W] && def.commands[m](el[W].i, o || {}, el)
  return Object.assign(w, {
    kind: 'widget',
    def,
    $i: ++ids,
    events: def.events || [],
    commands,
    // D101/D116: the control spec's vnode(props, children, h): one (marker) element vnode; also
    // the tag form's pragma render hook (no data-control stamp)
    vnode: w.__sygnalControl = (props: any, children: any, h: any) => {
      const {key, ref, ...p} = props || {}
      return {sel: 'widget', data: {ww: w, wp: p, h, r: ref}, children: def.children ? children : undefined, text: undefined, key}
    },
    $ssr: host,
    // D190/D199: a widget tag is not a selector (SYG143 in dev): select its className or a control
    toString: () => (dev(143, w), ':not(*)'),
  })
}
