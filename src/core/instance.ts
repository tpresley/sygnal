/**
 * PLAN-4.6 next core: a component instance (03-proposal §5).
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
import {uidPart} from '../shared'
import {warn, error as logError, fail} from '../extra/diagnostics/legacy'
import type {App} from './runtime'
import {tearDown, INST, SEED} from './teardown'
import {CoreDef, defOf, isObj} from './define'
import {Cell, CalcCell, calcCell, keyCell, lensCell, localCell} from './cell'
import {hosts, posts, pres, resolvers} from './registry'
import {handle} from './actions'
import {viewOf} from './view'
import {makeCommandSource} from '../extra/command'

const ERR_FIX = 'See the attached error'

const notReady = (v: any) => (v && v.sel ? {...v, data: {...v.data, attrs: {...v.data?.attrs, 'data-sygnal-ready': 'false'}}} : v)
const errorDiv = (name: string) => ({sel: 'div', data: {attrs: {'data-sygnal-error': name}}, children: [], text: undefined, elm: undefined, key: undefined})

/** <Slot name="x"> children -> slots.x; the rest -> slots.default and `children` */
function extractSlots(children: any[]): [any[], Record<string, any[]>] {
  const slots: Record<string, any[]> = {}, rest: any[] = []
  for (const c of children) {
    if (c && c.sel === 'slot') {
      const k = c.children
      ;(slots[c.data?.props?.name || 'default'] ||= []).push(...(Array.isArray(k) ? k : k ? [k] : []))
    } else rest.push(c)
  }
  if (rest.length) (slots.default ||= []).push(...rest)
  return [slots.default || [], slots]
}

/** an instance's id among its parent's children: its `id` prop, else its path in the view */
const idOf = (n: any, path: string) => {
  const id = n.data?.props?.id
  let s: any
  // (G-298: an id JSON can't encode, a BigInt, is used as its string)
  if (id) try { s = JSON.stringify(id) } catch (_) { s = String(id) }
  return `${n.sel}::${(s && s.replace(/"/g, '')) || path}`
}

/**
 * a component vnode's props, without what the pragma adds for the current core (until R5) and
 * without `resetState` (D174: read at creation, like `state`, never a prop of the child)
 */
function propsOf(p: any) {
  if (!p) return {}
  if (!('sygnalOptions' in p || 'sygnalFactory' in p || 'resetState' in p)) return p
  const {sygnalOptions, sygnalFactory, resetState, ...rest} = p
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

const EMPTY_CTX: any = Object.freeze({})
/** a view read every key (spread, Object.keys): any context change re-renders it */
const ALL = '\u0000all'

let IDS = 0

/** a child that failed to instantiate: renders the owner's error fallback (SYG408) */
class Failed {
  last: any; lr = true; ready = true; def: any = null; disposed = false; shown = true
  constructor(public outv: any) {}
  render() { return this.outv }
  setProps() {}
  dispose() {}
}

export class Inst {
  readonly id = IDS++
  disposed = false
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
  slots: Record<string, any[]> = {}
  kids = new Map<string, any>()
  uidBase: string
  /** the parent's view of this instance's output (last vnode / READY it injected) */
  last: any; lr = true
  outv: any
  // the last render's inputs: state, props, children, context, the context keys its view read
  ls: any = {}; lp: any; lc: any; lctx: any; keys: Set<string> | null = null; tmpl: any; forced = true
  postSels: string[] | null = null
  // context memo: the app's write version it was computed at, the value
  cver = -1; cv: any
  subs: any[] = []
  srcs: Record<string, any> | null = null
  fb: Record<string, any> | null = null
  ac: AbortController | null = null
  disp$: any
  st$: any; stLast: any; stateSrc: any
  props$: any; children$: any
  /** CHILD.select listeners (the children's PARENT values) */
  hub: Set<(e: any) => void> | null = null
  wd: any; so: any; el: any
  iv: any
  cmds: any
  /** pending next() timers (G-300) */
  timers: Set<any> | null = null

  constructor(
    public app: App, public def: CoreDef, public parent: Inst | null, base: Cell,
    public dom: any, props: Record<string, any>, children: any[], public scope: string | undefined,
    uidBase: string, public kind: 'root' | 'child' | 'item' | 'page' = parent ? 'child' : 'root', reset = false,
  ) {
    this.props = props
    this.setChildren(children)
    this.uidBase = uidBase
    this.ready = !def.ready
    this.cell = def.calculated || def.idle ? calcCell(base, def) : {get: () => base.get(), set: (v) => base.set(v), raw: () => base.get()}
    const H = app.hooks
    // the initial state, synchronously (INITIALIZE at construction, D165): a root (or the state an
    // HMR swap keeps), an isolated child's local state. D174: an isolated child bound to a slice
    // (state="key" or a lens) seeds it with initialState only while it is undefined (with a model,
    // as today's INITIALIZE; without one it reads initialState while the slice is missing), and
    // `resetState` replaces it at creation; an existing slice is kept (onStateSeed: R4's warning)
    let init = !parent && app.initState !== undefined ? app.initState : def.initialState
    // a root without a model renders from `initialState || true` (G-172, as today)
    if (!parent && !def.model && !init) init = true
    if (init !== undefined) {
      if (!parent || (def.isolated && (base as any).local)) this.cell.set(init)
      else if (def.isolated) {
        const b: any = base, has = b.has ? b.has() : b.get() !== undefined
        // the parent's slice is written as a queued action (before INITIALIZE), so a child that
        // fails to start (G-295) never touches it: the drain skips a disposed instance
        if (reset || (!has && def.model)) app.dispatch(this, SEED, init, 'built-in')
        else if (has) H.onStateSeed?.(viewOf(this), b.get(), init)
      }
    } else if (def.idle && isObj(this.cell.raw()) && !parent) this.cell.set(this.cell.raw())
    H.onCreate?.(viewOf(this))
    if (def.handlers.has('INITIALIZE')) app.dispatch(this, 'INITIALIZE', init, 'built-in')
    if (def.intent) {
      try { this.subscribe() } catch (e) {
        // G-295: undone (its queued actions are skipped, no STATE watcher, onDispose pairs onCreate)
        this.disposed = true
        app.watchers.delete(this)
        H.onDispose?.(viewOf(this))
        throw e
      }
    }
    if (def.handlers.has('BOOTSTRAP')) app.born.push(this)
  }

  get name() { return this.def.name }

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
      if (!isObj(actions)) fail('SYG603', this, 'intent must return an object of streams', 'Return { ACTION: stream$ }')
      H.onIntent?.(viewOf(this), Object.keys(actions))
      for (const type in actions) {
        const s = actions[type]
        if (s == null) continue
        if (typeof s.subscribe != 'function') fail('SYG603', this, `intent entry '${type}' is not a stream`, 'Return { ACTION: stream$ }')
        this.subs.push(s.subscribe({
          next: (d: any) => this.dying ? handle(this, type, d, 'intent') : app.dispatch(this, type, d, 'intent'),
          // (no code of its own yet: R4's diagnostics may add one)
          error: (e: any) => { console.error(`[Sygnal] ${def.name}: intent stream '${type}' errored; it stops emitting`, e); app.appError(this, e, 'intent', type) },
        }))
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
    if (this.so) return this.so
    const so = this.so = Object.defineProperties({}, this.app.srcDesc(!!this.parent))
    Object.defineProperty(so, INST, {value: this})
    return so
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
    const v = this.stLast = this.cell.raw()
    if (v !== undefined) this.st$.shamefullySendNext(v)
    this.app.watchers.add(this)
    return (this.stateSrc = new StateSource(this.st$, 'STATE', this.dispose$(), 1))
  }
  /** called after each action and before each render pass: STATE.stream emits a new state */
  notify() {
    const v = this.cell.raw()
    if (v !== this.stLast && v !== undefined) { this.stLast = v; this.st$.shamefullySendNext(v) }
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
    const [kids, slots] = children.length ? extractSlots(children) : [children, {}]
    this.children = kids
    this.slots = slots
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
    // D168: skipped. R4's dev check re-runs a sample of these views (app.ctxSkip)
    this.app.ctxSkip?.(this)
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
    let viewDirty = this.forced || state !== this.ls || !shallowEq(this.props, this.lp) || !sameKids(this.raw, this.lc) || this.ctxChanged(ctx)
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
      this.view(state, ctx)
      this.reconcile()
    }
    let kidsDirty = false
    for (const k of this.kids.values()) {
      const v = k.render()
      if (v !== k.last || k.ready !== k.lr) { k.last = v; k.lr = k.ready; kidsDirty = true }
    }
    if (!viewDirty && !kidsDirty) return this.outv
    let v = this.kids.size ? this.inject(this.tmpl, 'r') : this.tmpl
    if (this.postSels) for (const s of this.postSels) v = posts[s](v, this)
    this.app.hooks.onRender?.(viewOf(this), v)
    return (this.outv = this.parent ? this.app.scopeValue(this.parent, 'DOM', v, this) : v)
  }

  /** calls the view with one argument (D164); the onError boundary */
  view(state: any, ctx: any) {
    const def = this.def
    let keys: Set<string> | null = null, context = ctx
    if (ctx !== EMPTY_CTX) {
      const ks = keys = new Set<string>()
      context = new Proxy(ctx, {
        get: (t, k) => (typeof k == 'string' && ks.add(k), t[k as any]),
        has: (t, k) => (typeof k == 'string' && ks.add(k), k in t),
        ownKeys: (t) => (ks.add(ALL), Reflect.ownKeys(t)),
      })
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
    if (!this.tmpl) this.tmpl = {sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
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
        const r = pres[sel](n, this)
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
        if (k && view && k.def && k.def.view !== view) { k.dispose(); this.kids.delete(id); k = undefined }
        if (k) k.setProps(props, children, n, id)
        else this.kids.set(id, host ? this.host(host, props, children, id, n) : this.child(view, props, children, id, !!data.props?.resetState))
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
    try { return make(this, props, children, id, n) } catch (err) { return this.failed(err) }
  }

  /** the owner's error fallback for a child that failed to instantiate (SYG408) */
  failed(err: any): Failed {
    const e = err instanceof Error ? err : new Error(String(err))
    let out: any = errorDiv(this.def.name)
    if (this.def.onError) {
      try { out = this.def.onError(e, {componentName: this.def.name}) || out }
      catch (fe) { logError('SYG407', this, 'onError threw; rendering an empty error <div>', 'Make onError return a vnode', fe) }
    }
    this.app.caught(this, 'SYG408', 'Sub-component threw; rendering the error fallback', e, 'instantiate')
    return new Failed(out)
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
      const cell = typeof st == 'string' ? keyCell(this.cell, st, calcOf?.has(st) && this.def.name, dflt)
        : st !== undefined ? lensCell(this.cell, st, this.def.name, (e) => app.appError(this, e, 'view'))
        : def.isolated ? localCell(app, this.cell) : this.cell
      const scope = app.scope()
      return new Inst(app, def, this, cell, this.dom && this.dom.isolateSource(this.dom, scope), props, children, scope,
        this.uid(uidPart(id.replace(/.*::(r\.)?/, ''))), 'child', reset)
    } catch (err) {
      return this.failed(err)
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
    return out ? {...n, children: out} : n
  }

  // ---------------------------------------------------------------- actions
  handle(type: string, data: any, cause: any) {
    handle(this, type, data, cause)
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
    this.ac?.abort()
    if (this.timers) { this.timers.forEach(clearTimeout); this.timers = null }
    this.kids.forEach(k => k.dispose())
    this.kids.clear()
    const subs = this.subs
    if (subs.length) tearDown(() => { for (const s of subs) s.unsubscribe() }, app.dq)
    this.subs = []
    if (this.st$) app.watchers.delete(this)
    this.hub = null
  }
}
