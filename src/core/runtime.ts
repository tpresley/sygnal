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
 *   stopped synchronously when the drain / flush ends. The swap is scoped to dispose().
 */
import xs from '../extra/xstreamCompat'
import {makeDOMDriver} from '../cycle/dom/index'
import eventBusDriver from '../extra/eventDriver'
import logDriver from '../extra/logDriver'
import {NOT_SINK} from '../shared'
import {error as logError, callHook} from '../extra/diagnostics/legacy'
import type {ComponentFn, DefSource, Hooks, RuntimeAPI, ActionCause} from './hooks'
import {CoreDef, defOf} from './define'
import {rootCell} from './cell'
import {Inst} from './instance'
import {viewOf} from './view'
import {stopQueued, INST, SET, SEED} from './teardown'
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
  born: Inst[] = []
  watchers = new Set<Inst>()
  /** streams the disposed instances left without listeners, stopped when the drain / flush ends */
  dq: any[] = []
  disposed = false
  initState: any
  /** D168 hook point: R4's dev check re-runs a sample of the views context tracking skipped */
  ctxSkip: ((inst: Inst) => void) | null = null
  /** D169 hook point: a Collection key that appears more than once (R4's dev warning) */
  dupKey: ((owner: Inst, key: any) => void) | null = null
  /** R3 hook point: statics recomputed after each render pass */
  afterRender: (() => void) | null = null
  defs = new WeakMap<ComponentFn, CoreDef>()
  waiters: Array<() => void> = []
  scopeN = 0
  mc: any
  hops: Array<() => void> = []
  ping = false
  desc: any[] = []

  constructor(public opts: StartOptions = {}) {
    this.hooks = {...opts.__hooks}
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
        } else if (q[i + 1] === SEED) inst.cell.set(q[i + 2])
        else inst.handle(q[i + 1], q[i + 2], q[i + 3])
        if (this.watchers.size) this.notify()
      }
    } finally {
      q.length = 0
      this.draining = false
      if (!this.flushing && this.dq.length) stopQueued(this.dq)
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
  pong() {
    this.ping = false
    this.flushes = 0
    for (const g of this.hops.splice(0)) g()
  }
  flush() {
    this.scheduled = false
    if (this.disposed) return
    this.flushing = true
    let v: any, n = 0
    try {
      do {
        this.dirty = false
        if (this.watchers.size) this.notify()
        this.rendering = true
        v = this.root.render()
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
      if (v !== this.last) {
        this.last = v
        this.hooks.onPatch?.(v)
        this.vdomL?.next(v)
      }
      if (this.dq.length) stopQueued(this.dq)
    } finally { this.tail = false }
    if (this.born.length) {
      const b = this.born.splice(0)
      queueMicrotask(() => { for (const i of b) if (!i.disposed) this.dispatch(i, 'BOOTSTRAP', undefined, 'built-in') })
    }
    if (this.dirty) { this.chained = true; this.dirty = false; this.commit() }
    if (this.early) { this.early = false; this.log = {} }
    if (this.waiters.length && !this.scheduled) for (const w of this.waiters.splice(0)) w()
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
      // GS-11: a driver that throws handling a sink value goes to the app's onError ('driver')
      callHook(this.opts.onError, e, {phase: 'driver', driver: n})
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
  addHooks(h: Hooks) {
    const H: any = this.hooks, added: any = h
    const prev: Record<string, any> = {}
    for (const k in added) {
      const a = added[k], b = H[k]
      prev[k] = b
      H[k] = !b ? a
        : k == 'wrapHandler' ? (i: any, t: any, s: any, f: any) => a(i, t, s, b(i, t, s, f))
        : k == 'wrapSources' ? (i: any, s: any) => a(i, b(i, s) || s)
        : k == 'transformDef' ? (src: any, v: any) => a(b(src, v) || src, v)
        : (...args: any[]) => { b(...args); a(...args) }
    }
    return () => { for (const k in prev) H[k] = prev[k] }
  }

  dispose() {
    if (this.disposed) return
    try { this.root?.dispose() } finally {
      stopQueued(this.dq)
      this.disposed = true
      for (const n in this.sources) try { this.sources[n]?.dispose?.() } catch (_) {}
      for (const n in this.proxies) try { this.proxies[n]._c() } catch (_) {}
      this.mc?.port1.close()
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
  app.vdom$ = xs.create({start: (l: any) => { app.vdomL = l; if (app.last) l.next(app.last) }, stop: () => { app.vdomL = null }})
  for (const n in all) {
    if (n == 'DOM') app.proxies.DOM.imitate(app.vdom$)
    else if (!NOT_SINK.test(n)) app.proxies[n].imitate(app.sink(n))
  }
  const was = app.draining
  app.draining = true
  try {
    app.root = new Inst(app, app.def(Root, opts.__override), null, rootCell(app), app.sources.DOM, {}, [], undefined,
      opts.uid ? opts.uid.replace(/[^\w-]+/g, '_') : 'u', 'root')
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

