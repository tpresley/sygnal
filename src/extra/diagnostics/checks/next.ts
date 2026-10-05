/**
 * PLAN-4.6 R4: the dev entry's checks on the next component core (src/core/).
 *
 * The next core has no instance to patch and no diagnostics calls of its own: it reads this
 * entry's hooks once per app (`__SYGNAL_DIAGNOSTICS__.nextHooks(api)`, 04-hooks-contract §2.2)
 * and calls them with read-only InstanceViews. This module maps them onto the existing checks:
 *
 * - each instance gets a facade with the fields the checks read from today's instances (name,
 *   view, model, sources, currentState, ...), so the DiagnosticCheck hooks (onIntent, onModel,
 *   onRender, onReducer, onDispose, sources) run unchanged through the core's dispatchers;
 * - what the checks did by patching an instance becomes a hook: SYG222's reducer wrapping
 *   (wrapHandler), the reply / fetch / EVENTS taps of a sink (onSink), the ELEMENT check
 *   (onElementCommand), the Collection check (onHostProps), the action log (actionLog.ts);
 * - the next core's own dev codes: SYG423 (D168: a view context tracking skipped would have
 *   rendered differently), SYG424 (D169/D177: duplicate Collection ids), SYG425 (D174: an
 *   isolatedState child kept a slice that lacks its initialState keys), SYG612 (D173: a form
 *   6.0 removed, met at runtime; once per form and component, with a link to the migration
 *   guide).
 *
 * Only while diagnostics are on (the checks' own rule); production builds never load this.
 */
import {bridge, devReport, reportSafely, once, nameOf, isPlainObject} from './shared'
import {DEV_CODE_SEVERITY} from '../codes'
import {watchMutation} from './state'
import {checkRequest} from './replies'
import {check as checkFetch} from './fetch'
import {checkSentCommand} from './elementCommands'
import {checkCollection} from './collections'
import {eventEmitted, actionListener as recentActions} from './inspect'
import {actionHooks} from './actionLog'

const MIGRATE = 'https://sygnal.js.org/guide/migrating-to-6'

/** the removed forms (D162-D164) by migration-guide anchor: what it was, how to write it now */
export const REMOVED: Record<string, [what: string, fix: string]> = {
  'string-tags': ['a component named by a string tag (<Name /> as a string, looked up in .components)', 'Import the component and use it as a JSX tag: <Badge />'],
  'components': ['the .components registry', 'Import each component and use it as a JSX tag; remove .components'],
  'collection-of-name': ['<Collection of="Name"> (a name)', 'Pass the component itself: <Collection of={Item} from="items" />'],
  'child-select-name': ["CHILD.select('Name') (a name)", 'Pass the component itself: CHILD.select(Item)'],
  'pipe-keys': ["'ACTION | SINK' model keys", "Use the object form: ACTION: { SINK: (state, data) => ... }"],
  'peers': ['.peers', 'Render the peer as a sibling in the parent view'],
  'hmractions': ['hmrActions', 'Remove hmrActions; sygnal/vite keeps the state across a hot update'],
  'positional-views': ['a view with positional parameters (props, state, context, peers)', 'Destructure the one argument: function C({ state, context, ...props })'],
  'source-names': ['DOMSourceName / stateSourceName', "Remove them: the sources are always DOM and STATE"],
  'storecalculatedinstate': ['storeCalculatedInState', 'Remove it: calculated fields are always part of the state the view and reducers get'],
  'component-factory': ['the component({ ... }) factory (with sources / isolateOpts)', 'Write a function component with statics (C.model, C.intent, C.initialState), or use defineComponent({ ... })'],
}

const STATICS: Array<[string, string]> = [['components', 'components'], ['peers', 'peers'], ['hmrActions', 'hmractions'], ['DOMSourceName', 'source-names'], ['stateSourceName', 'source-names'], ['storeCalculatedInState', 'storecalculatedinstate']]

function removed(component: any, name: string, anchor: string, detail?: string): void {
  if (!once(`SYG612:${name}:${anchor}`)) return
  const [what, fix] = REMOVED[anchor]
  devReport('SYG612', {
    component: name,
    message: `${name} uses ${what}${detail ? ` (${detail})` : ''}, which Sygnal 6.0 removed, so it is ignored or fails`,
    fix: `${fix}. See ${MIGRATE}#${anchor}`,
    data: {form: anchor, guide: `${MIGRATE}#${anchor}`, ...(detail ? {detail} : {})},
  })
}

/** the removed forms a definition shows (statics, view arity, model keys), once per function */
const seenDefs = new WeakSet<object>()
function removedStatics(f: any): void {
  const view = f.view
  if (!view || seenDefs.has(view)) return
  seenDefs.add(view)
  const name = f.name
  if (view.isSygnalComponent) removed(f, name, 'component-factory')
  for (const [k, anchor] of STATICS) if (view[k] !== undefined && !(k == 'components' && isPlainObject(view[k]) && !Object.keys(view[k]).length)) removed(f, name, anchor, k)
  if (typeof view == 'function' && view.length > 1 && !view.__sygnalLazy && !view.isSygnalComponent) removed(f, name, 'positional-views', `${view.length} parameters`)
  const model = view.model
  if (isPlainObject(model)) for (const k of Object.keys(model)) if (k.includes('|')) removed(f, name, 'pipe-keys', `'${k}'`)
}

/** string tags and component() factories left in a rendered vnode (the next core renders them as elements) */
function removedTags(f: any, v: any, depth = 0): void {
  if (!v || typeof v != 'object' || depth > 300) return
  const sel = v.sel
  if (typeof sel == 'string' && /^[A-Z]/.test(sel) && !(v.data && v.data.c)) {
    if (v.data && v.data.props && v.data.props.sygnalFactory) removed(f, f.name, 'component-factory', `<${sel}>`)
    else removed(f, f.name, 'string-tags', `<${sel}>`)
  }
  const kids = v.children
  if (Array.isArray(kids)) for (const k of kids) removedTags(f, k, depth + 1)
}

/** the instance fields the checks read from today's Component instances */
class Facade {
  _so: any
  constructor(public __next: any) {}
  get name() { return this.__next.name }
  get view() { return this.__next.def.view }
  get model() {
    const m: Record<string, any> = {}
    this.__next.def.handlers.forEach((hs: any[], a: string) => { const e: any = m[a] = {}; for (const [s, fn] of hs) e[s] = fn })
    return m
  }
  get modelMap(): Record<string, string[]> {
    const m: Record<string, string[]> = {}
    this.__next.def.handlers.forEach((hs: any[], a: string) => { m[a] = hs.map(h => h[0]) })
    // the built-in INITIALIZE (today's model map ends with it for every component)
    if (!m.INITIALIZE) m.INITIALIZE = ['STATE']
    return m
  }
  get sources() { return this._so || this.__next.sources }
  get sourceNames() { return Object.keys(this.__next.sources) }
  get stateSourceName() { return 'STATE' }
  get DOMSourceName() { return 'DOM' }
  get isSubComponent() { return !this.__next.isRoot }
  get initialState() { return this.__next.def.initialState }
  get currentState() { return this.__next.state }
  get currentProps() { return this.__next.props }
  get currentContext() { return this.__next.context }
  get _componentNumber() { return this.__next.id }
  get calculated() { return this.__next.def.view.calculated }
  get _calculatedFieldNames() { return this.__next.def.calcNames }
  get context() { return this.__next.def.view.context }
  get _uses() { return Object.entries(this.__next.def.view.uses || {}) }
  get _behaviorActions() { return this.__next.def.behaviorActions }
  get intent$() { return {__sygnalTestActions: this.__next.def.testActions || []} }
  get _disposed() { return this.__next.disposed }
  /** the state already has its calculated fields */
  addCalculated(s: any) { return s }
}

const facades = new WeakMap<object, Facade>()
const fac = (iv: any): Facade => {
  let f = facades.get(iv)
  if (!f) facades.set(iv, f = new Facade(iv))
  return f
}

/** structural vnode equality (functions equal: a view may make new closures every call) */
function same(a: any, b: any, d = 0): boolean {
  if (a === b || (typeof a == 'function' && typeof b == 'function')) return true
  if (!a || !b || typeof a != 'object' || typeof b != 'object') return a !== a && b !== b
  if (d > 300) return true
  if (Array.isArray(a) != Array.isArray(b)) return false
  const ka = Object.keys(a).filter(k => k != 'elm' && a[k] !== undefined), kb = Object.keys(b).filter(k => k != 'elm' && b[k] !== undefined)
  if (ka.length != kb.length) return false
  for (const k of ka) if (!same(a[k], b[k], d + 1)) return false
  return true
}

const SAMPLE = 16, CAP = 20

/** The hooks one app on the next core gets (installChecks publishes this on the bridge). */
export function nextHooks(_api: any): any {
  const core = bridge(), H = core.hooks
  const on = () => H.on()
  const modelOf = (f: Facade) => f.modelMap
  const wired = new WeakSet<object>()
  const wire = (iv: any, names: string[]) => {
    const f = fac(iv)
    if (wired.has(f)) return
    wired.add(f)
    H.onIntent(f, names)
    H.onModel(f, modelOf(f))
  }
  // D168: the views context tracking skipped, checked on a sample (each instance's first two
  // skips, then 1 in 16; at most CAP per tick)
  const skips = new WeakMap<object, number>()
  let budget = 0
  const log = actionHooks(recentActions, () => on())
  return {
    onCreate(iv: any) {
      if (!on()) return
      log.onCreate(iv)
      const f = fac(iv)
      removedStatics(f)
      if (!iv.def.intent) wire(iv, [])
    },
    wrapSources(iv: any, so: any) {
      const f = fac(iv)
      f._so = so
      let out
      try { out = H.sourcesFor(f) } finally { f._so = undefined }
      if (!on() || typeof Proxy != 'function') return out
      // D173: CHILD.select('Name')
      const s = out || so
      return new Proxy(s, {
        get(t: any, k: any) {
          const v = t[k]
          if (k !== 'CHILD' || !v || typeof v.select != 'function') return v
          return {...v, select: (x: any, ...r: any[]) => { if (typeof x == 'string') removed(f, f.name, 'child-select-name', `CHILD.select('${x}')`); return v.select(x, ...r) }}
        },
      })
    },
    onIntent(iv: any, names: string[]) {
      wire(iv, names)
    },
    onRender(iv: any, vnode: any) {
      const f = fac(iv)
      H.onRender(f, vnode)
      if (on()) removedTags(f, vnode)
    },
    onReducer(iv: any, type: string, prev: any, next: any) {
      H.onReducer(fac(iv), type, prev, next, 'STATE')
    },
    onDispose(iv: any) {
      H.onDispose(fac(iv))
    },
    onAction(iv: any, a: any) { log.onAction(iv, a) },
    wrapHandler(iv: any, type: string, sink: string, fn: any) {
      let h = log.wrapHandler(iv, type, sink, fn) || fn
      // SYG222: the STATE reducers, wrapped (today the check rewrote the instance's model)
      if (on() && sink == 'STATE' && typeof fn == 'function') h = watchMutation(fac(iv), type, h)
      return h === fn ? undefined : h
    },
    onSink(iv: any, type: string | null, sink: string, v: any) {
      if (!on()) return
      const f = fac(iv), src = iv.sources[sink]
      try {
        if (sink == 'EVENTS') eventEmitted(f, v)
        if (src && src.__sygnalReplies === true) checkRequest(f, sink, v, Object.keys(f.modelMap))
        if (src && src.__sygnalStatic === 'resources') checkFetch(f, sink, v)
      } catch (_) { /* a check never breaks the app */ }
    },
    onElementCommand(iv: any, cmd: any) {
      if (!on()) return
      const f = fac(iv)
      for (const c of ([] as any[]).concat(cmd)) checkSentCommand(f, c)
    },
    onHostProps(owner: any, sel: string, props: any) {
      if (!on() || sel != 'collection') return
      const f = fac(owner)
      if (typeof props.of == 'string') removed(f, f.name, 'collection-of-name', `of="${props.of}"`)
      try { checkCollection(f, {data: {props}}) } catch (_) { /* ignore */ }
    },
    onDuplicateKey(owner: any, key: any) {
      if (!on()) return
      const name = owner.name
      if (!once(`SYG424:${name}:${String(key)}`)) return
      devReport('SYG424', {
        component: name,
        message: `A Collection in ${name} has more than one item with the id ${JSON.stringify(key) ?? String(key)} (duplicate ids); only the first of them renders, and their writes go to it`,
        fix: 'Give every item a unique id (or no id: an item without one is keyed by its index)',
        data: {id: key},
      })
    },
    onStateSeed(iv: any, slice: any, init: any) {
      if (!on() || !isPlainObject(init) || !isPlainObject(slice)) return
      const missing = Object.keys(init).filter(k => !(k in slice))
      const name = iv.name
      if (!missing.length || !once(`SYG425:${name}:${missing.join(',')}`)) return
      const list = missing.map(k => `'${k}'`).join(', ')
      devReport('SYG425', {
        component: name,
        message: `${name} has isolatedState and is bound to a slice of its parent's state that already exists, so it keeps that slice instead of its initialState; the slice has no ${list}, which ${name}.initialState defines`,
        fix: `To start ${name} from its initialState instead, add resetState to the tag (<${name} state="..." resetState />). To keep the parent's data, initialize ${list} in the parent's state`,
        data: {missing, slice: Object.keys(slice)},
      })
    },
    onContextSkip(iv: any, render: (c: any) => any, prev: any, next: any, keys: string[]) {
      if (!on() || !prev || !next) return
      const n = (skips.get(iv) || 0) + 1
      skips.set(iv, n)
      if ((n > 2 && n % SAMPLE) || budget >= CAP) return
      if (!budget++) queueMicrotask(() => { budget = 0 })
      let a, b
      try { a = render(prev); b = render(next) } catch (_) { return }
      if (same(a, b)) return
      const name = iv.name
      const changed = Object.keys(next).filter(k => next[k] !== prev[k])
      if (!once(`SYG423:${name}`)) return
      reportSafely('SYG423', {
        severity: DEV_CODE_SEVERITY.SYG423,
        component: name,
        message: `The context keys ${changed.map(k => `'${k}'`).join(', ')} changed and ${name}'s view was not re-rendered, because the view read none of them during its last call (it read: ${keys.length ? keys.map(k => `'${k}'`).join(', ') : 'nothing'}). Calling it with the new context renders something else, so the page shows a stale render`,
        fix: `Read context entries in the view itself (context.theme), not through a value kept from an earlier render or a function that runs later; Object.getOwnPropertyDescriptor and similar reflection aren't tracked`,
        data: {keysRead: keys, changed},
      })
    },
  }
}
