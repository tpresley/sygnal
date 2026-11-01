/*
 * The guest kernel: runs INSIDE the QuickJS context, next to the untrusted component.
 *
 * Built as dist/sandbox-kernel.esm.js with 'sygnal' and 'sygnal/host' external; sygnal/vite
 * (`sygnal/sandbox/kernel?raw`) or buildSandboxKernel() bundles it with the app's installed
 * sygnal, xstream and snabbdom into one script (D209: never shipped prebuilt), after the
 * platform prelude (build.ts PLATFORM: timers, console, microtasks; the core's modules read
 * setTimeout when they load). Nothing here is a security boundary: the component runs in the
 * same context and can tamper with all of it. The boundary is the bridge (`__host`), which the
 * page checks (engine.ts, mirror.ts). The kernel only makes the guest side convenient:
 *
 *   - the component renders through the real core into a sygnal/host tree (HostDocument);
 *   - after each entry the tree goes out as JSON (ids from nodeId; a subtree whose revision didn't
 *     move goes out as its bare id), with the event types the app listens for;
 *   - events come in as {id, type, init}: the kernel finds the host element, syncs value/checked
 *     as a browser would have, dispatches a HostEvent and returns whether it was prevented;
 *   - drivers: DOM (host tree), STATE (the core's own), EVENTS (a bus; each event also goes to the
 *     page), PROPS (from the page), HTTP (makeFetchDriver over the page's checked fetch).
 */
import {run, xs, createElement, makeFetchDriver, ABORT, classes, set, toggle, event, debounce, throttle, delay, dropRepeats, sampleCombine, Collection, Switchable} from '../index'
import {HostDocument, HostEvent, makeHostDriver, nodeId} from '../host'

const PROTOCOL = 1
const G: any = globalThis
const H: any = G.__host
const timers: Map<number, () => void> = G.__sandboxTimers

// --- the tree going out --------------------------------------------------------------------------
const doc: any = new HostDocument()
const byId = new Map<number, any>()   // id → host node (events look elements up)
const sent = new Map<number, number>() // id → revision last sent
// {i, t, a, s, v, k, c} for an element, {i, x} for a text, a bare id for an unchanged subtree
function ser(n: any, out: Map<number, any>): any {
  const i = nodeId(n)
  out.set(i, n)
  if (sent.get(i) === n.revision) { mark(n, out); return i }
  sent.set(i, n.revision)
  if (n.nodeType === 3) return {i, x: String(n.textContent)}
  const a: any = {}
  for (const [k, v] of n.attributes) a[k] = v
  const s: any = {}
  for (const k of Object.keys(n.style)) s[k] = String(n.style[k])
  const o: any = {i, t: n.localName, a, c: n.childNodes.map((c: any) => ser(c, out))}
  if (Object.keys(s).length) o.s = s
  if (/^(input|textarea|select)$/.test(n.localName)) { o.v = n.value; o.k = n.checked }
  if (n.localName === 'option' && n.selected) o.k = true
  return o
}
// an unchanged subtree's nodes stay addressable
function mark(n: any, out: Map<number, any>) { if (n.childNodes) for (const c of n.childNodes) { out.set(nodeId(c), c); mark(c, out) } }

let dirty = false, lastMsg = '', focused: any = null
function flushTree() {
  dirty = false
  const out = new Map<number, any>()
  const tree = doc.body.childNodes.map((c: any) => ser(c, out))
  byId.clear()
  for (const [k, v] of out) byId.set(k, v)
  for (const k of [...sent.keys()]) if (!out.has(k)) sent.delete(k)
  // the event types to listen for at the sandbox root (delegated, as the DOM driver does)
  const types = [...new Set([...doc.delegates].map((d: any) => d.type))]
  const msg: any = {v: PROTOCOL, tree, types}
  // focus the guest moved (autoFocus, an ELEMENT focus command); the page applies it only with
  // the focus capability and while focus is inside the box
  const active = doc.activeElement
  if (active && active !== focused && byId.has(nodeId(active))) msg.f = nodeId(active)
  focused = active
  const json = JSON.stringify(msg)
  // nothing moved (a change that patched back to what was sent): no message
  if (json !== lastMsg || tree.some((n: any) => typeof n != 'number')) H.render(lastMsg = json)
}
// one render per guest entry: the page calls __sandbox.flush() once the entry's promise jobs ran
// (a checkbox click changes the tree twice, its checked state, then the patch: one message)
doc.onChange = () => { dirty = true }

// --- events coming in ----------------------------------------------------------------------------
const EVENT_FIELDS = /^(key|code|shiftKey|ctrlKey|altKey|metaKey|button|clientX|clientY|deltaX|deltaY|detail)$/
const props$: any = xs.createWithMemory()
const fetches = new Map<number, {ok: (v: any) => void; fail: (e: any) => void}>()
let app: any

G.__sandbox = {
  v: PROTOCOL,
  // returns 1 when the guest prevented the default action
  dispatch(id: number, type: string, initJson: string) {
    const el = byId.get(id)
    if (!el || el.nodeType !== 1) return 0
    const init = JSON.parse(initJson || '{}')
    if ('value' in init) el.value = init.value
    if ('checked' in init) el.checked = !!init.checked
    if (type === 'focus' || type === 'focusin') doc.activeElement = focused = el
    const e: any = new HostEvent(type, {bubbles: !/^(focus|blur|mouseenter|mouseleave)$/.test(type)})
    for (const k in init) if (EVENT_FIELDS.test(k)) e[k] = init[k]
    return el.dispatchEvent(e) ? 0 : 1
  },
  flush() { if (dirty || doc.activeElement !== focused) flushTree(); return 0 },
  fire(id: number) { const f = timers.get(id); timers.delete(id); if (f) f() },
  resolve(id: number, ok: number, payload: string) {
    const p = fetches.get(id)
    fetches.delete(id)
    if (p) ok ? p.ok(JSON.parse(payload)) : p.fail(new Error(payload))
  },
  props(json: string) { props$.shamefullySendNext(JSON.parse(json)) },
  start(exportName: string) {
    const mod = G.module.exports
    const App = exportName ? mod[exportName] : (mod.default || Object.values(mod).find((v) => typeof v == 'function'))
    if (typeof App != 'function') throw new Error('sandbox: the source exports no component')
    // a root without state never renders (SYG204); generated code often has none
    if (App.initialState === undefined) App.initialState = {}
    wiringCheck(App)
    app = run(App, {
      DOM: makeHostDriver(doc, {onError: (e: any) => console.error('patch', String(e?.message || e))}),
      EVENTS: eventsDriver,
      PROPS: () => ({stream: props$, get: (k?: string) => props$.map((p: any) => (k ? p?.[k] : p))}),
      HTTP: makeFetchDriver({fetch: pageFetch as any}),
    } as any, {useDefaultDrivers: false} as any)
    return 1
  },
  dispose() { app && app.dispose() },
}

// sygnal-check's SYG101 at boot, on the actions the intent really returns: an action with no model
// entry does nothing and throws nothing (the core's own check is in the dev build only). Model-written
// code gets this wrong silently, so the kernel says so; a page may treat the line as a failure
// (compose.generated does). Behavior actions ('page.COMPOSE') belong to `uses`: not checked.
function wiringCheck(App: any) {
  const intent = App.intent, model = App.model
  if (typeof intent != 'function' || (model != null && typeof model != 'object')) return
  App.intent = function (this: any, ...args: any[]) {
    const out = intent.apply(this, args)
    if (out && typeof out == 'object') {
      for (const k of Object.keys(out)) {
        if (k.includes('.') || (model && Object.prototype.hasOwnProperty.call(model, k))) continue
        console.warn(`[Sygnal SYG101] intent action '${k}' has no model entry, so it never does anything; add '${k}' to model or remove it from intent`)
      }
    }
    return out
  }
}

// --- drivers -------------------------------------------------------------------------------------
// HTTP: the core's own makeFetchDriver over a Response-shaped capability; the page checks the URL
let fetchSeq = 0
const pageFetch = (url: string, init: any = {}) => new Promise((ok, fail) => {
  const id = ++fetchSeq
  fetches.set(id, {ok, fail})
  H.fetch(id, String(url), JSON.stringify({method: init.method || 'GET', headers: init.headers || {}, body: typeof init.body == 'string' ? init.body : undefined}))
}).then((r: any) => ({
  ok: r.status >= 200 && r.status < 300, status: r.status, statusText: '',
  headers: {get: (k: string) => r.headers[String(k).toLowerCase()] ?? null},
  json: async () => JSON.parse(r.body), text: async () => r.body,
}))

// EVENTS: an in-guest bus (eventBusDriver needs EventTarget); each event also goes to the page,
// which only delivers the types declared in `emits`, validated by their schemas
function eventsDriver(out$: any) {
  const bus: any = xs.create()
  out$.addListener({
    next: (ev: any) => {
      bus.shamefullySendNext(ev)
      try { H.emit(JSON.stringify({type: String(ev?.type), data: ev?.data})) } catch (e) { console.error('EVENTS: data must be JSON', String(e)) }
    },
    error: () => {}, complete: () => {},
  })
  return {select: (type?: string | string[]) => bus.filter((ev: any) => !type || ev.type === type || (Array.isArray(type) && type.includes(ev.type))).map((ev: any) => ev.data ?? null)}
}

// what a component may import: `require('sygnal')` (a compiled `import {ABORT} from 'sygnal'`)
function Fragment() {}
;(Fragment as any).__sygnalFragment = true
const SYGNAL = Object.freeze({xs, createElement, Fragment, ABORT, classes, set, toggle, event, debounce, throttle, delay, dropRepeats, sampleCombine, Collection, Switchable})
G.require = (name: string) => {
  if (name === 'sygnal' || name === 'sygnal/jsx') return SYGNAL
  throw new Error(`sandbox: '${name}' can't be imported here`)
}
// the JSX a host compiles guest code to: __h(tag, props, ...children), __frag
G.__h = createElement
G.__frag = Fragment
G.module = {exports: {}}
G.exports = G.module.exports
