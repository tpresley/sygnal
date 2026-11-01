/**
 * PLAN-4.6 core: a component instance (03-proposal §5).
 *
 * - Created synchronously: the state cell, the initial state written, onCreate, INITIALIZE
 *   queued, the intent subscribed (an emission on subscribe only queues: it is drained after the
 *   construction, or in the flush that created the instance). BOOTSTRAP is dispatched a
 *   microtask after the flush that rendered it first (D165).
 * - Sources at the edge (lazy getters): every driver source isolated to the instance, DOM with
 *   the event shorthand, STATE (stream: identity, watch: deep, as today, D170), CHILD.select(Fn),
 *   props$ / children$ / dispose$ for sub-components.
 * - render(): the cached vnode unless its state, props, children, a context key its view read
 *   (D168), or a child's vnode / READY changed. Children are keyed in a Map by `name::id|path`.
 * - dispose(): DISPOSE, onDispose, dispose$, the EFFECT signal aborted, the subtree, then the
 *   streams (the scoped _remove swap: no xstream stop timers, D165/Q18).
 */
import xs from '../extra/xstreamCompat'
import {StateSource} from '../cycle/state/StateSource'
import {uidPart, BINDING} from '../shared'
import {warn, error as logError, fail} from '../extra/diagnostics/legacy'
import type {App} from './runtime'
import {tearDown, INST, SEED} from './teardown'
import {CoreDef, defOf, isObj} from './define'
import {Cell, CalcCell, calcCell, keyCell, lensCell, localCell, pathOf} from './cell'
import {ext, hosts, posts, pres, resolvers} from './registry'
import {handle} from './actions'
import {viewOf} from './view'
import {makeCommandSource} from '../extra/command'
import {attach, detach} from './statics'
import {dbg} from './debug'
import {sameData} from '../cycle/dom/utils'

// v7: a known binding target joins key/id/path in the lifetime identity. Fresh equivalent
// byId helpers retain identity; opaque lenses need an explicit key for a new target.
export function bindingChanged(a: any, b: any): boolean {
  if (a === b) return false
  const x = a?.[BINDING], y = b?.[BINDING]
  return x && y ? !x.every((v: any, i: number) => Object.is(v, y[i]))
    : !!(x || y || typeof a == 'string' || typeof b == 'string' || a === undefined || b === undefined)
}

/** a binding whose target is known (a key, a byId selection): its deletion ends the child */
export const known = (b: any) => typeof b == 'string' || b?.[BINDING]
/** F-3: `owner` watches child (or Switchable page) `k`'s target: notify() disposes it when deleted */
export function watch(owner: Inst, k: any) {
  k.bs = bindingState(k)
  ;(owner.bound ||= new Set()).add(k)
  owner.app.watchers.add(owner)
}

function bindingState(k: any): any {
  const c = k.base || k.cell || k.arr
  return c && (c.has?.() ?? c.get() !== undefined) ? (k.cell || k.arr).get() : undefined
}

const ERR_FIX = 'See the attached error'

// 4-I G-557: a fragment root (a Collection's): each of its top-level elements is marked.
// 4-K G-572: a text root (no element; an attribute would land on a Text node) gets `ready: false`
// (read by Suspense)
const notReady = (v: any): any => v?.sel ? {...v, data: {...v.data, attrs: {...v.data?.attrs, 'data-sygnal-ready': 'false'}}}
  : v?.children ? {...v, children: v.children.map(notReady)} : v && {...v, ready: false}
const errorDiv = (name: string) => ({sel: 'div', data: {attrs: {'data-sygnal-error': name}}, children: [], text: undefined, elm: undefined, key: undefined})

/** <Slot name="x"> children -> slots.x; the rest -> slots.default and `children` */
function extractSlots(children: any[]): [any[], Record<string, any[]>] {
  const slots: Record<string, any[]> = {}, rest: any[] = []
  for (const c of children) {
    // G-480: the <Slot> marker (`data.m`), not a plain <slot> element (a shadow-DOM component's)
    if (c?.data?.m && c.sel === 'slot') {
      const k = c.children
      ;(slots[c.data?.props?.name || 'default'] ||= []).push(...(Array.isArray(k) ? k : k ? [k] : []))
    } else rest.push(c)
  }
  if (rest.length) (slots.default ||= []).push(...rest)
  return [slots.default || [], slots]
}

/**
 * an instance's id among its parent's children (D456): its vnode `key`, else its `id` prop, else
 * its path in the view
 */
const idOf = (n: any, path: string) => {
  const id = n.key ?? n.data?.props?.id
  let s: any
  // (G-298: an id JSON can't encode, a BigInt, is used as its string)
  if (id != null) try { s = JSON.stringify(id) } catch (_) { s = String(id) }
  return `${n.sel}::${(s && s.replace(/"/g, '')) || path}`
}

/**
 * a component vnode's props, without `resetState` (D174: read at creation, never a
 * prop of the child). Known `state` target changes start a new lifetime in v7.
 */
function propsOf(p: any) {
  if (!p) return {}
  if (!('resetState' in p)) return p
  const {resetState, ...rest} = p
  return rest
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

/**
 * P46-P: two pragma-plain trees (no component, form field or foreign vnode) that render the same:
 * the same tags, keys, text and data (each bucket shallow-equal). A re-run view whose output is
 * the same keeps its last vnode, so the patch skips that subtree by identity.
 * G-349: a vnode with a `hook` is never the same (its update/postpatch run on every patch, a
 * hoisted hook object too; refs and autoFocus chain their hooks there).
 * G-353: at most SAME_MAX vnodes are compared; a larger tree is not the same (it patches, as
 * before P46-P), so a big view whose last row changed doesn't walk the whole tree before the patch
 */
const SAME_MAX = 1000
let left = 0
export const sameTree = (a: any, b: any): boolean => (left = SAME_MAX, same(a, b))
function same(a: any, b: any): boolean {
  if (a === b) return true
  // CV-3: a compiled block (its inside is its hole values)
  if (b?.$b) return !!a?.$b && ext.sb!(a, b)
  if (--left < 0 || !a || !b || a.sel !== b.sel || a.key !== b.key || a.text !== b.text || b.data?.hook || !sameData(a.data, b.data)) return false
  const x = a.children, y = b.children
  if (x === y) return true
  if (!x || !y || x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) if (!same(x[i], y[i])) return false
  return true
}

const EMPTY_CTX: any = Object.freeze({})
/** a view read every key (spread, Object.keys): any context change re-renders it */
const ALL = '\u0000all'
// D168 read-tracking: one handler for every view; each render's Proxy targets a holder of that
// render's context (c) and the instance's key set (k), so a read after the view returned (a
// closure the view made) still sees its own render's context
const track = (h: any, k: any) => (typeof k == 'string' && h.k.add(k), k)
const TRACK: ProxyHandler<any> = {
  get: (h, k) => h.c[track(h, k)],
  has: (h, k) => track(h, k) in h.c,
  ownKeys: (h) => (h.k.add(ALL), Reflect.ownKeys(h.c)),
  getOwnPropertyDescriptor: (h, k) => Reflect.getOwnPropertyDescriptor(h.c, k),
}

let IDS = 0
// shared defaults (one per module, not per instance): the first render's "last state", no
// slots, no tag children (reconcile() makes an instance its own Map on its first child)
const UNSET = {}
const NOSLOTS: Record<string, any[]> = Object.freeze({}) as any
const NOKIDS = new Map<string, any>()

/**
 * a child that failed to instantiate: renders the owner's error fallback (SYG408). It keeps its
 * props, so only a changed binding target makes another attempt (not every owner render)
 */
class Failed {
  last: any; lr = true; ready = true; def: any = null; disposed = false; shown = true
  constructor(public outv: any, public props?: any) {}
  render() { return this.outv }
  setProps(p: any) { this.props = p }
  dispose() {}
}

/**
 * The intent's sources: a Proxy whose own properties are the source names, in the table's order
 * (spread, Object.keys, `in`, destructuring as on a plain object), each made when read; one
 * handler for every instance (a property defined with Object.defineProperty per instance was
 * ~1 µs of its creation). Its target holds the instance and what the intent adds
 */
const table = (t: any) => t[INST].app.srcDesc(!!t[INST].parent)
const tab = (t: any, k: any): any => typeof k == 'string' && table(t)[k]
const SRC: ProxyHandler<any> = {
  get: (t, k) => { const g = tab(t, k); return g ? g(t[INST]) : t[k] },
  has: (t, k) => !!tab(t, k) || k in t,
  ownKeys: (t) => Object.keys(table(t)).concat(Reflect.ownKeys(t) as any),
  getOwnPropertyDescriptor: (t, k) => { const g = tab(t, k); return g ? {value: g(t[INST]), enumerable: true, configurable: true} : Reflect.getOwnPropertyDescriptor(t, k) },
  // a source is read-only, as the getter-only property it was: a write fails (a TypeError in strict code)
  set: (t, k, v) => !tab(t, k) && ((t[k] = v), true),
}

/** an intent stream's listener: its action (an object, no closures per stream) */
class Listener {
  constructor(public i: Inst, public t: string) {}
  next(d: any) { const i = this.i; i.dying ? handle(i, this.t, d, 'intent') : i.app.dispatch(i, this.t, d, 'intent') }
  // (no code of its own yet: R4's diagnostics may add one)
  error(e: any) { const i = this.i; console.error(`[Sygnal] ${i.def.name}: intent stream '${this.t}' errored; it stops emitting`, e); i.app.appError(i, e, 'intent', this.t) }
}

export class Inst {
  readonly id = IDS++
  disposed = false
  /** debug logging for this instance (the DevTools toggle; core/debug.ts) */
  debug = false
  /** in dispose(), while dispose$ emits: its actions run at once */
  dying = false
  ready: boolean
  shown = true
  /** the decorated cell (calculated fields, idle defaults) and the raw value */
  cell: CalcCell
  props: Record<string, any>
  children!: any[]
  /** the children as the parent passed them (slots included) */
  raw!: any[]
  slots = NOSLOTS
  kids = NOKIDS
  /** the children with a string / byId binding: the presence scan's (notify) */
  bound?: Set<any>
  uidBase: string
  // (the fields most instances set are initialized here, so they are the object's own slots;
  // the ones few instances use are left out until used)
  /** the parent's view of this instance's output (last vnode / READY it injected) */
  last: any; lr = true
  outv: any
  // the last render's inputs: state, props, children, context, the context keys its view read
  ls: any = UNSET; lp: any; lc: any; lctx: any; keys: Set<string> | null = null; tmpl: any; forced = true
  postSels: string[] | null = null
  // context memo: the app's write version it was computed at, the value
  cver = -1; cv: any
  subs: any[] = []
  /** a Collection item's key; the isolate memo (runtime scopeValue) */
  k: any; $iso: any
  /** canvas-three F2: a template node's last injected copy, by the node (its children array, `.r` the copy) */
  ic?: WeakMap<any, any>
  srcs?: Record<string, any>
  fb?: Record<string, any>
  ac?: AbortController | null
  disp$: any
  st$: any; stLast: any; stateSrc: any
  props$: any; children$: any
  /** CHILD.select listeners (the children's PARENT values) */
  hub?: Set<(e: any) => void> | null
  wd: any; so: any; el: any
  iv: any
  cmds: any
  /** the app's render epoch it last rendered at (G-311) */
  ep = 0
  /** pending next() timers (G-300) */
  timers?: Set<any> | null
  // statics.ts: the [sink, static] pairs it declares, the last values sent, the state / shown
  // flag they were computed from; its reply streams
  st?: Array<[string, string]> | null
  sv?: Record<string, any> | null
  sS: any; sH: any; sC: any
  rep?: any[] | null

  constructor(
    public app: App, public def: CoreDef, public parent: Inst | null, public base: Cell,
    public dom: any, props: Record<string, any>, children: any[], public scope: string | undefined,
    uidBase: string, public kind: 'root' | 'child' | 'item' | 'page' = parent ? 'child' : 'root', reset = false,
  ) {
    this.props = props
    this.setChildren(children)
    this.uidBase = uidBase
    this.ready = !def.ready
    // (no calculated fields: the base cell itself)
    this.cell = def.calculated || def.idle ? calcCell(base, def) : base as CalcCell
    const H = app.hooks
    // the initial state, synchronously (INITIALIZE at construction, D165): a root (or the state an
    // HMR swap keeps), an isolated child's local state. D174: an isolated child bound to a slice
    // (state="key" or a lens) seeds it with initialState only while it is undefined (with a model,
    // as today's INITIALIZE; without one it reads initialState while the slice is missing), and
    // `resetState` replaces it at creation; an existing slice is kept (onStateSeed: R4's warning)
    let init = !parent && app.initState !== undefined ? app.initState : def.initialState
    // a root without a model renders from `initialState || true` (G-172, as today)
    if (!parent && !def.model && !init) init = true
    // R4: a shallow copy, as today's INITIALIZE reducer made ({...initialState}): the static is
    // shared by every instance (and the dev entry freezes it, D152), the state is the instance's
    else if (isObj(init)) init = {...init}
    if (init !== undefined) {
      if (!parent || (def.isolated && (base as any).local)) this.cell.set(init)
      else if (def.isolated) {
        const b: any = base, has = b.has ? b.has() : b.get() !== undefined
        // the parent's slice is written as a queued action (before INITIALIZE), so a child that
        // fails to start (G-295) never touches it: the drain skips a disposed instance
        if (reset || (!has && def.model)) app.dispatch(this, SEED, {v: init, r: reset, b}, 'built-in')
        else if (has) H.onStateSeed?.(viewOf(this), b.get(), init)
      }
    } else if (def.idle && isObj(this.rawState()) && !parent) this.cell.set(this.rawState())
    H.onCreate?.(viewOf(this))
    dbg(this, () => 'Instantiated')
    if (def.handlers.has('INITIALIZE')) app.dispatch(this, 'INITIALIZE', init, 'built-in')
    if (app.stat.length || app.rep.length) attach(this)
    if (def.intent) {
      try { this.subscribe() } catch (e) {
        // G-295: undone (its queued actions are skipped, no STATE watcher, onDispose pairs onCreate)
        this.disposed = true
        app.watchers.delete(this)
        detach(this)
        H.onDispose?.(viewOf(this))
        throw e
      }
    }
    if (def.handlers.has('BOOTSTRAP')) app.born.push(this)
  }

  get name() { return this.def.name }
  /** the state with calculated fields only as stored (STATE.stream) */
  rawState() { return this.cell === this.base ? this.base.get() : this.cell.raw() }

  // ---------------------------------------------------------------- sources (the stream edge)
  subscribe() {
    const app = this.app, H = app.hooks, def = this.def
    // an emission on subscribe (startWith, xs.of) only queues; drained after the construction
    const was = app.draining
    app.draining = true
    try {
      let so = this.sources()
      if (H.wrapSources) so = H.wrapSources(viewOf(this), so) || so
      const actions = def.intent!(so)
      // G-338: one stream of { type, data } (a form 6.0 removed), not an object of streams
      if (actions && typeof actions.addListener == 'function') fail('SYG603', this, 'intent returned a single stream, a form Sygnal 6.0 removed', 'Return an object of streams, one per action: { ACTION: stream$ }. See https://sygnal.js.org/guide/migrating-to-6#leftovers')
      if (!isObj(actions)) fail('SYG603', this, 'intent must return an object of streams', 'Return { ACTION: stream$ }')
      H.onIntent?.(viewOf(this), Object.keys(actions))
      for (const type in actions) {
        const s = actions[type]
        if (s == null) continue
        if (typeof s.subscribe != 'function') fail('SYG603', this, `intent entry '${type}' is not a stream`, 'Return { ACTION: stream$ }')
        this.subs.push(s.subscribe(new Listener(this, type)))
      }
    } catch (e) {
      // a failed instance keeps no subscription (its parent renders the error fallback)
      for (const s of this.subs) s.unsubscribe()
      this.subs = []
      throw e
    } finally { app.draining = was }
    if (!was && !app.rendering && app.queue.length) app.drain()
  }

  sources() {
    return this.so ||= new Proxy({[INST]: this}, SRC)
  }
  /** a driver source isolated to this instance (the parent's, isolated to this scope; cached) */
  src(n: string): any {
    const c = this.srcs ||= {}
    if (n in c) return c[n]
    let s = this.parent ? this.parent.src(n) : this.app.sources[n]
    if (this.scope !== undefined && s && typeof s.isolateSource == 'function') s = s.isolateSource(s, this.scope)
    return (c[n] = s)
  }
  /** STATE: today's StateSource over a memory stream fed on changes (identity; undefined skipped) */
  stateSource() {
    if (this.stateSrc) return this.stateSrc
    this.st$ = xs.createWithMemory()
    const v = this.stLast = this.rawState()
    if (v !== undefined) this.st$.shamefullySendNext(v)
    this.app.watchers.add(this)
    return (this.stateSrc = new StateSource(this.st$, 'STATE', this.dispose$(), 1))
  }
  /** called after each action and before each render pass: STATE.stream emits a new state */
  notify() {
    // A completed action can remove and reinsert a target before the next render. Owners
    // observe each transition, including hidden pages; the current action finishes first.
    // only the bound children (a string / byId binding), not every child
    if (this.bound) for (const k of this.bound) {
      if (k.disposed) { this.bound.delete(k); continue }
      const previous = k.bs, state = k.bs = bindingState(k)
      if (previous !== undefined && state === undefined) {
        // Cleanup reads its last owned snapshot. A dying path must not recreate the
        // deleted target; the fresh lifetime receives a new writable cell at reconciliation.
        const cell = k.cell || k.arr
        cell.get = () => previous
        cell.set = () => {}
        k.dispose()
        this.forced = true
      }
    }
    if (this.st$) {
      const v = this.rawState()
      if (v !== this.stLast && v !== undefined) { this.stLast = v; this.st$.shamefullySendNext(v) }
    }
  }
  dispose$() {
    return this.disp$ ||= xs.create()
  }
  childSource() {
    return {
      select: (fn: any) => {
        let f: any
        return xs.create({
          start: (l: any) => { (this.hub ||= new Set()).add(f = (e: any) => e.component === fn && l.next(e.value)) },
          stop: () => { this.hub?.delete(f) },
        })
      },
    }
  }
  setChildren(children: any[]) {
    // G-294: the raw children (before the slots are split out) decide whether the view re-runs
    this.raw = children
    if (children.length) [this.children, this.slots] = extractSlots(children)
    else this.children = children, this.slots = NOSLOTS
  }
  setProps(props: Record<string, any>, children: any[]) {
    this.props = props
    this.setChildren(children)
    this.app.hooks.onPropsChanged?.(viewOf(this), props)
    this.props$?.shamefullySendNext(props)
    this.children$?.shamefullySendNext(this.children)
  }
  /** commands$: the source of the first Command among the props (undefined without one) */
  commands(): any {
    if (this.cmds !== undefined) return this.cmds
    for (const k in this.props) {
      const c = this.props[k]
      if (c && c.__sygnalCommand) {
        c._targetComponentName = this.def.name
        c._targetComponentId = this.id
        return (this.cmds = makeCommandSource(c))
      }
    }
    return (this.cmds = undefined)
  }
  /** a PARENT value from a child: to this instance's CHILD.select listeners */
  toChild(e: any) {
    this.hub?.forEach(f => f(e))
  }

  uid = (n?: string) => (n ? this.uidBase + '-' + n : this.uidBase)

  // ---------------------------------------------------------------- context (D168)
  context(): any {
    const app = this.app
    if (this.cver === app.ver) return this.cv
    const par = this.parent ? this.parent.context() : EMPTY_CTX
    let v = par
    const entries = this.def.context
    if (entries) {
      const s = this.cell.get()
      v = {...par}
      for (const [k, f] of entries) {
        try { v[k] = f(s) } catch (e) {
          logError('SYG404', this, `Context entry '${k}' threw; it keeps its last value`, ERR_FIX, e)
          app.appError(this, e, 'context')
          if (this.cv) v[k] = this.cv[k]
        }
      }
      // the same values: the same object, so readers see no change
      if (this.cv && shallowEq(v, this.cv)) v = this.cv
      else if (this.cv && app.hooks.onContextChanged) app.hooks.onContextChanged(viewOf(this), v, Object.keys(v).filter(k => v[k] !== this.cv[k]))
    }
    this.cver = app.ver
    return (this.cv = v)
  }
  /** a context change touches a key the last view read */
  ctxChanged(ctx: any): boolean {
    const last = this.lctx
    if (ctx === last) return false
    const keys = this.keys
    if (keys) {
      if (keys.has(ALL)) return true
      for (const k of keys) if (ctx[k] !== last[k]) return true
    }
    // D168: skipped. The dev check (onContextSkip) re-runs a sample of these views
    this.app.ctxSkip?.(this, last, ctx)
    this.lctx = ctx
    return false
  }

  /** render again in the next flush though no input changed (a lazy component loaded) */
  refresh() {
    if (this.disposed) return
    this.forced = true
    this.app.commit()
  }

  setReady(r: boolean) {
    if (r !== this.ready) {
      this.ready = r
      if (this.parent) this.app.hooks.onReady?.(viewOf(this.parent), viewOf(this), r)
      this.app.commit()
    }
  }

  // ---------------------------------------------------------------- render
  render(): any {
    if (this.disposed) return this.outv
    const state = this.cell.get(), ctx = this.context()
    let same = false, viewDirty = this.forced || state !== this.ls || !shallowEq(this.props, this.lp) || !sameKids(this.raw, this.lc) || this.ctxChanged(ctx)
    // no state (yet): the view isn't called; it keeps its last render (as today's state stream,
    // which skips undefined). A child with none is left out of its parent's vnode
    if (state === undefined && viewDirty) {
      if (!this.tmpl) return this.outv
      viewDirty = false
    }
    if (viewDirty) {
      const H = this.app.hooks
      if (H.onStateChanged && state !== this.ls && !this.forced) H.onStateChanged(viewOf(this), state)
      this.forced = false
      this.ls = state; this.lp = this.props; this.lc = this.raw; this.lctx = ctx
      const prev = this.tmpl
      this.view(state, ctx)
      dbg(this, () => 'View rendered')
      // P46-P: the same plain output as last time: the last vnode, by identity
      if (prev?.$p && this.tmpl.$p && this.outv && sameTree(prev, this.tmpl)) { this.tmpl = prev; same = this.app.ran = true }
      else this.reconcile()
    }
    // G-311: after a render that threw (the app's epoch moved), the kids are injected again once
    let kidsDirty = this.ep !== this.app.ep
    this.ep = this.app.ep
    for (const k of this.kids.values()) {
      const v = k.render()
      if (v !== k.last || k.ready !== k.lr) { k.last = v; k.lr = k.ready; kidsDirty = true }
    }
    if (!viewDirty && !kidsDirty) return this.outv
    // CV-3: hooks (dev checks, devtools, testing) see a compiled block's vnodes (ext.xb)
    if (same && !kidsDirty) { this.app.hooks.onRender?.(viewOf(this), ext.xb ? ext.xb(this.tmpl) : this.tmpl); return this.outv }
    let v = this.kids.size ? this.inject(this.tmpl, 'r') : this.tmpl
    if (this.postSels) for (const s of this.postSels) v = posts[s](v, this)
    this.app.hooks.onRender?.(viewOf(this), ext.xb ? ext.xb(v) : v)
    return (this.outv = this.parent ? this.app.scopeValue(this.parent, 'DOM', v, this) : v)
  }

  /**
   * G-319 (a hidden Switchable page, or below one): no render, but its Collections follow their
   * arrays, so removed items stop and new ones start (statics, replies) while hidden
   */
  sync() {
    if (!this.disposed) for (const k of this.kids.values()) k.sync?.()
  }

  /** calls the view with one argument (D164); the onError boundary */
  view(state: any, ctx: any) {
    const def = this.def
    let keys: Set<string> | null = null, context = ctx
    if (ctx !== EMPTY_CTX) {
      // (the last render's set, read by ctxChanged before this call)
      keys = this.keys || new Set<string>()
      keys.clear()
      context = new Proxy({c: ctx, k: keys}, TRACK)
    }
    try {
      this.tmpl = def.view({...this.props, state, children: this.children, slots: this.slots, context, uid: this.uid})
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      let out: any = errorDiv(def.name)
      if (def.onError) {
        try {
          out = def.onError(e, {componentName: def.name})
          warn('SYG406', this, 'View threw; rendered the onError fallback', undefined, e)
        } catch (fe) {
          logError('SYG406', this, 'View threw; rendering the error fallback', undefined, e)
          logError('SYG407', this, 'onError threw; rendering an empty error <div>', 'Make onError return a vnode', fe)
        }
      } else logError('SYG406', this, 'View threw; rendering the error fallback', 'Add .onError for a custom fallback', e)
      this.app.appError(this, e, 'view')
      this.tmpl = out
    }
    const t = this.tmpl
    // G-567: a view that returns a string or a number renders it as text (as renderToString)
    if (typeof t == 'string' || typeof t == 'number') this.tmpl = {text: '' + t}
    else if (!t) this.tmpl = {sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
    this.keys = keys
  }

  /** the components in the template, by id: kept (new props), created, or disposed */
  reconcile() {
    const seen = new Set<string>()
    let ps: string[] | null = null
    const walk = (n: any, path: string, parent: any, idx: number): void => {
      if (!n || n.$p) return
      const sel = n.sel
      // a fragment (no sel): its children are walked in place (G-256)
      if (sel && pres[sel]) {
        const r = pres[sel](n, this, path)
        if (r === n) return
        if (parent) (parent.children = parent.children.slice())[idx] = r
        else this.tmpl = r
        return walk(r, path, parent, idx)
      }
      const data = n.data, host = sel && hosts[sel]
      if (data?.c || host) {
        const id = idOf(n, path)
        seen.add(id)
        const props = propsOf(data.props), children = n.children || (n.text != null ? [{text: n.text}] : [])
        let view = data.c
        if (view) for (const r of resolvers) view = r(view, this) || view
        let k = this.kids.get(id)
        // Collection and VirtualCollection share an array cell; Switchable binds `state`.
        const binding = host && sel != 'switchable' ? 'from' : 'state'
        if (k && (k.disposed || (view && k.def && k.def.view !== view) || bindingChanged(k.props?.[binding], props[binding]))) { k.dispose(); this.kids.delete(id); k = undefined }
        if (k) k.setProps(props, children, n, id)
        else (this.kids === NOKIDS ? this.kids = new Map() : this.kids).set(id, k = host ? this.host(host, props, children, id, n) : this.child(view, props, children, id, !!data.props?.resetState))
        if (known(props[binding])) watch(this, k)
        return
      }
      if (posts[sel] && !(ps ||= []).includes(sel)) ps.push(sel)
      const c = n.children
      if (c) for (let i = 0; i < c.length; i++) walk(c[i], path + '.' + i, n, i)
    }
    walk(this.tmpl, 'r', null, 0)
    this.postSels = ps
    if (this.kids.size > seen.size) for (const [id, k] of this.kids) if (!seen.has(id)) { k.dispose(); this.kids.delete(id) }
  }

  /** a host (Collection, Switchable); one that throws renders the owner's error fallback (SYG408) */
  host(make: any, props: Record<string, any>, children: any[], id: string, n: any): any {
    try { return make(this, props, children, id, n) } catch (err) { return this.failed(err, props) }
  }

  /** the owner's error fallback for a child that failed to instantiate (SYG408) */
  failed(err: any, props?: any): Failed {
    const e = err instanceof Error ? err : new Error(String(err))
    let out: any = errorDiv(this.def.name)
    if (this.def.onError) {
      try { out = this.def.onError(e, {componentName: this.def.name}) || out }
      catch (fe) { logError('SYG407', this, 'onError threw; rendering an empty error <div>', 'Make onError return a vnode', fe) }
    }
    this.app.caught(this, 'SYG408', 'Sub-component threw; rendering the error fallback', e, 'instantiate')
    return new Failed(out, props)
  }

  /** a tag child: state="key" | state={lens} | none (the parent's state) | isolatedState (D174: `resetState`) */
  child(view: any, props: Record<string, any>, children: any[], id: string, reset = false): any {
    const app = this.app
    try {
      const def = app.def(view)
      const st = props.state, calcOf = this.def.calcNames
      if (def.initialState && !def.isolated) {
        fail('SYG405', def.name, 'Sub-component initialState replaces the state its parent passes in', 'Remove initialState, or set isolatedState = true')
      }
      const dflt = def.isolated ? def.initialState : undefined
      const cell = typeof st == 'string' ? keyCell(this.cell, st, calcOf?.has(pathOf(st)[0]) && this.def.name, dflt)
        : st !== undefined ? lensCell(this.cell, st, this.def.name, (e) => app.appError(this, e, 'view'), dflt)
        : def.isolated ? localCell(app, this.cell) : this.cell
      const scope = app.scope()
      return new Inst(app, def, this, cell, this.dom && this.dom.isolateSource(this.dom, scope), props, children, scope,
        this.uid(uidPart(id.replace(/.*::(r\.)?/, ''))), 'child', reset)
    } catch (err) {
      return this.failed(err, props)
    }
  }

  inject(n: any, path: string): any {
    if (!n || n.$p) return n
    if (n.data?.c || (n.sel && hosts[n.sel])) {
      const k = this.kids.get(idOf(n, path))
      return k && (k.ready ? k.outv : notReady(k.outv))
    }
    const c = n.children
    if (!c) return n
    let out: any
    for (let i = 0; i < c.length; i++) {
      const v = this.inject(c[i], path + '.' + i)
      if (v !== c[i]) (out ||= c.slice())[i] = v
    }
    if (!out) return n
    // canvas-three F2: the same children as this node's last injection: its last copy, so snabbdom
    // skips an element (and its hooks: a widget's postpatch) above components that didn't change
    const p = (this.ic ||= new WeakMap()).get(n)
    if (p && p.length == out.length && p.every((x: any, i: number) => x === out[i])) return p.r
    this.ic.set(n, out)
    return out.r = {...n, children: out}
  }

  // ---------------------------------------------------------------- actions
  handle(type: string, data: any, cause: any, src?: string) {
    handle(this, type, data, cause, src)
  }

  // ---------------------------------------------------------------- dispose
  dispose() {
    if (this.disposed) return
    const app = this.app
    if (this.def.handlers.has('DISPOSE')) handle(this, 'DISPOSE', undefined, 'built-in')
    // dispose$: the actions it drives run now, while the instance still exists (as today: a
    // `CLEANUP: dispose$` action's driver sinks go out)
    if (this.disp$) { this.dying = true; try { this.disp$.shamefullySendNext(true) } finally { this.dying = false } }
    this.disposed = true
    app.hooks.onDispose?.(viewOf(this))
    if (this.disp$) this.disp$.shamefullySendComplete()
    // G-144: the replies end now (after DISPOSE and dispose$), so the drivers drop its timers and
    // abort its requests; its statics are no longer recomputed
    if (this.st || this.rep) detach(this)
    this.ac?.abort()
    if (this.timers) { this.timers.forEach(clearTimeout); this.timers = null }
    this.kids.forEach(k => k.dispose())
    this.kids.clear()
    const subs = this.subs
    if (subs.length) tearDown(() => { for (const s of subs) s.unsubscribe() }, app.dq, this)
    this.subs = []
    app.watchers.delete(this)
    this.hub = null
  }
}
