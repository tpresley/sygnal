// The guest kernel: runs INSIDE the QuickJS context, next to the untrusted component.
//
// It is bundled with Sygnal's core and the sygnal/host renderer kit (build-guest.mjs → dist/guest.js)
// and evaluated once per sandbox, before the component's code. Nothing here is a security boundary:
// the component runs in the same context and can tamper with all of it. The boundary is the bridge
// (the `__host` functions the host installed): the host validates every message that crosses it
// (sandbox.js, mirror.js). The kernel only makes the guest side convenient:
//
//   - the component renders through the real core into a sygnal/host tree (HostDocument);
//   - after each patch the tree goes out as JSON (ids from nodeId; a subtree whose revision didn't
//     move goes out as its bare id), with the event types the app listens for;
//   - events come in as {id, type, init}: the kernel finds the host element, syncs value/checked as
//     a browser would have, dispatches a HostEvent, and returns whether it was prevented;
//   - drivers: DOM (host tree), STATE (the core's own), EVENTS (a bus; every emit also goes to the
//     host page), PROPS (props from the host page), HTTP (makeFetchDriver over the host's `fetch`
//     capability, which enforces the allowlist on its side).
//
// Host functions (installed by sandbox.js before this runs): __host.render(json), __host.emit(json),
// __host.fetch(id, url, initJson), __host.timer(id, ms), __host.clearTimer(id), __host.log(level, text).
// first: the core's modules read setTimeout & co. when they load
import {timers} from './guest-platform.js'
import {run, xs, createElement, makeFetchDriver, ABORT, classes, set, toggle, event, debounce, Collection, Switchable} from 'sygnal'
import {HostDocument, HostEvent, makeHostDriver, nodeId} from 'sygnal/host'

const H = globalThis.__host
const G = globalThis

// --- the tree going out --------------------------------------------------------------------------
const doc = new HostDocument()
const byId = new Map()      // id → host node, rebuilt each serialization (events look elements up)
const sent = new Map()      // id → revision last sent
// {i, t, a, s, v, k, c} for an element, {i, x} for a text, a bare id for an unchanged subtree
function ser(n, out) {
  const i = nodeId(n)
  out.set(i, n)
  if (sent.get(i) === n.revision) { mark(n, out); return i }
  sent.set(i, n.revision)
  if (n.nodeType === 3) return {i, x: String(n.textContent)}
  const a = {}
  for (const [k, v] of n.attributes) a[k] = v
  const s = {}
  for (const k of Object.keys(n.style)) s[k] = String(n.style[k])
  const o = {i, t: n.localName, a, c: n.childNodes.map(c => ser(c, out))}
  if (Object.keys(s).length) o.s = s
  if (/^(input|textarea|select)$/.test(n.localName)) { o.v = n.value; o.k = n.checked }
  if (n.localName === 'option' && n.selected) o.k = true
  return o
}
// an unchanged subtree's nodes stay addressable
function mark(n, out) { if (n.childNodes) for (const c of n.childNodes) { out.set(nodeId(c), c); mark(c, out) } }

let dirty = false, lastMsg = ''
function flushTree() {
  dirty = false
  const out = new Map()
  const tree = doc.body.childNodes.map(c => ser(c, out))
  byId.clear()
  for (const [k, v] of out) byId.set(k, v)
  for (const k of sent.keys()) if (!out.has(k)) sent.delete(k)
  // the event types to listen for at the sandbox root (delegated, as the DOM driver does)
  const types = [...new Set([...doc.delegates].map(d => d.type))]
  const msg = JSON.stringify({tree, types})
  // nothing moved (a change that patched back to what was sent): no message
  if (msg !== lastMsg || tree.some(n => typeof n != 'number')) H.render(lastMsg = msg)
}
// one render per guest entry: the host calls __sandbox.flush() once the entry's promise jobs ran
// (a click on a checkbox changes the tree twice, its checked state, then the patch: one message)
doc.onChange = () => { dirty = true }

// --- events coming in ----------------------------------------------------------------------------
const EVENT_FIELDS = /^(key|code|shiftKey|ctrlKey|altKey|metaKey|button|clientX|clientY|deltaX|deltaY|detail)$/
G.__sandbox = {
  // returns 1 when the guest prevented the default action
  dispatch(id, type, initJson) {
    const el = byId.get(id)
    if (!el || el.nodeType !== 1) return 0
    const init = JSON.parse(initJson || '{}')
    if ('value' in init) el.value = init.value
    if ('checked' in init) el.checked = !!init.checked
    if (type === 'focus' || type === 'focusin') doc.activeElement = el
    const e = new HostEvent(type, {bubbles: !/^(focus|blur|mouseenter|mouseleave)$/.test(type)})
    for (const k in init) if (EVENT_FIELDS.test(k)) e[k] = init[k]
    return el.dispatchEvent(e) ? 0 : 1
  },
  flush() { if (dirty) flushTree(); return 0 },
  fire(id) { const f = timers.get(id); timers.delete(id); if (f) f() },
  resolve(id, ok, payloadJson) { const p = fetches.get(id); fetches.delete(id); if (p) ok ? p.ok(JSON.parse(payloadJson)) : p.fail(new Error(payloadJson)) },
  props(json) { props$.shamefullySendNext(JSON.parse(json)) },
  dispose() { app && app.dispose() },
}

// --- drivers -------------------------------------------------------------------------------------
// HTTP: the core's own makeFetchDriver over a Response-shaped capability; the host checks the URL
const fetches = new Map()
let fetchSeq = 0
const capFetch = (url, init = {}) => new Promise((ok, fail) => {
  const id = ++fetchSeq
  fetches.set(id, {ok, fail})
  H.fetch(id, String(url), JSON.stringify({method: init.method || 'GET', headers: init.headers || {}, body: typeof init.body == 'string' ? init.body : undefined}))
}).then(r => ({
  ok: r.status >= 200 && r.status < 300, status: r.status, statusText: '',
  headers: {get: (k) => r.headers[String(k).toLowerCase()] ?? null},
  json: async () => JSON.parse(r.body), text: async () => r.body,
}))

// EVENTS: an in-guest bus (eventBusDriver needs EventTarget), every event also sent to the host page
function eventsDriver(out$) {
  const bus = xs.create()
  out$.addListener({next: (ev) => {
    bus.shamefullySendNext(ev)
    try { H.emit(JSON.stringify({type: String(ev && ev.type), data: ev && ev.data})) } catch (e) { console.error('EVENTS: data must be JSON', String(e)) }
  }, error: () => {}, complete: () => {}})
  return {select: (type) => bus.filter(ev => !type || ev.type === type || (Array.isArray(type) && type.includes(ev.type))).map(ev => ev.data ?? null)}
}

const props$ = xs.createWithMemory()

// what the component may import: `import {ABORT} from 'sygnal'` (esbuild turns it into require)
const SYGNAL = Object.freeze({xs, createElement, ABORT, classes, set, toggle, event, debounce, Collection, Switchable, Fragment})
G.require = (name) => {
  if (name === 'sygnal' || name === 'sygnal/jsx') return SYGNAL
  throw new Error(`sandbox: '${name}' can't be imported here`)
}
// the JSX the host compiles generated code to: __h(tag, props, ...children), __frag
function Fragment() {}
G.__h = createElement
G.__frag = Fragment

let app
G.__sandbox.start = (exportName) => {
  const mod = G.module.exports
  const App = exportName ? mod[exportName] : (mod.default || Object.values(mod).find(v => typeof v == 'function'))
  if (typeof App != 'function') throw new Error('sandbox: the source exports no component')
  // a root without state never renders (src/core/instance.ts: no state, no view); generated code often has none
  if (App.initialState === undefined) App.initialState = {}
  app = run(App, {
    DOM: makeHostDriver(doc, {onError: (e) => console.error('patch', String(e && e.message || e))}),
    EVENTS: eventsDriver,
    PROPS: () => ({stream: props$, get: (k) => props$.map(p => k ? p?.[k] : p)}),
    HTTP: makeFetchDriver({fetch: capFetch}),
  }, {useDefaultDrivers: false})
  return 1
}
G.module = {exports: {}}
G.exports = G.module.exports
