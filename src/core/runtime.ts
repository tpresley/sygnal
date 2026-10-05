/**
 * PLAN-4.6 next core: the app runtime, one per run() (03-proposal §3, 04 §2.4: the flush contract).
 *
 * - dispatch(): one FIFO queue, run to completion. An action dispatched while the queue drains
 *   (a driver answering synchronously during sink delivery, an EFFECT, a PARENT, a hook) is
 *   appended, never run nested; one dispatched while the flush renders is drained in that flush.
 * - commit(): a state write schedules one flush (a microtask).
 * - flush(): repeat { STATE streams, render top-down (dirty-checked), statics (R3's hook point),
 *   drain the queue } until nothing changed; then ONE vnode to the DOM driver (one patch), then
 *   the disposed instances' streams are stopped, and BOOTSTRAP goes to the instances created in
 *   it a microtask later (D165). No startup timers, gates or holds.
 * - loop guard (G-260 / G-283 / G-284): at most 100 passes per flush; a flush caused by the one
 *   before it (a commit while it ran or emitted: a loop that never settles) is chained, and past
 *   100 chained flushes, or 1,000 flushes of any kind without a macrotask, the next one waits for
 *   a MessageChannel message. No setTimeout anywhere.
 * - teardown (D165 / Q18): while an instance unsubscribes, Stream.prototype._remove queues the
 *   streams it leaves without listeners instead of arming xstream's stop timer, and the queue is
 *   stopped at the first macrotask after the drain / flush (G-302). The swap is scoped to dispose().
 */
import xs from '../extra/xstreamCompat'
import {makeDOMDriver} from '../cycle/dom/index'
import eventBusDriver from '../extra/eventDriver'
import logDriver from '../extra/logDriver'
import {NOT_SINK} from '../shared'
import {error as logError, callHook} from '../extra/diagnostics/legacy'
import type {ComponentFn, DefSource, Hooks, RuntimeAPI, ActionCause} from './hooks'
import {CoreDef, defOf, rootDef} from './define'
import {rootCell} from './cell'
import {Inst} from './instance'
import {viewOf} from './view'
import {stopQueued, INST, SET, SEED} from './teardown'
import {scanSources} from './statics'
// the public ClientOnly is a separate bundle (sygnal/vike/ClientOnly) with no core of its own, so
// its marker handler registers with the core (the other markers register from their modules)
import './markers/clientonly'

const LOOP = 100, HARD = 1000
// the macrotask, captured at load (a test's fake timers don't hold the ping): Node drains a
// MessagePort's messages back to back (timers starve), so its setImmediate is the macrotask
// there; browsers have no setImmediate and get a MessageChannel
const G: any = globalThis
const SI: ((f: () => void) => void) | undefined = typeof G.setImmediate == 'function' ? G.setImmediate.bind(G) : undefined
const MC: any = typeof G.MessageChannel == 'function' ? G.MessageChannel : undefined
const ERR_FIX = 'See the attached error'

export interface StartOptions {
  mountPoint?: string | Element
  fragments?: boolean
  useDefaultDrivers?: boolean
  onError?: (error: any, info: any) => void
  uid?: string
  /** internal: this app's hooks (testing, devtools, diagnostics) */
  __hooks?: Hooks
  /** internal: the root's state at start (an HMR swap) */
  __state?: any
  /** internal: renderComponent's root (test intent, initial state, name) */
  __override?: Partial<DefSource> & {name?: string}
}

export class App {
  state: any = undefined
  queue: any[] = []
  draining = false
  rendering = false
  flushing = false
  scheduled = false
  dirty = false
  /** in a flush's emission (a commit there chains the next flush) */
  tail = false
  chained = false
  chain = 0
  flushes = 0
  /** bumped on every state write (context memo) */
  ver = 0
  /** render epoch: bumped when a render threw (G-311: every instance injects its kids again once) */
  ep = 0
  root!: Inst
  last: any
  vdomL: any
  vdom$: any
  sources: Record<string, any> = {}
  proxies: Record<string, any> = {}
  bus: Record<string, any> = {}
  busL: Record<string, any> = {}
  /** G-296: before the first flush emitted, the sink values sent, per sink */
  early = true
  log: Record<string, any[]> = {}
  ex: Record<string, any> = {}
  exL: Record<string, any> = {}
  hooks: Hooks
  /** run()'s hooks, then each addHooks() layer (G-297) */
  layers: Hooks[]
  born: Inst[] = []
  watchers = new Set<Inst>()
  /** streams the disposed instances left without listeners, stopped when the drain / flush ends */
  dq: any[] = []
  stopping = false
  disposed = false
  initState: any
  /** D168 hook point: R4's dev check re-runs a sample of the views context tracking skipped */
  ctxSkip: ((inst: Inst) => void) | null = null
  /** the statics step, recomputed after each render pass (statics.ts; set when a driver takes a static) */
  afterRender: (() => void) | null = null
  /** [sink, static] of the drivers that take a static; the reply-capable sources (statics.ts) */
  stat: Array<[string, string]> = []
  rep: string[] = []
  /** a definition's [sink, static] pairs (this app's drivers) */
  stc = new WeakMap<CoreDef, Array<[string, string]> | null>()
  /** the live instances that declare a static */
  statics = new Set<Inst>()
  defs = new WeakMap<ComponentFn, CoreDef>()
  waiters: Array<() => void> = []
  scopeN = 0
  mc: any
  hops: Array<() => void> = []
  ping = false
  desc: any[] = []

  constructor(public opts: StartOptions = {}) {
    this.hooks = {...opts.__hooks}
    this.layers = [opts.__hooks || {}]
    this.initState = opts.__state
  }

  def(view: ComponentFn, override?: StartOptions['__override']) {
    return defOf(view, this.hooks.transformDef, this.defs, override)
  }
  /** a child's isolation scope (one for every channel of the instance, as isolate() gave) */
  scope() { return 's' + ++this.scopeN }

  // ---------------------------------------------------------------- queue
  dispatch(inst: Inst, type: any, data: any, cause: ActionCause = 'intent') {
    if (this.disposed) return
    this.queue.push(inst, type, data, cause)
    if (!this.draining && !this.rendering) this.drain()
  }
  drain() {
    this.draining = true
    const q = this.queue
    try {
      for (let i = 0; i < q.length; i += 4) {
        const inst: Inst = q[i]
        if (inst.disposed) continue
        if (q[i + 1] === SET) {
          const f = q[i + 2], c = inst.cell
          const v = typeof f == 'function' ? f(c.get()) : f
          if (v !== c.get()) c.set(v)
        } else if (q[i + 1] === SEED) {
          // G-309: decided when it is applied: a parent write queued before it keeps the slice (D174)
          const d = q[i + 2], b = d.b
          if (d.r || !(b.has ? b.has() : b.get() !== undefined)) inst.cell.set(d.v)
          else this.hooks.onStateSeed?.(viewOf(inst), b.get(), d.v)
        }
        else inst.handle(q[i + 1], q[i + 2], q[i + 3])
        if (this.watchers.size) this.notify()
      }
    } finally {
      q.length = 0
      this.draining = false
      if (!this.flushing && this.dq.length) this.stopLater()
    }
  }
  /** STATE.stream: the instances whose state changed emit it */
  notify() {
    for (const i of this.watchers) i.notify()
  }

  // ---------------------------------------------------------------- flush
  commit() {
    this.ver++
    if (this.flushing) { this.dirty = true; return }
    if (this.tail) this.chained = true
    if (this.scheduled || this.disposed) return
    this.scheduled = true
    const chained = this.chained
    this.chained = false
    this.chain = chained ? this.chain + 1 : 0
    // the first flush since the last macrotask pings one, which resets the count
    if (!this.flushes++) this.macro()
    if (this.chain > LOOP || this.flushes > HARD) this.macro(() => { this.chain = 0; this.flush() })
    else queueMicrotask(() => this.flush())
  }
  /**
   * A macrotask without a timer: one MessageChannel per app, at most one message in flight (it
   * resets the flush count, then runs the hops waiting for it)
   */
  macro(f?: () => void) {
    if (f) this.hops.push(f)
    if (this.ping) return
    this.ping = true
    if (SI) return void SI(() => this.pong())
    if (!MC) return void setTimeout(() => this.pong())
    if (!this.mc) {
      this.mc = new MC()
      this.mc.port1.onmessage = () => this.pong()
      this.mc.port1.unref?.()
    }
    this.mc.port2.postMessage(0)
  }
  /**
   * G-302: the streams disposed instances left without listeners stop at the first macrotask, as
   * xstream's own deferred stop does (a shared stream unmounted in one flush and mounted again in
   * the next keeps running), but through macro(): no setTimeout per stream
   */
  stopLater() {
    if (this.stopping) return
    this.stopping = true
    this.macro(() => { this.stopping = false; stopQueued(this.dq) })
  }
  pong() {
    this.ping = false
    this.flushes = 0
    for (const g of this.hops.splice(0)) g()
  }
  flush() {
    this.scheduled = false
    if (this.disposed) return this.release()
    try { this.flushOnce() } finally { this.release() }
  }
  /** G-301: flushed() resolves once nothing is scheduled, after a throwing flush, or on dispose */
  release() {
    if (this.waiters.length && (!this.scheduled || this.disposed)) for (const w of this.waiters.splice(0)) w()
  }
  flushOnce() {
    this.flushing = true
    let v: any, n = 0
    try {
      do {
        this.dirty = false
        if (this.watchers.size) this.notify()
        this.rendering = true
        try { v = this.root.render() } catch (e) {
          // G-298: an error that escaped every boundary (a hook, a host): reported; the DOM keeps
          // its last render and the flush still ends (BOOTSTRAP, teardown, waiters)
          this.rendering = false
          this.caught(this.root, 'SYG406', 'Render threw; the page keeps its last render', e, 'view')
          v = this.last
          // G-311: the instances that rendered before the throw are injected at the next render
          this.ep++
          break
        }
        this.afterRender?.()
        this.rendering = false
        if (this.queue.length) this.drain()
      } while (this.dirty && ++n < LOOP)
    } finally {
      this.rendering = false
      this.flushing = false
    }
    this.tail = true
    try {
      // G-311 (c): what the throwing pass queued (a new child's INITIALIZE / seed) is still applied
      if (this.queue.length) this.drain()
      if (v !== this.last) {
        this.last = v
        this.hooks.onPatch?.(v)
        this.vdomL?.next(v)
      }
      if (this.dq.length) this.stopLater()
    } finally {
      // G-313: a throwing patch / onPatch still ends the startup log and dispatches BOOTSTRAP
      this.tail = false
      if (this.born.length) {
        const b = this.born.splice(0)
        queueMicrotask(() => { for (const i of b) if (!i.disposed) this.dispatch(i, 'BOOTSTRAP', undefined, 'built-in') })
      }
      if (this.dirty) { this.chained = true; this.dirty = false; this.commit() }
      if (this.early) { this.early = false; this.log = {} }
    }
  }

  // ---------------------------------------------------------------- sinks
  /** the app's stream for one sink (every instance's values; drivers get them synchronously) */
  sink(n: string) {
    return this.bus[n] ||= xs.create({start: (l: any) => { this.busL[n] = l }, stop: () => { delete this.busL[n] }})
  }
  out(n: string, v: any) {
    // G-296: until the first flush has emitted, a sink's values are kept for a listener added
    // right after run() / renderComponent (sinks[n], as Cycle's run buffered its sinks)
    if (this.early) (this.log[n] ||= []).push(v)
    const l = this.busL[n]
    if (!l) return
    try { l.next(v) } catch (e) {
      // GS-11: a driver that throws handling a sink value goes to the app's onError ('driver'),
      // and to the hooks' onError (G-303)
      const info: any = {phase: 'driver', driver: n}
      callHook(this.opts.onError, e, info)
      this.hooks.onError?.(e, info)
      queueMicrotask(() => { throw e })
    }
  }
  /** run()'s sinks[n]: the bus, with the values sent before the first flush replayed to its first listener (G-296) */
  exposed(n: string) {
    return this.ex[n] ||= xs.create({
      start: (l: any) => {
        const early = this.early ? this.log[n] : undefined
        if (early) for (const v of early.slice()) l.next(v)
        this.sink(n).addListener(this.exL[n] = {next: (v: any) => l.next(v), error: (e: any) => l.error(e), complete: () => l.complete()})
      },
      stop: () => { this.sink(n).removeListener(this.exL[n]) },
    })
  }
  /**
   * The value-level fallback (a source without isolateValue): one stream per instance and key
   * through `build` (isolateSink at each level), delivered to `to` synchronously.
   */
  pipe(inst: Inst, key: string, v: any, build: (s$: any) => any, to: (x: any) => void) {
    const fb = inst.fb ||= {}
    let p = fb[key]
    if (!p) {
      const in$ = xs.create()
      p = fb[key] = in$
      inst.subs.push(build(in$).subscribe({next: to}))
    }
    p.shamefullySendNext(v)
  }
  /** an instance's vnode, scoped by its parent's DOM source (isolateValue, else a pipe) */
  scopeValue(parent: Inst, _: string, v: any, inst: Inst) {
    const d = parent.dom
    if (!d || inst.scope === undefined) return v
    if (typeof d.isolateValue == 'function') return d.isolateValue(v, inst.scope)
    let r: any
    this.pipe(inst, '\u0000DOM', v, (s$) => d.isolateSink(s$, inst.scope), (x) => { r = x })
    return r
  }

  // ---------------------------------------------------------------- errors
  appError(inst: Inst, e: any, phase: string, action?: string) {
    const info: any = {componentName: inst.def.name, action, phase}
    callHook(this.opts.onError, e, info)
    this.hooks.onError?.(e, info)
  }
  /** an error caught at a call site that keeps running (as legacy caught(): a fail()'s own code) */
  caught(inst: Inst, code: string, message: string, err: any, phase: string, action?: string) {
    const s = err && err.sygnal
    s ? logError(err.code, s[0], `${s[1]} (${message})`, s[2], err) : logError(code, inst, message, ERR_FIX, err)
    this.appError(inst, err, phase, action)
  }

  // ---------------------------------------------------------------- intent sources
  /** the getters of an instance's intent sources (one descriptor map per app and kind) */
  srcDesc(child: boolean) {
    const k = +child
    if (this.desc[k]) return this.desc[k]
    const d: any = {}
    const get = (f: (i: Inst) => any) => ({get(this: any) { return f(this[INST]) }, enumerable: true, configurable: true})
    for (const n in this.sources) if (n !== 'DOM') d[n] = get(i => i.src(n))
    d.DOM = get(i => i.dom && (i.wd ||= wrapDOM(i.dom)))
    d.STATE = get(i => i.stateSource())
    d.CHILD = get(i => i.childSource())
    d.dispose$ = get(i => i.dispose$())
    if (child) {
      d.props$ = get(i => i.props$ || seeded(i, 'props$', i.props))
      d.children$ = get(i => i.children$ || seeded(i, 'children$', i.children))
      // a Command passed as a prop (createCommand): its messages, as today's `commands$`
      d.commands$ = get(i => i.commands())
    }
    return (this.desc[k] = d)
  }

  // ---------------------------------------------------------------- the runtime API (04 §2.3)
  api(): RuntimeAPI {
    const app = this
    const find = (t: any): Inst | undefined => t === 'root' ? app.root : typeof t == 'number' ? byId(app.root, t) : t && byId(app.root, t.id)
    return {
      get root() { return viewOf(app.root) },
      get: (id) => { const i = byId(app.root, id); return i && viewOf(i) },
      getState: () => app.state,
      setState: (t, s) => { const i = find(t); if (i) app.dispatch(i, SET, s, 'setState') },
      dispatch: (t, type, data, cause = 'simulateAction') => { const i = find(t); if (i) app.dispatch(i, type, data, cause) },
      addHooks: (h) => app.addHooks(h),
      flushed: () => new Promise<void>(r => (app.scheduled || app.flushing ? app.waiters.push(r) : r())),
    }
  }
  /**
   * A layer of hooks on top of run()'s own (devtools connecting late, a dev entry). G-297: the
   * remover drops only its own layer; the hooks are composed again from the layers left.
   */
  addHooks(h: Hooks) {
    this.layers.push(h)
    this.compose()
    return () => {
      const i = this.layers.indexOf(h)
      if (i >= 0) { this.layers.splice(i, 1); this.compose() }
    }
  }
  compose() {
    const H: any = this.hooks
    for (const k in H) delete H[k]
    for (const layer of this.layers) {
      const added: any = layer
      for (const k in added) {
        const a = added[k], b = H[k]
        if (!a) continue
        // G-312: a wrapping layer that returns nothing keeps what the layers below gave
        H[k] = !b ? a
          : k == 'wrapHandler' ? (i: any, t: any, s: any, f: any) => { const x = b(i, t, s, f) || f; return a(i, t, s, x) || x }
          : k == 'wrapSources' ? (i: any, s: any) => { const x = b(i, s) || s; return a(i, x) || x }
          : k == 'transformDef' ? (src: any, v: any) => { const x = b(src, v) || src; return a(x, v) || x }
          // onElementCommand: false (not run) from either layer
          : k == 'onElementCommand' ? (i: any, c: any) => { const x = b(i, c); return a(i, c) === false || x === false ? false : undefined }
          : (...args: any[]) => { b(...args); a(...args) }
      }
    }
  }

  dispose() {
    if (this.disposed) return
    try { this.root?.dispose() } finally {
      stopQueued(this.dq)
      this.disposed = true
      for (const n in this.sources) try { this.sources[n]?.dispose?.() } catch (_) {}
      for (const n in this.proxies) try { this.proxies[n]._c() } catch (_) {}
      this.mc?.port1.close()
      this.release()
    }
  }
}

function wrapDOM(dom: any) {
  return new Proxy(dom, {get: (t, p, r) => (typeof p == 'symbol' || p in t ? Reflect.get(t, p, r) : (sel: any) => t.select(sel).events(p))})
}
/** props$ / children$: a memory stream with the current value, fed by setProps */
function seeded(i: any, k: string, v: any) {
  const s = xs.createWithMemory()
  s.shamefullySendNext(v)
  return (i[k] = s)
}
function byId(i: Inst, id: number): Inst | undefined {
  if (i.id === id) return i
  for (const k of i.kids.values()) {
    if (k instanceof Inst) { const f = byId(k, id); if (f) return f }
    else if (k.insts) for (const j of k.insts()) { const f = byId(j, id); if (f) return f }
  }
}

/**
 * The root shim a root setup (persist, GS-5: `Root.persist.setup(component)`, root only as today)
 * runs on before the root exists (04 §3.2, §4 #1): the instance fields it reads and writes today.
 * It may restore into `initialState` and rewrite `model` (both read back into the root's Def);
 * `sources.STATE.stream`, `_dispose$` and `vdom$` are the root's, linked once it exists (the
 * returned function); `action$.shamefullySendNext` dispatches to the root (RESTORE).
 */
function rootShim(app: App, Root: ComponentFn, src: DefSource): [any, () => void] {
  const st$ = xs.create(), dsp$ = xs.create()
  const shim = {
    name: (Root as any).componentName || Root.name || 'FUNCTION_COMPONENT', view: Root,
    model: src.model, initialState: src.initialState, calculated: src.calculated, stateSourceName: 'STATE',
    sources: {...app.sources, STATE: {stream: st$}},
    vdom$: app.vdom$, _dispose$: dsp$,
    action$: {shamefullySendNext: (a: any) => { if (app.root) app.dispatch(app.root, a.type, a.data, 'built-in') }},
  }
  return [shim, () => {
    const r = app.root
    r.stateSource().stream.addListener({next: (v: any) => st$.shamefullySendNext(v), error: () => {}})
    r.dispose$().addListener({next: (v: any) => dsp$.shamefullySendNext(v), error: () => {}})
  }]
}

export interface Started {
  app: App
  sources: Record<string, any>
  sinks: Record<string, any>
  dispose: () => void
  api: RuntimeAPI
}

/**
 * Start an app on the next core: the drivers (run()'s defaults unless useDefaultDrivers is
 * false), the root instance, the first flush. Returns run()'s shape (sources with the root's
 * STATE, sinks: one stream per driver sink, DOM and the root's PARENT) plus the runtime API.
 */
export function start(Root: ComponentFn, drivers: Record<string, any> = {}, opts: StartOptions = {}): Started {
  const app = new App(opts)
  const {mountPoint = '#root', fragments = true, useDefaultDrivers = true} = opts
  const all: Record<string, any> = {
    ...(useDefaultDrivers && {EVENTS: eventBusDriver, DOM: makeDOMDriver(mountPoint as any, {snabbdomOptions: {experimental: {fragments}}} as any), LOG: logDriver, __m: () => mountPoint}),
    ...drivers,
  }
  // the Cycle run loop, reduced: a proxy sink per driver, the driver's source, then the app's
  // streams imitated (values reach a driver synchronously; the DOM gets one vnode per flush)
  for (const n in all) {
    const p = app.proxies[n] = xs.create()
    const src = app.sources[n] = all[n](p, n)
    if (src && typeof src == 'object') try { src._isCycleSource = n } catch (_) {}
  }
  scanSources(app)
  app.vdom$ = xs.create({start: (l: any) => { app.vdomL = l; if (app.last) l.next(app.last) }, stop: () => { app.vdomL = null }})
  for (const n in all) {
    if (n == 'DOM') app.proxies.DOM.imitate(app.vdom$)
    else if (!NOT_SINK.test(n)) app.proxies[n].imitate(app.sink(n))
  }
  const was = app.draining
  app.draining = true
  let link: (() => void) | undefined
  try {
    const setup = (Root as any).persist?.setup
    const def = rootDef(Root, app.hooks.transformDef, opts.__override, typeof setup == 'function' ? (src) => {
      const [shim, l] = rootShim(app, Root, src)
      link = l
      setup(shim)
      return {...src, model: shim.model, initialState: shim.initialState}
    } : undefined)
    app.root = new Inst(app, def, null, rootCell(app), app.sources.DOM, {}, [], undefined,
      opts.uid ? opts.uid.replace(/[^\w-]+/g, '_') : 'u', 'root')
    link?.()
  } catch (e) {
    app.draining = was
    app.dispose()
    throw e
  }
  app.draining = was
  if (app.queue.length) app.drain()
  app.commit()
  let dom$: any
  const sinks: Record<string, any> = {__dispose: () => app.dispose()}
  for (const n of [...Object.keys(all), 'PARENT']) {
    if (n == 'DOM') Object.defineProperty(sinks, n, {get: () => dom$ ||= app.vdom$.remember(), enumerable: true})
    else if (!NOT_SINK.test(n) || n == 'PARENT') Object.defineProperty(sinks, n, {get: () => app.exposed(n), enumerable: true})
  }
  const sources: Record<string, any> = {...app.sources}
  Object.defineProperty(sources, 'STATE', {get: () => app.root.stateSource(), enumerable: true})
  return {app, sources, sinks, dispose: () => app.dispose(), api: app.api()}
}

