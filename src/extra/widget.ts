/**
 * PLAN-5 W-1 (D189/D190/D196): `defineWidget`, a framework-agnostic third-party widget (a date
 * picker, a chart, an editor) as a JSX tag (canonical) that also works as a control spec.
 *
 *   const DatePicker = defineWidget({
 *     tag: 'input',
 *     mount: (el, props, emit) => flatpickr(el, { defaultDate: props.value, onChange: ([d]) => emit('pick', d) }),
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
 *   registry (`pres.widget`) into the host vnode, with the owner instance at hand (onError). The
 *   host has no children (opaque to snabbdom) and carries the newest props in `data.wp`; its hooks
 *   are shared functions that read the vnode they are given, so `update` always gets the props of
 *   the render being patched (no closure over mount-time props).
 * - The record `{ w (the tag), p (props), i (instance), e (emit) }` lives on the host element as
 *   the non-enumerable `__sygnalWidget`, so the instance survives re-renders and keyed moves
 *   (snabbdom moves the element). Mount runs on insert, or on the first patch of an element that
 *   has none (SSR hydration). `update` runs when the props change (shallow); without `update`, a
 *   change remounts. `unmount` on destroy.
 * - `emit(name, detail)` dispatches a bubbling CustomEvent on the host: the intent reads it like
 *   any DOM event (`.detail()`); isolation (Collection items) applies as for any element.
 * - Commands: D102's `spec.commands[name](hostElement, options)` resolves the instance from the
 *   host. For selector targets each command whose name the element doesn't already have is also
 *   a method of the host (D190); a declared command whose name is a native method (`focus`) is
 *   found by the core through `__sygnalWidget` and wins over the native one (D196). `close` and
 *   `togglePopover` are refused (the core passes them returnValue / force, SYG142).
 * - A widget tag is not a selector: `DOM.select(DatePicker)` matches nothing (SYG143 in dev).
 * - A `mount`/`update` that throws (SYG660/661): reported to the app's onError with phase
 *   'widget' (D105), and the owner's next render shows its `onError` fallback in the widget's
 *   place. `unmount` (SYG662): reported, nothing to replace.
 * - Inside `<Portal>`: the Portal's children are rewritten here too (Portal children are not
 *   walked by the core), so a widget works in a portal.
 * - SSR (extra/ssr.ts): the host, with `fallback` inside it; the client patch replaces the
 *   fallback (the host has no children) and mounts.
 *
 * Dev text lives in the 'sygnal/diagnostics' entry (checks/widgets.ts), reached through the core
 * bridge as `widget(code, widgetTag, owner, extra)`: SYG140 (emit of an undeclared event), SYG143,
 * SYG144 (a declared event the host fires natively), SYG660–662. Without the entry, a thrown
 * mount/update/unmount is logged as `[Sygnal SYG66x]` with the error.
 */
import {pres} from '../core/registry'

const W = '__sygnalWidget'

// props that also go to the host element (every prop but key/ref goes to the widget)
const HOST = /^(id|class(Name)?|style|title|name|placeholder|role|tab[iI]ndex|hidden|lang|dir|attrs)$|^(aria|data)-/

/** the dev entry's reporter (checks/widgets.ts); returns the diagnostic when one was reported */
const dev = (code: number, w: any, o?: any, x?: any): any => (globalThis as any).__SYGNAL_DIAGNOSTICS__?.widget?.(code, w, o, x)

const same = (a: any, b: any) => {
  const k = Object.keys(a)
  return k.length == Object.keys(b).length && k.every(x => a[x] === b[x])
}

function fail(o: any, w: any, id: any, code: number, e: any) {
  e = e instanceof Error ? e : Error(e)
  dev(code, w, o, e) || console.error(`[Sygnal SYG${code}]`, e)
  o.app.appError(o, e, 'widget')
  // the failures by widget (key, or the tag) on the owner: its next render shows its fallback
  if (code < 662 && !o.disposed) (o.$wf ||= new Map()).set(id ?? w, e), o.refresh()
}

function mount(v: any) {
  const el = v.elm, {ww: w, wp: p, wo: o} = v.data
  const e = (n: string, detail?: any) => { dev(140, w, o, n); el.dispatchEvent(new CustomEvent(n, {detail, bubbles: true})) }
  let i: any
  dev(144, w, o, el)
  try { i = w.def.mount(el, p, e) } catch (x) { return fail(o, w, v.key, 660, x) }
  Object.defineProperty(el, W, {value: {w, p, i, e}, configurable: true})
  // the tag form's commands: a host method for each one the element doesn't have (D190)
  for (const m in w.def.commands) m in el || (el[m] = (x: any) => el[W]?.w.commands[m]?.(el, x))
}

const hooks: any = {
  insert: mount,
  postpatch(_: any, v: any) {
    const el = v.elm, p = v.data.wp
    // another widget with the same host tag at this place (unkeyed): unmount it first
    if (el[W] && el[W].w != v.data.ww) hooks.destroy(v)
    const s = el[W]
    // SSR hydration (the element was patched in place, never inserted): mount now
    if (!s) return mount(v)
    const def = s.w.def
    if (!same(s.p, p)) try {
      s.p = p
      def.update ? def.update(s.i, p, el) : (def.unmount?.(s.i, el), s.i = def.mount(el, p, s.e))
    } catch (x) { fail(v.data.wo, s.w, v.key, 661, x) }
  },
  destroy(v: any) {
    const el = v.elm, s = el[W]
    if (s) {
      delete el[W]
      try { s.w.def.unmount?.(s.i, el) } catch (x) { fail(v.data.wo, s.w, v.key, 662, x) }
    }
  },
}

/** the host vnode for a widget marker (client: with the hooks and the owner; SSR adds the fallback) */
function host(n: any, o?: any): any {
  const {ww: w, wp: p, h, attrs} = n.data, def = w.def, hp: any = {}
  for (const k in p) if (HOST.test(k) || def.hostProps?.includes(k)) hp[k] = p[k]
  const v = h(def.tag || 'div', hp), d = v.data
  if (attrs) d.attrs = {...d.attrs, ...attrs}
  v.key = n.key
  if (o) {
    d.ww = w; d.wp = p; d.wo = o; d.hook = hooks; v.children = undefined
  }
  return v
}

function rewrite(n: any, o: any): any {
  const e = o.$wf?.get(n.key ?? n.data.ww), def = o.def
  if (!e) return host(n, o)
  const x = n.data.h('div', {attrs: {'data-sygnal-error': def.name}})
  try { return def.onError?.(e, {componentName: def.name}) || x } catch (_) { return x }
}

/** widget markers among a Portal's children (the core doesn't walk them) */
const inPortal = (c: any[], o: any): any[] => c.map(n => n?.sel == 'widget' ? rewrite(n, o) : n?.children ? {...n, children: inPortal(n.children, o)} : n)

export function defineWidget(def: any): any {
  pres.widget ||= rewrite
  const p: any = pres.portal
  if (p && !p.$w) ((pres.portal = (n: any, o: any) => p({...n, children: inPortal(n.children || [], o)}, o)) as any).$w = 1
  const w: any = () => {}, commands: any = {}
  // D190: `close` / `togglePopover` are refused in dev (SYG142, thrown by the dev entry)
  for (const m in def.commands) dev(142, w, 0, m), commands[m] = (el: any, o: any) => el[W] && def.commands[m](el[W].i, o || {}, el)
  return Object.assign(w, {
    kind: 'widget',
    def,
    events: def.events || [],
    commands,
    // D101/D116: the control spec's vnode(props, children, h): one (marker) element vnode; also
    // the tag form's pragma render hook (no data-control stamp)
    vnode: w.__sygnalControl = (props: any, _: any, h: any) => {
      const {key, ref, ...p} = props || {}
      return {sel: 'widget', data: {ww: w, wp: p, h}, children: undefined, text: undefined, key}
    },
    $ssr: host,
    // D190/D199: a widget tag is not a selector (SYG143 in dev): select its className or a control
    toString: () => (dev(143, w), ':not(*)'),
  })
}
