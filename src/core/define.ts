/**
 * PLAN-4.6 next core: definitions, normalized once per component function (03-proposal §1.4).
 *
 * defOf(view) reads the component's statics into a DefSource, runs the definition hooks on it
 * (registry.defHooks, then an app's transformDef), and normalizes it into a Def:
 * - model -> Map<action, [sink, handler][]> in model order (a function entry is STATE); the sinks
 *   used; INITIALIZE keeps only STATE (SYG210)
 * - calculated: fn | [deps, fn], Kahn order; SYG206 (invalid entry) and SYG209 (cycle, with its
 *   path) are thrown here; SYG207 / SYG208 warn
 * - context entries (functions of the state; anything else is SYG403 and skipped)
 * - isolatedState, READY presence, onError, name
 *
 * The removed forms (D162-D164: 'A | S' keys, string/true context entries, `.components`, ...)
 * are not read. The cache is a WeakMap per function; an app with its own transformDef keeps its
 * own cache (the hook is per app).
 */
import type {ComponentFn, Def, DefSource, Handler} from './hooks'
import {defHooks} from './registry'
import {fail, warn, error as logError} from '../extra/diagnostics/legacy'

export type Calc = [field: string, fn: (s: any) => any, deps: string[] | null]

export interface CoreDef extends Def {
  readonly handlers: Map<string, Handler[]>
  readonly sinks: Set<string>
  readonly calculated: Calc[] | null
  /** the calculated field names (a child bound to one can't write it: SYG409) */
  readonly calcNames: Set<string> | null
  /** the model has a READY entry: the instance starts not ready */
  readonly ready: boolean
  /** the definition has a model (a root without one renders from `initialState || true`) */
  readonly model: boolean
}

export const isObj = (o: any): o is Record<string, any> => o !== null && typeof o == 'object' && !Array.isArray(o)

/** a component function's name (the removed `.label` is not read, D164) */
export const nameOf = (view: any): string => view.componentName || view.name || 'FUNCTION_COMPONENT'

function normCalc(name: string, calculated: any, initialState: any): [Calc[], Set<string>] | null {
  if (!calculated) return null
  if (!isObj(calculated)) fail('SYG606', name, 'calculated must be an object', 'Use calculated = { field: state => value }')
  const norm: Record<string, [any, string[] | null]> = {}
  for (const f in calculated) {
    const e = calculated[f]
    if (typeof e == 'function') norm[f] = [e, null]
    else if (Array.isArray(e) && e.length == 2 && Array.isArray(e[0]) && typeof e[1] == 'function') norm[f] = [e[1], e[0]]
    else fail('SYG206', name, `Invalid calculated field '${f}'`, 'Use fn or [deps, fn]')
    if (isObj(initialState) && f in initialState) warn('SYG207', name, `Calculated field '${f}' overwrites the initialState key of the same name`, 'Rename one of them')
  }
  const names = new Set(Object.keys(norm))
  // Kahn: per field the calculated fields it waits for, and its dependents
  const deps: Record<string, string[]> = {}, waiting: Record<string, number> = {}, dependents: Record<string, string[]> = {}
  for (const f of names) {
    for (const d of norm[f][1] || []) {
      if (!names.has(d) && initialState && !(d in initialState)) warn('SYG208', name, `Calculated field '${f}' depends on unknown key '${d}'`, 'Add it to initialState')
    }
    const d = deps[f] = (norm[f][1] || []).filter(x => names.has(x))
    waiting[f] = d.length
    dependents[f] ||= []
    for (const x of d) (dependents[x] ||= []).push(f)
  }
  const sorted = [...names].filter(f => !waiting[f])
  for (let i = 0; i < sorted.length; i++) for (const d of dependents[sorted[i]]) if (!--waiting[d]) sorted.push(d)
  if (sorted.length != names.size) {
    const inCycle = [...names].filter(f => !sorted.includes(f)), path: string[] = []
    const trace = (n: string): boolean => {
      if (path.includes(n)) return path.push(n), true
      path.push(n)
      if (deps[n].some(d => inCycle.includes(d) && trace(d))) return true
      path.pop()
      return false
    }
    trace(inCycle[0])
    const start = path[path.length - 1]
    fail('SYG209', name, `Circular calculated dependency: ${path.slice(path.indexOf(start)).join(' → ')}`, 'Break the cycle')
  }
  return [sorted.map(f => [f, norm[f][0], norm[f][1]] as Calc), names]
}

/** the statics a definition hook may edit, read from the component function */
export const sourceOf = (view: ComponentFn): DefSource => ({
  model: view.model, intent: view.intent, initialState: view.initialState, idle: null,
  calculated: view.calculated, context: view.context, behaviorActions: {},
})

/**
 * The definition shim (spike finding 5): the instance fields a behavior's existing
 * `merge(component, key)` reads and writes, so behaviors / undo / selection run unchanged, once
 * per function. `isSubComponent: true` sends a slice to `_idle` (the defaults a bound
 * sub-component reads until it writes them); an `isolatedState` definition gets it in its
 * initialState, as today. A root gets the slices in its initialState (rootDef). fromShim()
 * reads the result back.
 */
export const shimOf = (src: DefSource, view: ComponentFn): any => ({
  model: src.model, intent: src.intent, initialState: src.initialState, view, name: nameOf(view),
  stateSourceName: 'STATE', isSubComponent: true, isolatedState: !!view.isolatedState, _idle: src.idle, _behaviorActions: src.behaviorActions,
})
export const fromShim = (shim: any, src: DefSource): DefSource => ({
  ...src, model: shim.model, intent: shim.intent, initialState: shim.initialState,
  idle: shim._idle, behaviorActions: shim._behaviorActions || src.behaviorActions,
})

/** the built-in RESOURCE reducer (a model RESOURCE entry replaces it) */
const RESOURCE = (s: any, {name, ...r}: any) => ({...s, [name]: r})

/**
 * The definition-time built-ins, in today's order (component.ts:363-376): `resources` (PLAN-3
 * 3-A: the RESOURCE entry first in the model; each resource reads `{ status: 'idle' }` until
 * written), then `uses` (GS-1: each behavior's own merge() on the shim, D114; the core only
 * loops over `uses`).
 */
function builtIns(src: DefSource, view: ComponentFn): DefSource {
  const res = view.resources
  if (res) {
    const idle: Record<string, any> = {...src.idle}
    for (const k in res) idle[k] = {status: 'idle'}
    src = {...src, model: {RESOURCE, ...src.model}, idle}
  }
  const uses = view.uses
  if (uses) {
    const shim = shimOf(src, view)
    for (const k in uses) uses[k]?.merge?.(shim, k)
    src = fromShim(shim, src)
  }
  return src
}

export function normalize(view: ComponentFn, src: DefSource): CoreDef {
  const name = nameOf(view)
  const handlers = new Map<string, Handler[]>(), sinks = new Set<string>()
  const model = src.model
  for (const key in model || {}) {
    let e = model![key]
    if (typeof e == 'function') e = {STATE: e}
    else if (!isObj(e)) fail('SYG212', name, `Model entry '${key}' must be a function or an object`, 'Use { STATE: reducer }')
    if (key == 'INITIALIZE') {
      for (const s in e) if (s != 'STATE') warn('SYG210', name, `INITIALIZE only supports the STATE sink; ignoring '${s}'`, 'Use another action')
      if (!('STATE' in e)) continue
      e = {STATE: e.STATE}
    }
    const list: Handler[] = []
    for (const sink in e) list.push([sink, e[sink]]), sinks.add(sink)
    handlers.set(key, list)
  }
  const c = normCalc(name, src.calculated, src.initialState)
  let context: Array<[string, (s: any) => any]> | null = null
  if (src.context !== undefined && src.context !== null) {
    if (!isObj(src.context)) logError('SYG402', name, `context must be an object, got ${typeof src.context}; ignoring it`, 'Use context = { name: state => value }')
    else {
      context = []
      for (const k in src.context) {
        const f = src.context[k]
        if (typeof f == 'function') context.push([k, f])
        else logError('SYG403', name, `Invalid context entry '${k}'; skipping it`, 'Use a state key or state => value')
      }
    }
  }
  const intent = src.intent
  if (intent !== undefined && typeof intent != 'function') fail('SYG602', name, 'intent must be a function', 'Use intent = sources => ({ ACTION: stream$ })')
  return {
    name, view, intent, handlers, sinks,
    initialState: src.initialState,
    idle: src.idle,
    isolated: !!view.isolatedState,
    calculated: c && c[0], calcNames: c && c[1],
    context: context && context.length ? context : null,
    statics: [],
    behaviorActions: src.behaviorActions,
    ready: sinks.has('READY'),
    model: model !== undefined,
    onError: typeof view.onError == 'function' ? view.onError : undefined,
  }
}

const defs = new WeakMap<ComponentFn, CoreDef>()
/** the statics a Def was made from: a later assignment (a test, a hot edit) makes a new Def */
const KEYS = ['model', 'intent', 'initialState', 'calculated', 'context', 'isolatedState', 'onError', 'componentName', 'uses', 'resources']
const read = new WeakMap<CoreDef, any[]>()
const stale = (d: CoreDef, view: any) => {
  const r = read.get(d)!
  for (let i = 0; i < KEYS.length; i++) if (r[i] !== view[KEYS[i]]) return true
  return false
}

/**
 * The Def of a component function. `transform`: an app's own transformDef (its Defs are cached
 * in `cache`, not shared); `override`: renderComponent's root (test intent, initial state, name),
 * normalized uncached.
 */
export function defOf(view: ComponentFn, transform?: (src: DefSource, view: ComponentFn) => DefSource | void, cache?: WeakMap<ComponentFn, CoreDef>, override?: Partial<DefSource> & {name?: string}): CoreDef {
  const store = transform ? cache! : defs
  let d = override ? undefined : store.get(view)
  if (d && !stale(d, view)) return d
  const r = KEYS.map(k => view[k])
  d = normalize(view, pipeline(view, transform, override))
  if (override?.name) (d as any).name = override.name
  if (!override) store.set(view, d), read.set(d, r)
  return d
}

type Transform = ((src: DefSource, view: ComponentFn) => DefSource | void) | undefined

/** the statics, through the built-ins, a root's own steps, the definition hooks and the app's transformDef */
function pipeline(view: ComponentFn, transform: Transform, override?: Partial<DefSource> & {name?: string}, root?: (src: DefSource) => DefSource): DefSource {
  let src = sourceOf(view)
  if (override) src = {...src, ...override}
  // G-172: a root without a model renders from `initialState || true`, decided before the
  // built-ins add a model (as today, component.ts:356)
  if (root && src.model === undefined && !src.initialState) src = {...src, initialState: true}
  src = builtIns(src, view)
  if (root) src = root(src)
  for (const h of defHooks) src = h(src, view) || src
  if (transform) src = transform(src, view) || src
  return src
}

/**
 * An app's root Def (uncached; renderComponent's `override` too). As defOf, plus the root-only
 * steps of today's constructor: a behavior's slice is part of the root's initialState
 * (behaviors.ts's root merge: the slice wins over an initialState key of its name), then
 * `setup(src)`: persist's root setup (it may restore into the initialState and rewrites the
 * model; persist.ts, root only as today, component.ts:378).
 */
export function rootDef(view: ComponentFn, transform: Transform, override?: Partial<DefSource> & {name?: string; testActions?: string[]}, setup?: (src: DefSource) => DefSource): CoreDef {
  const d = normalize(view, pipeline(view, transform, override, (src) => {
    const uses = view.uses, idle = src.idle
    if (uses && idle) {
      const sl: Record<string, any> = {}
      for (const k in uses) if (k in idle) sl[k] = idle[k]
      src = {...src, initialState: {...(isObj(src.initialState) ? src.initialState : {}), ...sl}}
    }
    return setup ? setup(src) : src
  }))
  if (override?.name) (d as any).name = override.name
  if (override?.testActions) (d as any).testActions = override.testActions
  return d
}
