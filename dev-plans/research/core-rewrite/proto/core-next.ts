/**
 * EXPERIMENT (core rewrite study): a minimal component runtime with the proposed structure, to
 * measure what the structure itself costs. NOT a drop-in core: it supports only the canonical
 * subset the benchmark apps use (view, object intent, object/function model with STATE, PARENT,
 * EFFECT and driver sinks, initialState, function .context, tag children with or without a string
 * `state` prop, <Collection of from className>, CHILD.select(Fn), DOM shorthand). No calculated,
 * statics, Suspense/Portal/Transition/Lazy, Switchable, READY, replies, diagnostics or devtools.
 *
 * Structure under test (see ../03-proposal.md):
 *  1. One runtime per app: a synchronous store + run-to-completion action queue (no microtask
 *     per reducer, no pendingReducers / STATE_SNAPSHOT / fresh-state bookkeeping).
 *  2. State "cells" (pull-based lens views memoized on the parent value's identity) instead of a
 *     StateSource + isolate chain per child; Collection items find themselves through one
 *     id -> index map per array (O(1), not a linear scan per item).
 *  3. Definitions normalized once per component function (WeakMap), not per instance / per render.
 *  4. Renders: one microtask flush, top-down, each instance skipped unless its state cell, props,
 *     children or the context keys its view read changed; unchanged subtrees return the same
 *     vnode object (snabbdom skips them).
 *  5. Intent subscribed synchronously at creation (no 0/1/10 ms startup timers, no gates); initial
 *     state seeded synchronously before the first render.
 *  6. Driver sinks: one stream per app per sink; instances push straight into it (no hub per
 *     ancestor). The only streams per instance are the ones the user's intent creates.
 */
// the built package's own xstream and DOM driver (one xstream copy; the src barrels re-export
// types, which a per-file transform can't build)
import {xs, makeDOMDriver} from 'sygnal'

const isAbort = (v: any) => typeof v == 'symbol' && v.description == 'sygnal.ABORT'
const isObj = (o: any) => o !== null && typeof o == 'object' && !Array.isArray(o)

// ------------------------------------------------------------------ definitions (once per fn)

type Handler = [sink: string, fn: any]
interface Def {
  name: string
  view: any
  intent?: (s: any) => Record<string, any>
  handlers: Map<string, Handler[]>
  initialState: any
  context: Array<[string, (s: any) => any]> | null
}
const defs = new WeakMap<any, Def>()
function defOf(view: any): Def {
  let d = defs.get(view)
  if (d) return d
  const handlers = new Map<string, Handler[]>()
  for (const key in view.model || {}) {
    let sinks = view.model[key]
    if (typeof sinks == 'function') sinks = {STATE: sinks}
    const list = handlers.get(key) || handlers.set(key, []).get(key)!
    for (const sink in sinks) list.push([sink, sinks[sink]])
  }
  d = {
    name: view.componentName || view.name || 'Component',
    view,
    intent: view.intent,
    handlers,
    initialState: view.initialState,
    context: view.context ? Object.entries(view.context) as any : null,
  }
  defs.set(view, d)
  return d
}

// ------------------------------------------------------------------ state cells

interface Cell { get(): any; set(v: any): void }
const rootCell = (app: App): Cell => ({get: () => app.state, set: (v) => { app.state = v; app.commit() }})
function keyCell(parent: Cell, k: string): Cell {
  let lp: any = {}, lv: any
  return {
    get() { const p = parent.get(); if (p !== lp) { lp = p; lv = p == null ? undefined : p[k] } return lv },
    set(v) { const p = parent.get(); if (p?.[k] !== v) parent.set({...p, [k]: v}) },
  }
}
// One per Collection: the id -> index map is rebuilt once per array identity, shared by all items
function indexer(arr: Cell) {
  let la: any, map = new Map<any, number>()
  return (): [any[], Map<any, number>] => {
    const a = arr.get() || []
    if (a !== la) { la = a; map = new Map(); for (let i = 0; i < a.length; i++) map.set(a[i]?.id ?? i, i) }
    return [a, map]
  }
}
function itemCell(arr: Cell, index: () => [any[], Map<any, number>], id: any): Cell {
  return {
    get() { const [a, m] = index(); const i = m.get(id); return i === undefined ? undefined : a[i] },
    set(v) {
      const [a, m] = index(), i = m.get(id)
      if (i === undefined || a[i] === v) return
      arr.set(v === undefined ? a.filter((_, j) => j !== i) : a.map((x, j) => (j === i ? v : x)))
    },
  }
}

// ------------------------------------------------------------------ DOM scoping (as makeIsolateSink)

const scopeObj = (scope: string) => ({type: 'total', scope})
function scoped(node: any, isolate: any[]): any {
  return !node || typeof node != 'object' ? node
    : node.sel ? {...node, data: {...node.data, isolate: Array.isArray(node.data?.isolate) ? node.data.isolate : isolate}}
    : node.children ? {...node, children: node.children.map((c: any) => scoped(c, isolate))}
    : node
}
function wrapDOM(dom: any) {
  return new Proxy(dom, {get: (t, p, r) => (typeof p == 'symbol' || p in t ? Reflect.get(t, p, r) : (sel: any) => t.select(sel).events(p))})
}

// ------------------------------------------------------------------ the app runtime

let SCOPE = 0
class App {
  state: any = undefined
  queue: any[] = []
  draining = false
  rendering = false
  scheduled = false
  dom: any
  root!: Inst
  vdomL: any
  last: any
  out: Record<string, any> = {}
  outL: Record<string, any> = {}

  dispatch(inst: Inst, type: string, data: any) {
    this.queue.push(inst, type, data)
    if (!this.draining && !this.rendering) this.drain()
  }
  drain() {
    this.draining = true
    const q = this.queue
    for (let i = 0; i < q.length; i += 3) if (!q[i].disposed) q[i].handle(q[i + 1], q[i + 2])
    q.length = 0
    this.draining = false
  }
  commit() {
    if (!this.scheduled) { this.scheduled = true; queueMicrotask(() => this.flush()) }
  }
  flush() {
    this.scheduled = false
    this.rendering = true
    const v = this.root.render()
    this.rendering = false
    if (v !== this.last && this.vdomL) this.vdomL.next(this.last = v)
    if (this.queue.length) this.drain()
  }
  send(sink: string, v: any) { this.outL[sink]?.next(v) }
  sink(name: string) {
    return this.out[name] ||= xs.create({start: (l: any) => { this.outL[name] = l }, stop: () => { delete this.outL[name] }})
  }
}

// ------------------------------------------------------------------ an instance

const SPECIAL = new Set(['collection'])
class Inst {
  def: Def
  app: App
  parent: Inst | null
  cell: Cell
  dom: any
  ns: any[]
  props: any
  children: any
  subs: any[] = []
  kids = new Map<string, any>()
  childL: any
  disposed = false
  // last render inputs/outputs
  ls: any = {}; lp: any; lc: any; lctx: any; ctxKeys: string[] = []; tmpl: any; outv: any; forced = true
  // context given to children
  cs: any = {}; cpar: any = {}; cv: any

  constructor(app: App, def: Def, parent: Inst | null, cell: Cell, dom: any, props: any, children: any) {
    Object.assign(this, {app, def, parent, cell, props, children})
    this.def = def; this.app = app; this.parent = parent; this.cell = cell
    this.dom = dom
    this.ns = dom._namespace
    if (def.initialState !== undefined && (!parent || cell.get() === undefined)) cell.set(def.initialState)
    if (def.intent) {
      const actions = def.intent({DOM: wrapDOM(dom), CHILD: {select: (fn: any) => this.child$().filter((e: any) => e.c === fn).map((e: any) => e.v)}})
      for (const type in actions) {
        this.subs.push(actions[type].subscribe({next: (d: any) => app.dispatch(this, type, d)}))
      }
    }
  }

  child$() {
    return xs.create({start: (l: any) => { this.childL = l }, stop: () => { this.childL = null }})
  }

  context(): any {
    const par = this.parent ? this.parent.context() : {}
    if (!this.def.context) return par
    const s = this.cell.get()
    if (s === this.cs && par === this.cpar) return this.cv
    this.cs = s; this.cpar = par
    const v: any = {...par}
    for (const [k, f] of this.def.context) v[k] = f(s)
    return (this.cv = v)
  }

  handle(type: string, data: any) {
    const hs = this.def.handlers.get(type)
    if (!hs) return
    const pre = this.cell.get()
    const props = {...this.props, state: pre, context: this.context(), children: this.children}
    for (const [sink, h] of hs) {
      const v = typeof h == 'function' ? h(pre, data, (t: string, d: any, ms = 10) => setTimeout(() => this.app.dispatch(this, t, d), ms), props) : h === true ? data : h
      if (isAbort(v)) continue
      if (sink == 'STATE') { if (v !== pre) this.cell.set(v) }
      else if (sink == 'PARENT') this.parent?.childL?.next({c: this.def.view, v})
      else if (sink != 'EFFECT') this.app.send(sink, v)
    }
  }

  ctxChanged(ctx: any) {
    if (ctx === this.lctx) return false
    for (const k of this.ctxKeys) if (ctx[k] !== this.lctx[k]) return true
    this.lctx = ctx
    return false
  }

  render(): any {
    const state = this.cell.get(), ctx = this.context()
    const viewDirty = this.forced || state !== this.ls || !shallowEq(this.props, this.lp) || !sameKids(this.children, this.lc) || this.ctxChanged(ctx)
    if (viewDirty) {
      this.forced = false
      this.ls = state; this.lp = this.props; this.lc = this.children; this.lctx = ctx
      const keys: string[] = []
      const tracked = new Proxy(ctx, {get: (t, k) => (typeof k == 'string' && keys.push(k), t[k as any])})
      this.tmpl = this.def.view({...this.props, state, context: tracked, children: this.children || [], slots: {}})
      this.ctxKeys = keys
      this.reconcile()
    }
    let kidsDirty = false
    for (const k of this.kids.values()) if (k.render() !== k.last) { k.last = k.outv; kidsDirty = true }
    if (!viewDirty && !kidsDirty) return this.outv
    const v = this.inject(this.tmpl, 'r')
    if (!this.parent) return (this.outv = v)
    const sv = scoped(v, this.ns)
    if (sv && sv.sel && sv.key === undefined) sv.key = JSON.stringify(this.ns)
    return (this.outv = sv)
  }

  // the components in the template, by path (or id prop): kept, created or disposed
  reconcile() {
    const seen = new Set<string>()
    const walk = (n: any, path: string) => {
      if (!n || !n.sel) return
      const p = n.data?.props
      if (p?.sygnalOptions || SPECIAL.has(n.sel)) {
        const id = `${n.sel}::${p.id ?? path}`
        seen.add(id)
        const {sygnalOptions, state, key, ...props} = p
        const k = this.kids.get(id)
        if (k) { k.props = props; k.children = n.children }
        else this.kids.set(id, n.sel === 'collection' ? new Coll(this, p) : this.makeChild(sygnalOptions.view, state, props, n.children))
        return
      }
      const c = n.children
      if (c) for (let i = 0; i < c.length; i++) walk(c[i], path + '.' + i)
    }
    walk(this.tmpl, 'r')
    for (const [id, k] of this.kids) if (!seen.has(id)) { k.dispose(); this.kids.delete(id) }
  }

  makeChild(view: any, state: any, props: any, children: any): Inst {
    const scope = 'c' + ++SCOPE
    const cell = typeof state == 'string' ? keyCell(this.cell, state) : this.cell
    return new Inst(this.app, defOf(view), this, cell, this.dom.isolateSource(this.dom, scope), props, children)
  }

  inject(n: any, path: string): any {
    if (!n || !n.sel) return n
    const p = n.data?.props
    if (p?.sygnalOptions || SPECIAL.has(n.sel)) return this.kids.get(`${n.sel}::${p.id ?? path}`)?.outv
    const c = n.children
    if (!c) return n
    let out: any
    for (let i = 0; i < c.length; i++) {
      const v = this.inject(c[i], path + '.' + i)
      if (v !== c[i]) (out ||= c.slice())[i] = v
    }
    return out ? {...n, children: out} : n
  }

  dispose() {
    this.disposed = true
    this.subs.forEach(s => s.unsubscribe())
    this.kids.forEach(k => k.dispose())
    this.kids.clear()
  }
}

// A Collection: items keyed by id, each an Inst with an item cell; output = container div
let COLL = 0
class Coll {
  items = new Map<any, Inst>()
  arr: Cell
  index: () => [any[], Map<any, number>]
  la: any
  outv: any
  last: any
  key = 'coll' + ++COLL
  def: Def
  constructor(public owner: Inst, public props: any) {
    this.arr = keyCell(owner.cell, props.from)
    this.index = indexer(this.arr)
    this.def = defOf(props.of)
  }
  render() {
    const [a, m] = this.index()
    let changed = a !== this.la
    if (changed) {
      this.la = a
      for (const [id, inst] of this.items) if (!m.has(id)) { inst.dispose(); this.items.delete(id) }
      for (let i = 0; i < a.length; i++) {
        const id = a[i]?.id ?? i
        if (!this.items.has(id)) {
          const dom = this.owner.dom.isolateSource(this.owner.dom, `${this.key}-${id}`)
          this.items.set(id, new Inst(this.owner.app, this.def, this.owner, itemCell(this.arr, this.index, id), dom, {}, []))
        }
      }
    }
    const kids: any[] = Array(a.length)
    for (let i = 0; i < a.length; i++) {
      const inst = this.items.get(a[i]?.id ?? i)!
      const v = inst.render()
      if (v !== inst.last) { inst.last = v; changed = true }
      kids[i] = v
    }
    if (!changed && this.outv) return this.outv
    return (this.outv = {sel: 'div', data: this.props.className ? {props: {className: this.props.className}} : {}, children: kids, key: this.key, text: undefined, elm: undefined})
  }
  dispose() { this.items.forEach(i => i.dispose()); this.items.clear() }
}

function sameKids(a: any, b: any) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
function shallowEq(a: any, b: any) {
  if (a === b) return true
  if (!isObj(a) || !isObj(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (a[k] !== b[k]) return false
  return true
}

// ------------------------------------------------------------------ run

export function run(App: any, drivers: Record<string, any> = {}, {mountPoint = '#root'} = {}) {
  const app = new App_()
  const all: Record<string, any> = {DOM: makeDOMDriver(mountPoint), ...drivers}
  // the Cycle run loop, reduced: a proxy sink per driver, the driver's source, then main's sinks imitated
  const proxies: Record<string, any> = {}, sources: Record<string, any> = {}
  for (const n in all) sources[n] = all[n](proxies[n] = xs.create())
  app.dom = sources.DOM
  app.root = new Inst(app, defOf(App), null, rootCell(app), sources.DOM, {}, [])
  app.commit()
  proxies.DOM.imitate(xs.create({start: (l: any) => { app.vdomL = l; if (app.last) l.next(app.last) }, stop: () => { app.vdomL = null }}))
  for (const n in all) if (n !== 'DOM') proxies[n].imitate(app.sink(n))
  return app
}
const App_ = App
