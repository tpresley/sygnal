/**
 * A component instance (spike 0-S, ../03-proposal.md §5).
 *
 * - created synchronously: state seeded, replies and intent subscribed at construction (no
 *   startup timers or gates); INITIALIZE model entries queued, BOOTSTRAP after the first patch
 * - handle(): one action, run to completion; every sink gets the state from before the action
 * - render(): skipped (cached vnode returned) unless its state, props, children, the context keys
 *   its view read, or a child's output / READY changed
 * - children keyed by path or id prop in a Map; hosts (Collection, Switchable) and markers come
 *   from the registry
 */
import {xs} from 'sygnal'
import {Cell, calcCell, keyCell, lensCell, localCell, isObj} from './cell'
import {Def, defOf} from './define'
import {hosts, posts, pres, resolvers} from './registry'
import {checkStatics} from './statics'
import {tearDown} from './runtime'
import type {App} from './runtime'

export const isAbort = (v: any) => typeof v == 'symbol' && v.description == 'sygnal.ABORT'

// ------------------------------------------------------------------ DOM scoping (as makeIsolateSink)
function scoped(node: any, isolate: any[]): any {
  return !node || typeof node != 'object' ? node
    : node.sel ? {...node, data: {...node.data, isolate: Array.isArray(node.data?.isolate) ? node.data.isolate : isolate}}
    : node.children ? {...node, children: node.children.map((c: any) => scoped(c, isolate))}
    : node
}
function wrapDOM(dom: any) {
  return new Proxy(dom, {get: (t, p, r) => (typeof p == 'symbol' || p in t ? Reflect.get(t, p, r) : (sel: any) => t.select(sel).events(p))})
}
const notReady = (v: any) => v && v.sel ? {...v, data: {...v.data, attrs: {...v.data?.attrs, 'data-sygnal-ready': 'false'}}} : v

let IDS = 0
export class Inst {
  id = ++IDS
  def: Def
  app: App
  parent: Inst | null
  cell: Cell
  dom: any
  ns: any[]
  props: any
  children: any
  scope: any
  hidden = false
  subs: any[] = []
  kids = new Map<string, any>()
  hub: any
  disposed = false
  ready: boolean
  // last render inputs/outputs; `last`/`lr` are the parent's view of this instance's output
  ls: any = {}; lp: any; lc: any; lctx: any; ctxKeys: string[] = []; tmpl: any; outv: any; forced = true
  last: any; lr = true
  postSels: string[] | null = null
  // context memo
  cs: any = {}; cpar: any = {}; cv: any
  // statics: [sink, static][]; last state / shown / values
  st: Array<[string, string]> | null
  sS: any = {}; sH: any; sv: Record<string, any> = {}
  srcs: Record<string, any> = {}
  fb: Record<string, any> | null = null
  ac: AbortController | null = null
  disp$: any
  watch: Array<() => void> | null = null

  constructor(app: App, def: Def, parent: Inst | null, cell: Cell, dom: any, props: any, children: any, scope?: any) {
    this.app = app; this.def = def; this.parent = parent
    this.props = props; this.children = children; this.scope = scope
    this.dom = dom
    this.ns = dom._namespace
    this.ready = !def.ready
    if (def.isolated && parent) cell = localCell(app)
    if (def.calc || def.idle) cell = calcCell(cell, def)
    this.cell = cell
    // the initial state, synchronously (INITIALIZE): a root, an isolated child, or a child whose slice is missing
    if (def.initialState !== undefined && (!parent || def.isolated || cell.get() === undefined)) cell.set(def.initialState)
    else if (!parent && (def.calc || def.idle) && isObj(cell.get())) cell.set(cell.get())
    app.hooks.onCreate?.(this)
    if (def.handlers.has('INITIALIZE')) app.dispatch(this, 'INITIALIZE', def.initialState)
    this.st = app.staticsFor(def)
    // a new declaration is sent in this flush (or the next one)
    if (this.st) { app.statics.add(this); app.commit() }
    // reply actions, only from the reply-capable sources this definition sends to (or declares to)
    for (const n of app.replySrc) {
      if (def.sinks.has(n) || this.st?.some(s => s[0] == n)) {
        this.subs.push(app.sources[n].replies(this.id).subscribe({next: (a: any) => app.dispatch(this, a.type, a.data)}))
      }
    }
    if (def.intent) {
      // a stream that emits on subscribe (startWith, xs.of) only queues: drained after construction
      const was = app.draining
      app.draining = true
      try {
        const actions = def.intent(this.sources())
        for (const type in actions) {
          const s = actions[type]
          if (s) this.subs.push(s.subscribe({next: (d: any) => app.dispatch(this, type, d), error: (e: any) => app.error(this, e, 'intent', type)}))
        }
      } finally { app.draining = was }
      if (!was && !app.rendering && app.queue.length) app.drain()
    }
    if (def.handlers.has('BOOTSTRAP')) app.born.push(this)
  }

  // ---------------------------------------------------------------- sources (the stream edge)
  sources() {
    // driver sources, STATE and dispose$ are getters on one prototype per app (created on first read)
    const so = Object.create(this.app.srcProto())
    so.__i = this
    so.DOM = wrapDOM(this.dom)
    so.CHILD = {select: (fn: any) => (this.hub ||= xs.create()).filter((e: any) => e.c === fn).map((e: any) => e.v)}
    return so
  }
  /** STATE facade: the stream / watch exist only if the intent asks for them */
  stateSource(get: () => any): any {
    const inst = this
    const watchOf = (sel: (s: any) => any, immediate: boolean) => {
      let last: any = sel(get()), l: any
      const check = () => { const v = sel(get()); if (v !== last && !shallowEq(v, last)) { last = v; l?.next(v) } }
      return xs.create({
        start: (L: any) => { l = L; (inst.watch ||= []).push(check); inst.app.watchers.add(inst); if (immediate) L.next(last) },
        stop: () => { l = null; inst.watch = inst.watch!.filter(c => c !== check) },
      })
    }
    return {
      get stream() { return watchOf((s) => s, true) },
      watch: (sel: any, o?: any) => watchOf(sel, !!o?.immediate),
      select: (lens: any) => inst.stateSource(() => lens.get(get())),
    }
  }
  /** this instance's scope path, outermost first */
  scopes(): any[] {
    const out: any[] = []
    for (let i: Inst | null = this; i; i = i.parent) if (i.scope !== undefined) out.unshift(i.scope)
    return out
  }
  /** a driver source isolated to this instance (isolateSource per scope, cached) */
  src(n: string) {
    if (n in this.srcs) return this.srcs[n]
    let s = this.app.sources[n]
    if (s?.isolateSource) for (const sc of this.scopes()) s = s.isolateSource(s, sc)
    return (this.srcs[n] = s)
  }

  // ---------------------------------------------------------------- actions
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
    const app = this.app, H = app.hooks
    const pre = this.cell.get()
    H.onAction?.(this, type, data)
    let props: any, outs: any[] | null = null
    const next = (t: string, d?: any, ms = 10) => {
      H.onNext?.(this, t, d, ms)
      setTimeout(() => this.disposed || app.dispatch(this, t, d), ms)
    }
    for (const [sink, h0] of hs) {
      const h = H.wrapHandler ? H.wrapHandler(this, type, sink, h0) : h0
      let v: any
      try {
        v = typeof h == 'function'
          ? h(pre, data, next, props ||= this.reducerProps(pre))
          : h === true ? data : h
      } catch (e) { app.error(this, e, 'model', type); continue }
      if (isAbort(v) || sink == 'EFFECT') continue
      if (sink == 'STATE') { if (v !== pre) { H.onReducer?.(this, type, pre, v); this.cell.set(v) } }
      else if (sink == 'PARENT') this.parent?.hub?.shamefullySendNext({c: this.def.view, v})
      else if (sink == 'READY') this.setReady(!!v)
      else if (sink == 'ELEMENT') {} // not in the spike (queued until after the next patch)
      else if (this.st) (outs ||= []).push(sink, v)
      else this.send(sink, v)
    }
    // G-158: a static this action changed reaches its driver before this action's own values
    if (outs) { checkStatics(this); for (let i = 0; i < outs.length; i += 2) this.send(outs[i], outs[i + 1]) }
  }

  /** the 4th reducer argument: the parent's props + state, context, children, and `signal` (EFFECT; aborted on dispose) */
  reducerProps(pre: any) {
    const p = {...this.props, state: pre, context: this.context(), children: this.children}
    return Object.defineProperty(p, 'signal', {get: () => (this.ac ||= new AbortController()).signal})
  }

  setReady(r: boolean) {
    if (r !== this.ready) { this.ready = r; this.app.commit() }
  }

  /** a sink value: stamped with the sender, scoped through the ancestors (isolateValue, or one stream per sink as fallback) */
  send(n: string, v: any) {
    const app = this.app, src = app.sources[n]
    if (n == 'EVENTS' || (src?.__sygnalReplies && isObj(v))) {
      v = Object.defineProperties({...v}, {__emitterId: {value: this.id, configurable: true}, __emitterName: {value: this.def.name, configurable: true}})
    }
    if (src?.isolateSink) {
      const sc = this.scopes()
      if (sc.length) {
        if (!src.isolateValue) return (this.fb?.[n] || this.fallback(n, src, sc)).shamefullySendNext(v)
        for (let i = sc.length; i--;) v = src.isolateValue(v, sc[i])
      }
    }
    app.send(n, v)
  }
  fallback(n: string, src: any, sc: any[]) {
    const s$ = xs.create()
    let o = s$
    for (let i = sc.length; i--;) o = src.isolateSink(o, sc[i])
    this.subs.push(o.subscribe({next: (v: any) => this.app.send(n, v)}))
    return ((this.fb ||= {})[n] = s$)
  }

  /** shown unless this instance or an ancestor is a hidden Switchable page */
  shown() {
    for (let i: Inst | null = this; i; i = i.parent) if (i.hidden) return false
    return true
  }

  // ---------------------------------------------------------------- render
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
      try {
        this.tmpl = this.def.view({...this.props, state, context: tracked, children: this.children || [], slots: {}})
      } catch (e) {
        this.app.error(this, e, 'view')
        this.tmpl = this.def.onError ? this.def.onError(e, {componentName: this.def.name}) : {sel: 'div', data: {attrs: {'data-sygnal-error': this.def.name}}, children: [], text: undefined, elm: undefined, key: undefined}
      }
      this.ctxKeys = keys
      this.reconcile()
    }
    let kidsDirty = false
    for (const k of this.kids.values()) {
      if (k.render() !== k.last || k.ready !== k.lr) { k.last = k.outv; k.lr = k.ready; kidsDirty = true }
    }
    if (!viewDirty && !kidsDirty) return this.outv
    let v = this.inject(this.tmpl, 'r')
    if (this.postSels) for (const s of this.postSels) v = posts[s](v)
    this.app.hooks.onRender?.(this, v)
    if (!this.parent) return (this.outv = v)
    const sv = scoped(v, this.ns)
    if (sv && sv.sel && sv.key === undefined) sv.key = JSON.stringify(this.ns)
    return (this.outv = sv)
  }

  // the components in the template, by path (or id prop): kept, created or disposed
  reconcile() {
    const seen = new Set<string>()
    let ps: string[] | null = null
    const walk = (n: any, path: string, parentNode: any, idx: number) => {
      if (!n || !n.sel || n.$p) return
      const sel = n.sel
      if (pres[sel]) { const r = pres[sel](n, this); if (parentNode) parentNode.children[idx] = r; else this.tmpl = r; return walk(r, path, parentNode, idx) }
      const p = n.data?.props
      const host = hosts[sel]
      if (p?.sygnalOptions || host) {
        let view = p?.sygnalOptions?.view
        if (view) for (const r of resolvers) view = r(view, this)
        const id = `${sel}::${p?.id ?? path}`
        seen.add(id)
        const {sygnalOptions, state, key, id: _id, ...props} = p || {}
        let k = this.kids.get(id)
        if (k && view && k.def.view !== view) { k.dispose(); this.kids.delete(id); k = undefined }
        if (k) { if (k.setProps) k.setProps(p, n.children); else { k.props = props; k.children = n.children } }
        else this.kids.set(id, host ? host(this, p, n.children) : this.makeChild(view, state, props, n.children))
        return
      }
      if (posts[sel]) (ps ||= []).includes(sel) || ps.push(sel)
      const c = n.children
      if (c) for (let i = 0; i < c.length; i++) walk(c[i], path + '.' + i, n, i)
    }
    walk(this.tmpl, 'r', null, 0)
    this.postSels = ps
    for (const [id, k] of this.kids) if (!seen.has(id)) { k.dispose(); this.kids.delete(id) }
  }

  makeChild(view: any, state: any, props: any, children: any): Inst {
    const scope = 'c' + (this.app.scopeN++)
    const cell = typeof state == 'string' ? keyCell(this.cell, state, this.def.calcNames?.has(state) && this.def.name)
      : state && typeof state == 'object' ? lensCell(this.cell, state) : this.cell
    return new Inst(this.app, defOf(view), this, cell, this.dom.isolateSource(this.dom, scope), props, children, scope)
  }

  inject(n: any, path: string): any {
    if (!n || !n.sel || n.$p) return n
    const p = n.data?.props
    if (p?.sygnalOptions || hosts[n.sel]) {
      const k = this.kids.get(`${n.sel}::${p?.id ?? path}`)
      return k && (k.ready ? k.outv : notReady(k.outv))
    }
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
    if (this.disposed) return
    if (this.def.handlers.has('DISPOSE')) this.handle('DISPOSE', undefined)
    this.disposed = true
    this.app.hooks.onDispose?.(this)
    if (this.disp$) { this.disp$.shamefullySendNext(true); this.disp$.shamefullySendComplete() }
    this.ac?.abort()
    tearDown(() => { for (const s of this.subs) s.unsubscribe() }, this.app.dq)
    this.subs.length = 0
    this.kids.forEach(k => k.dispose())
    this.kids.clear()
    if (this.st) this.app.statics.delete(this)
    if (this.watch) this.app.watchers.delete(this)
  }
}

export function sameKids(a: any, b: any) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
export function shallowEq(a: any, b: any) {
  if (a === b) return true
  if (!isObj(a) || !isObj(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (a[k] !== b[k]) return false
  return true
}
