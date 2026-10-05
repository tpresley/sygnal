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
 * writes ignored). `dflt`: an isolated child's initialState, read while the slice is undefined.
 */
export function keyCell(parent: Cell, k: string, owner?: string | false, dflt?: any): Cell {
  let lp: any = {}, lv: any
  return {
    get() {
      const p = parent.get()
      if (p !== lp) { lp = p; lv = p == null ? undefined : p[k]; if (lv === undefined) lv = dflt }
      return lv
    },
    set(v) {
      if (owner) return warn('SYG409', owner, `Sub-component tried to update calculated field '${k}'; ignored`, 'Bind it to a non-calculated field')
      const p = parent.get()
      if (p?.[k] !== v) parent.set({...p, [k]: v})
    },
  }
}

/** state={{ get, set }} (no get: SYG410, the parent's whole state) */
export function lensCell(parent: Cell, lens: any, owner: string): Cell {
  if (typeof lens?.get != 'function') {
    logError('SYG410', owner, `Sub-component 'state' prop ${isObj(lens) ? 'has no get()' : `is a ${typeof lens}`}; it gets the parent's whole state`, 'Use a state key string or { get, set }')
    return parent
  }
  let lp: any = {}, lv: any
  return {
    get() { const p = parent.get(); if (p !== lp) { lp = p; lv = lens.get(p) } return lv },
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
