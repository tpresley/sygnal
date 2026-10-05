/**
 * PLAN-4.6 next core: state cells (03-proposal §4). Pull-based views of the one state tree,
 * memoized on the parent value's identity. A write goes straight to the parent (no reducer
 * wrappers climbing the tree); the root's (or an isolated instance's local) write commits.
 *
 * | cell  | get                                        | set                                     |
 * | root  | app.state                                  | app.state = v; commit                   |
 * | key   | parent.get()[k] (or a default, isolated)   | parent.set({...p, [k]: v}); SYG409 when k is a calculated field of the parent |
 * | lens  | lens.get(parent.get())                     | parent.set(lens.set(p, v))              |
 * | local | its own value; the parent's until written  | own value; commit (isolatedState)       |
 *
 * Calculated fields (and `idle` defaults) are a decorator: get() adds them, memoized per input
 * identity and per declared dependency values; set() stores them (the only behaviour after D164).
 * Children read through their parent's decorated cell, so they see its calculated fields, and a
 * child's write stores freshly computed ones (4-F).
 */
import type {CoreDef} from './define'
import {isObj} from './define'
import {warn, error as logError} from '../extra/diagnostics/legacy'

export interface Cell {
  get(): any
  set(v: any): void
}
export interface CalcCell extends Cell {
  /** the raw value (calculated fields only as stored), for STATE.stream */
  raw(): any
}

export const rootCell = (app: {state: any; commit(): void}): Cell =>
  ({get: () => app.state, set: (v) => { app.state = v; app.commit() }})

/** isolatedState without a `state` prop: owned by the instance; the parent's state until first written */
export function localCell(app: {commit(): void}, parent: Cell): Cell {
  let v: any, own = false
  return {local: true, get: () => (own ? v : parent.get()), set: (n) => { v = n; own = true; app.commit() }} as Cell
}

/**
 * state="key". `owner`: the parent's name when `k` is one of its calculated fields (SYG409:
 * writes ignored; `what` names the writer in the message). `dflt`: an isolated child's
 * initialState, read while the slice is undefined. `has()`: the slice itself is defined (D174).
 */
export function keyCell(parent: Cell, k: string, owner?: string | false, dflt?: any, what = 'Sub-component'): Cell & {has(): boolean} {
  let lp: any = {}, lv: any
  return {
    get() {
      const p = parent.get()
      if (p !== lp) { lp = p; lv = p == null ? undefined : p[k]; if (lv === undefined) lv = dflt }
      return lv
    },
    set(v) {
      if (owner) return warn('SYG409', owner, `${what} tried to update calculated field '${k}'; ignored`, 'Bind it to a non-calculated field')
      const p = parent.get()
      if (p?.[k] !== v) parent.set({...p, [k]: v})
    },
    has: () => parent.get()?.[k] !== undefined,
  }
}

/**
 * state={{ get, set }} (no get: SYG410, the parent's whole state). G-298: a get() that throws
 * keeps the last value (SYG410, and `onErr` for the app's onError)
 */
export function lensCell(parent: Cell, lens: any, owner: string, onErr?: (e: any) => void): Cell {
  if (typeof lens?.get != 'function') {
    logError('SYG410', owner, `Sub-component 'state' prop ${isObj(lens) ? 'has no get()' : `is a ${typeof lens}`}; it gets the parent's whole state`, 'Use a state key string or { get, set }')
    return parent
  }
  let lp: any = {}, lv: any
  return {
    get() {
      const p = parent.get()
      if (p !== lp) {
        lp = p
        try { lv = lens.get(p) } catch (e) {
          logError('SYG410', owner, "Sub-component 'state' lens get() threw; it keeps its last value", 'Guard the getter against missing data', e)
          onErr?.(e)
        }
      }
      return lv
    },
    set(v) {
      if (typeof lens.set != 'function') return
      const p = parent.get(), n = lens.set(p, v)
      if (n !== p) parent.set(n)
    },
  }
}

/** calculated fields and `idle` defaults over a base cell */
export function calcCell(base: Cell, def: CoreDef): CalcCell {
  const calc = def.calculated, idle = def.idle
  const caches = calc ? calc.map(() => ({v: null as any[] | null, r: undefined as any})) : []
  let ls: any = {}, lr: any
  const add = (s: any) => {
    if (!isObj(s)) return s
    if (s === ls) return lr
    ls = s
    let m = idle ? {...idle, ...s} : s
    if (calc) {
      if (m === s) m = {...s}
      for (let i = 0; i < calc.length; i++) {
        const [f, fn, deps] = calc[i], c = caches[i]
        const dv = deps && deps.map(d => m[d])
        if (dv && c.v && dv.every((x, j) => x === c.v![j])) { m[f] = c.r; continue }
        try {
          const r = fn(m)
          if (dv) c.v = dv, c.r = r
          m[f] = r
        } catch (e: any) {
          warn('SYG220', def.name, `Calculated field '${f}' threw (${e instanceof Error ? e.message : e}); skipped this update`, 'Guard against missing data')
        }
      }
    }
    return (lr = m)
  }
  return {
    raw: () => base.get(),
    get: () => add(base.get()),
    set(v) {
      if (!isObj(v) || !(calc || idle)) return base.set(v)
      // stored with its calculated fields (and idle defaults), as cleanupCalculated did
      const c = {...add(v)}
      ls = c; lr = c
      base.set(c)
    },
  }
}


// ------------------------------------------------------------------ Collection items

/**
 * An item's key: the truthy `id` of an object item, else its raw index in the state array (D169:
 * not its filtered/sorted position). An index and an equal id are the same key, as today, so an
 * id-less item that writes itself back with its index as `id` keeps its instance.
 */
export const keyOf = (it: any, i: number) => (isObj(it) && it.id ? it.id : i)

const EMPTY: any[] = []
export type Index = () => [items: any[], byKey: Map<any, number>]

/** one per Collection: the key -> raw index map (first occurrence), rebuilt once per array identity, shared by its items */
export function indexer(arr: Cell): Index {
  let la: any, map = new Map<any, number>()
  return () => {
    const g = arr.get(), a = Array.isArray(g) ? g : EMPTY
    if (a !== la) {
      la = a
      map = new Map()
      for (let i = 0; i < a.length; i++) { const k = keyOf(a[i], i); if (!map.has(k)) map.set(k, i) }
    }
    return [a, map]
  }
}

/**
 * A Collection item: the element of its key. An id-less element is a copy with its index as `id`
 * (a primitive `{ value, id }`, written back as the primitive). Writing `undefined` removes the
 * element; the other elements keep their identity (PF-1).
 */
export function itemCell(arr: Cell, index: Index, key: any): Cell {
  let lraw: any = {}, lval: any
  return {
    get() {
      const [a, m] = index(), j = m.get(key)
      // removed: its last state (a disposing item's DISPOSE / dispose$ handlers read it, as today)
      if (j === undefined) return lval
      const raw = a[j]
      if (raw === lraw) return lval
      lraw = raw
      return (lval = isObj(raw) ? (raw.id ? raw : {...raw, id: j}) : {value: raw, id: j})
    },
    set(v) {
      const [a, m] = index(), j = m.get(key)
      if (j === undefined) return
      if (v === undefined) return arr.set(a.filter((_: any, x: number) => x !== j))
      const cur = a[j]
      if (v === cur || (v === lval && cur === lraw)) return
      const n = a.slice()
      n[j] = isObj(cur) || !isObj(v) ? v : v.value
      arr.set(n)
    },
  }
}
