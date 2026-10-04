/**
 * State cells (spike 0-S, ../03-proposal.md §4): pull-based views of the one state tree,
 * memoized on the parent value's identity. Writes go straight to the parent (no reducer
 * wrappers climbing the tree); the root write commits (schedules the flush).
 */
import type {Def} from './define'

export interface Cell { get(): any; set(v: any): void }
export const isObj = (o: any) => o !== null && typeof o == 'object' && !Array.isArray(o)
const warn = (code: string, name: string, msg: string) => console.warn(`[Sygnal ${code}] ${name}: ${msg}`)

export const rootCell = (app: {state: any; commit(): void}): Cell =>
  ({get: () => app.state, set: (v) => { app.state = v; app.commit() }})

/** isolatedState: the instance owns its slot */
export function localCell(app: {commit(): void}): Cell {
  let v: any
  return {get: () => v, set: (n) => { v = n; app.commit() }}
}

/** state="key"; `ro`: the key is a calculated field of the parent (SYG409, writes ignored) */
export function keyCell(parent: Cell, k: string, ro?: string | false): Cell {
  let lp: any = {}, lv: any
  return {
    get() { const p = parent.get(); if (p !== lp) { lp = p; lv = p == null ? undefined : p[k] } return lv },
    set(v) {
      if (ro) return warn('SYG409', ro, `tried to update calculated field '${k}'; ignored`)
      const p = parent.get()
      if (p?.[k] !== v) parent.set({...p, [k]: v})
    },
  }
}

/** state={{ get, set }} */
export function lensCell(parent: Cell, lens: {get(s: any): any; set?(s: any, v: any): any}): Cell {
  let lp: any = {}, lv: any
  return {
    get() { const p = parent.get(); if (p !== lp) { lp = p; lv = lens.get(p) } return lv },
    set(v) { if (lens.set) { const p = parent.get(), n = lens.set(p, v); if (n !== p) parent.set(n) } },
  }
}

/**
 * Calculated fields (and behavior `idle` defaults) as a decorator: get adds them, memoized per
 * input identity and, for [deps, fn] entries, per dependency values (as today's addCalculated);
 * set stores them (storeCalculatedInState's default, the only form kept).
 */
export function calcCell(base: Cell, def: Def): Cell & {add(s: any): any} {
  const calc = def.calc, idle = def.idle
  const caches = calc ? calc.map(() => ({v: null as any[] | null, r: undefined as any})) : []
  let ls: any = {}, lr: any
  const add = (s: any) => {
    if (!isObj(s)) return s
    if (s === ls) return lr
    ls = s
    let m = idle ? {...idle, ...s} : s
    if (calc) {
      m = m === s ? {...s} : m
      for (let i = 0; i < calc.length; i++) {
        const [f, fn, deps] = calc[i], c = caches[i]
        const dv = deps && deps.map(d => m[d])
        if (dv && c.v && dv.every((x, j) => x === c.v![j])) { m[f] = c.r; continue }
        try {
          const r = fn(m)
          if (dv) c.v = dv, c.r = r
          m[f] = r
        } catch (e: any) { warn('SYG220', def.name, `Calculated field '${f}' threw (${e?.message ?? e}); skipped this update`) }
      }
    }
    return (lr = m)
  }
  return {
    add,
    get: () => add(base.get()),
    set(v) {
      if (!isObj(v) || !calc) return base.set(v)
      const c = {...add(v)}
      ls = c; lr = c
      base.set(c)
    },
  }
}

// ------------------------------------------------------------------ Collection items

/** the key of an item: its truthy `.id`, else its index (an id of 0 is replaced, as today) */
export const keyOf = (it: any, i: number) => (isObj(it) && it.id ? it.id : i)
const EMPTY: any[] = []

/** One per Collection: the id -> index map is rebuilt once per array identity, shared by all items */
export function indexer(arr: Cell) {
  let la: any, map = new Map<any, number>()
  return (): [any[], Map<any, number>] => {
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
 * An item: its element by id; an item without an id gets a copy with its index as `id`, a
 * primitive `{ value, id }` (written back as the primitive). Returning undefined removes it.
 */
export function itemCell(arr: Cell, index: () => [any[], Map<any, number>], id: any): Cell {
  let lraw: any = {}, lval: any
  return {
    get() {
      const [a, m] = index(), i = m.get(id)
      if (i === undefined) return undefined
      const raw = a[i]
      if (raw === lraw) return lval
      lraw = raw
      return (lval = isObj(raw) ? (raw.id ? raw : {...raw, id: i}) : {value: raw, id: i})
    },
    set(v) {
      const [a, m] = index(), i = m.get(id)
      if (i === undefined) return
      const cur = a[i]
      if (v === undefined) return arr.set(a.filter((_, j) => j !== i))
      const nv = isObj(cur) || cur === undefined ? v : v?.value
      if (nv === cur || v === lval) return
      arr.set(a.map((x, j) => (j === i ? nv : x)))
    },
  }
}
