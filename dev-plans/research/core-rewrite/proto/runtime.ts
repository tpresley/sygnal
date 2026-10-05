/**
 * The app runtime (spike 0-S, ../03-proposal.md §3): one per run().
 *
 * - dispatch(): actions go into one FIFO queue and are processed synchronously, to completion,
 *   in order. An action dispatched while the queue drains (a driver emitting synchronously into a
 *   source during sink delivery, an EFFECT, a sibling's PARENT) is appended; one dispatched
 *   while the flush renders is queued and drained inside the same flush.
 * - commit(): a state write schedules one flush (a microtask).
 * - flush(): loop { STATE watchers, statics, render top-down, drain the queue } until nothing
 *   changed, then ONE vnode to the DOM driver (one patch), then BOOTSTRAP for new instances
 *   (a microtask after the patch). No startup timers, gates or holds.
 * - loop guard: at most LOOP flush passes per flush, and at most LOOP flushes per macrotask;
 *   past that the next flush waits for a MessageChannel message (one per capped flush).
 * - hooks: onCreate / onDispose / onRender / onAction / wrapHandler / onReducer / onNext / onError
 */
import {xs, makeDOMDriver} from 'sygnal'
import {rootCell} from './cell'
import {defOf, Def} from './define'
import {Inst} from './instance'
import {checkStatics} from './statics'

export interface Hooks {
  onCreate?(inst: Inst): void
  onDispose?(inst: Inst): void
  onRender?(inst: Inst, vnode: any): void
  onAction?(inst: Inst, type: string, data: any): void
  wrapHandler?(inst: Inst, type: string, sink: string, fn: any): any
  onReducer?(inst: Inst, type: string, prev: any, next: any): void
  onNext?(inst: Inst, type: string, data: any, ms: number): void
  onError?(error: any, info: {componentName: string; phase: string; action?: string}): void
  onPatch?(vnode: any): void
}

// ------------------------------------------------------------------ teardown
// xstream stops a stream left without listeners in a setTimeout of its own (one per stream: 1,000+
// timers to unmount 1k items). While an instance unsubscribes (tearDown), _remove queues the stream
// instead (_stopID 0: an _add before the stop cancels it, as xstream's clearTimeout would), and the
// queue is stopped synchronously when the flush (or the dispose outside one) ends: no timer at all.
// Scoped to the dispose call, but still a Stream.prototype swap (PLAN-4.5's tearDown, minus timers).
const SP: any = Object.getPrototypeOf(xs.create()), NO = (xs.create() as any)._prod, rm = SP._remove
let down: any[] | null = null
function removeQueued(this: any, il: any) {
  if (this._target) return this._target._remove(il)
  const a = this._ils, i = a.indexOf(il)
  if (i < 0) return
  a.splice(i, 1)
  if (this._prod !== NO && !a.length) { this._err = NO; this._stopID = 0; down!.push(this) }
  else if (a.length == 1) this._pruneCycles()
}
export function tearDown(f: () => void, q: any[]) {
  const outer = down
  down = q; SP._remove = removeQueued
  try { f() } finally { down = outer; if (!outer) SP._remove = rm }
}
export function stopQueued(q: any[]) {
  // each stop can leave its upstream without listeners: it is queued too, and stopped in this loop
  for (let i = 0; i < q.length; i++) {
    const s = q[i]
    if (s._stopID === 0 && !s._ils.length) { s._stopID = NO; tearDown(() => s._prod !== NO && s._stopNow(), q) }
  }
  q.length = 0
}

const LOOP = 100
const macro = (f: () => void) => {
  if (typeof MessageChannel == 'undefined') return void setTimeout(f)
  const c = new MessageChannel()
  c.port1.onmessage = () => { c.port1.close(); f() }
  c.port2.postMessage(0)
}

export class App {
  state: any = undefined
  queue: any[] = []
  draining = false
  rendering = false
  flushing = false
  scheduled = false
  dirty = false
  flushes = 0
  scopeN = 0
  root!: Inst
  vdomL: any
  last: any
  sources: Record<string, any> = {}
  replySrc: string[] = []
  staticSinks: Array<[string, string]> = []
  statics = new Set<Inst>()
  watchers = new Set<Inst>()
  born: Inst[] = []
  out: Record<string, any> = {}
  outL: Record<string, any> = {}
  hooks: Hooks
  stCache = new WeakMap<Def, any>()
  disposed = false
  /** streams the disposed instances left without listeners, stopped at the end of the flush */
  dq: any[] = []

  constructor(hooks: Hooks = {}) { this.hooks = hooks }

  dispatch(inst: Inst, type: string, data: any) {
    if (this.disposed) return
    this.queue.push(inst, type, data)
    if (!this.draining && !this.rendering) this.drain()
  }
  drain() {
    this.draining = true
    const q = this.queue
    try {
      for (let i = 0; i < q.length; i += 3) if (!q[i].disposed) q[i].handle(q[i + 1], q[i + 2])
    } finally {
      q.length = 0
      this.draining = false
      if (!this.flushing && this.dq.length) stopQueued(this.dq)
    }
  }
  commit() {
    if (this.flushing) { this.dirty = true; return }
    if (this.scheduled || this.disposed) return
    this.scheduled = true
    if (++this.flushes > LOOP) macro(() => { this.flushes = 0; this.flush() })
    else {
      if (this.flushes == 1) macro(() => (this.flushes = 0))
      queueMicrotask(() => this.flush())
    }
  }
  flush() {
    this.scheduled = false
    if (this.disposed) return
    this.flushing = true
    let v: any, n = 0
    try {
      do {
        this.dirty = false
        this.rendering = true
        for (const i of this.watchers) for (const w of i.watch!) w()
        v = this.root.render()
        // after the render: it shows / hides Switchable pages and creates instances
        for (const i of this.statics) checkStatics(i)
        this.rendering = false
        if (this.queue.length) this.drain()
      } while (this.dirty && ++n < LOOP)
    } finally {
      this.rendering = false
      this.flushing = false
    }
    if (v !== this.last) { this.last = v; this.hooks.onPatch?.(v); this.vdomL?.next(v) }
    // after the patch: the disposed instances' streams (no timer; the DOM listeners go here)
    if (this.dq.length) stopQueued(this.dq)
    if (this.born.length) {
      const b = this.born.splice(0)
      queueMicrotask(() => { for (const i of b) if (!i.disposed) this.dispatch(i, 'BOOTSTRAP', undefined) })
    }
    if (this.dirty) this.commit()
  }
  error(inst: Inst, e: any, phase: string, action?: string) {
    if (this.hooks.onError) this.hooks.onError(e, {componentName: inst.def.name, phase, action})
    else console.error(`[Sygnal] ${inst.def.name} ${phase}${action ? ' ' + action : ''} failed:`, e)
  }
  send(sink: string, v: any) { this.outL[sink]?.next(v) }
  sink(name: string) {
    return (this.out[name] ||= xs.create({start: (l: any) => { this.outL[name] = l }, stop: () => { delete this.outL[name] }}))
  }
  /** the prototype of every instance's intent sources: a getter per driver, STATE, dispose$ */
  sp: any
  srcProto() {
    if (this.sp) return this.sp
    const p: any = {}
    const def = (n: string, get: (i: Inst) => any) => Object.defineProperty(p, n, {get() { return get(this.__i) }, enumerable: true})
    for (const n in this.sources) if (n !== 'DOM') def(n, (i) => i.src(n))
    def('STATE', (i) => i.stateSource(() => i.cell.get()))
    def('dispose$', (i) => (i.disp$ ||= xs.create()))
    return (this.sp = p)
  }
  /** the [sink, static] pairs of the drivers that take a static this definition declares */
  staticsFor(def: Def) {
    let s = this.stCache.get(def)
    if (s === undefined) {
      const l = this.staticSinks.filter(([, k]) => def.view[k] != null)
      this.stCache.set(def, (s = l.length ? l : null))
    }
    return s
  }
  dispose() {
    this.root.dispose()
    stopQueued(this.dq)
    this.disposed = true
    for (const n in this.sources) this.sources[n]?.dispose?.()
  }
}

/** the built-in EVENTS bus (as src/extra/eventDriver.ts: synchronous, select(type | types | nothing)) */
function eventsDriver(sink$: any) {
  const ls = new Set<(e: any) => void>()
  sink$.addListener({next: (e: any) => ls.forEach(l => l(e)), error: () => {}})
  return {
    select: (type?: string | string[]) => {
      const types = type == null ? null : ([] as string[]).concat(type)
      let l: any
      return xs.create({
        start: (L: any) => ls.add(l = (e: any) => (!types || types.includes(e?.type)) && L.next((e && e.data) || null)),
        stop: () => ls.delete(l),
      })
    },
  }
}

export interface RunOptions { mountPoint?: string | Element; hooks?: Hooks }

export function run(Root: any, drivers: Record<string, any> = {}, {mountPoint = '#root', hooks}: RunOptions = {}) {
  const app = new App(hooks)
  const all: Record<string, any> = {DOM: makeDOMDriver(mountPoint), EVENTS: eventsDriver, ...drivers}
  // the Cycle run loop, reduced: a proxy sink per driver, the driver's source, then the sinks imitated
  const proxies: Record<string, any> = {}
  for (const n in all) {
    const src = app.sources[n] = all[n](proxies[n] = xs.create(), n)
    if (src?.__sygnalReplies) app.replySrc.push(n)
    if (typeof src?.__sygnalStatic == 'string') app.staticSinks.push([n, src.__sygnalStatic])
  }
  for (const n in all) if (n !== 'DOM') proxies[n].imitate(app.sink(n))
  proxies.DOM.imitate(xs.create({start: (l: any) => { app.vdomL = l; if (app.last) l.next(app.last) }, stop: () => { app.vdomL = null }}))
  app.root = new Inst(app, defOf(Root), null, rootCell(app), app.sources.DOM, {}, [])
  app.commit()
  return app
}
