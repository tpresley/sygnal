/**
 * Definitions, normalized once per component function (WeakMap), spike 0-S.
 *
 * - model -> Map<action, [sink, handler][]> (a function entry is STATE); the set of sinks used
 * - calculated: fn | [deps, fn], Kahn topological order, SYG209 on a cycle (thrown at definition)
 * - context entries, READY presence, isolatedState
 * - definition hooks (registry.defHooks) run first: behaviors / undo edit the definition here
 */
import {defHooks, DefSource} from './registry'

export type Handler = [sink: string, fn: any]
export type Calc = [field: string, fn: (s: any) => any, deps: string[] | null]
export interface Def {
  name: string
  view: any
  intent?: (s: any) => Record<string, any>
  handlers: Map<string, Handler[]>
  sinks: Set<string>
  initialState: any
  idle: any
  isolated: boolean
  context: Array<[string, (s: any) => any]> | null
  calc: Calc[] | null
  calcNames: Set<string> | null
  ready: boolean
  onError?: (e: any, info: any) => any
}

export const sygErr = (code: string, name: string, msg: string, fix: string) => {
  const e: any = new Error(`[Sygnal ${code}] ${name}: ${msg}. ${fix}`)
  e.code = code
  return e
}

function normCalc(name: string, calculated: any): [Calc[], Set<string>] | null {
  if (!calculated || typeof calculated != 'object') return null
  const norm: Record<string, [any, string[] | null]> = {}
  for (const f in calculated) {
    const e = calculated[f]
    if (typeof e == 'function') norm[f] = [e, null]
    else if (Array.isArray(e) && e.length == 2 && Array.isArray(e[0]) && typeof e[1] == 'function') norm[f] = [e[1], e[0]]
    else throw sygErr('SYG206', name, `Invalid calculated field '${f}'`, 'Use fn or [deps, fn]')
  }
  const names = new Set(Object.keys(norm))
  // Kahn: per field the calculated fields it waits for, and its dependents
  const deps: Record<string, string[]> = {}, waiting: Record<string, number> = {}, dependents: Record<string, string[]> = {}
  for (const f of names) {
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
    throw sygErr('SYG209', name, `Circular calculated dependency: ${path.slice(path.indexOf(start)).join(' → ')}`, 'Break the cycle')
  }
  return [sorted.map(f => [f, norm[f][0], norm[f][1]] as Calc), names]
}

const defs = new WeakMap<any, Def>()
export function defOf(view: any): Def {
  let d = defs.get(view)
  if (d) return d
  let src: DefSource = {model: view.model, intent: view.intent, initialState: view.initialState, idle: null, calculated: view.calculated, context: view.context}
  for (const h of defHooks) src = h(src, view) || src
  const name = view.componentName || view.label || view.name || 'Component'
  const handlers = new Map<string, Handler[]>(), sinks = new Set<string>()
  for (const key in src.model || {}) {
    let e = src.model[key]
    if (typeof e == 'function') e = {STATE: e}
    const list = handlers.get(key) || handlers.set(key, []).get(key)!
    for (const sink in e) list.push([sink, e[sink]]), sinks.add(sink)
  }
  const c = normCalc(name, src.calculated)
  d = {
    name, view, intent: src.intent, handlers, sinks,
    initialState: src.initialState,
    idle: src.idle,
    isolated: !!view.isolatedState,
    context: src.context ? Object.entries(src.context) as any : null,
    calc: c && c[0], calcNames: c && c[1],
    ready: sinks.has('READY'),
    onError: view.onError,
  }
  defs.set(view, d)
  return d
}
