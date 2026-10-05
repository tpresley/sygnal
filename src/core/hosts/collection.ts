/**
 * PLAN-4.6 next core: the Collection host (03-proposal §2 hosts/, R2). Registered on import (the
 * public `Collection` module imports this file); the core only looks `hosts.collection` up.
 *
 * It stands where the `<Collection>` marker was in its owner's template and renders the items
 * inside the owner's render: no stream of its own, no pickCombine.
 * - `of`: a component function (D163: no names). `from`: a state key (SYG409 on a calculated
 *   one), a `{ get, set }` lens (SYG412 without get(); SYG401 for a non-array) or none (the
 *   owner's state is the array).
 * - Items are keyed by `id`, an id-less item by its raw index (D169); one key -> index map per
 *   array identity serves every item (cell.ts indexer). A duplicate key renders its first element
 *   only; the dev warning is R4's (hooks.onDuplicateKey is the hook point).
 * - `filter` / `sort` (every form today's core accepts; SYG418 for an invalid one) change what
 *   renders and in which order; the state array keeps its order, and an item writes back to its
 *   own element. An item returning `undefined` removes itself.
 * - The other props go to every item (`className` is the container's), and the Collection's
 *   children are each item's children.
 * - The DOM is today's: one `div` with the marker's props (className and the rest set as element
 *   properties, as the current core does), whose children are the items' vnodes.
 * - Removed items are disposed synchronously in the render that drops them (G-257: a move between
 *   two Collections is one patch).
 */
import {hosts, resolvers} from '../registry'
import {NEXT_CORE} from '../build'
import {Inst, shallowEq} from '../instance'
import {Cell, Index, indexer, itemCell, keyCell, keyOf, keyName} from '../cell'
import {CoreDef, isObj} from '../define'
import {uidPart} from '../../shared'
import {viewOf} from '../view'
import {warn, error as logError, fail} from '../../extra/diagnostics/legacy'

const SORT_FIX = "Use a field name, { field: 'asc'|'desc'|1|-1 }, or a function"
const sortError = (msg: string, value: any): undefined => void logError('SYG418', 'Collection', msg, SORT_FIX, value)
const base = (a: any, b: any, asc = true) => (a > b ? (asc ? 1 : -1) : a < b ? (asc ? -1 : 1) : 0)

function fromObj(item: Record<string, any>): ((a: any, b: any) => number) | undefined {
  const e = Object.entries(item)
  if (e.length > 1) return sortError('sort object must have one key; ignored', item)
  const [f, d] = e[0]
  let asc
  if (typeof d == 'string') {
    const x = d.toLowerCase()
    if (x != 'asc' && x != 'desc') return sortError("sort direction must be 'asc' or 'desc'; ignored", item)
    asc = x == 'asc'
  } else if (typeof d == 'number') {
    if (d !== 1 && d !== -1) return sortError('sort direction must be 1 or -1; ignored', item)
    asc = d === 1
  } else return sortError('sort direction must be a string or number; ignored', item)
  return (a, b) => base(a[f], b[f], asc)
}

/** the comparator of a `sort` prop (today's sortFunctionFromProp) */
export function sortFn(p: any): ((a: any, b: any) => number) | undefined {
  if (!p) return
  if (typeof p == 'function') return p
  if (typeof p == 'string') {
    const d = p.toLowerCase()
    if (d == 'asc' || d == 'desc') return (a, b) => base(a, b, d == 'asc')
    return (a, b) => base(a[p], b[p])
  }
  if (Array.isArray(p)) {
    const fs: any[] = p.map(i => typeof i == 'function' ? i
      : typeof i == 'string' ? (['asc', 'desc'].includes(i.toLowerCase()) ? undefined : (a: any, b: any) => base(a[i], b[i]))
      : isObj(i) ? fromObj(i) : undefined).filter(f => typeof f == 'function')
    return (a, b) => fs.reduce((r, f) => (r !== 0 ? r : f(a, b)), 0)
  }
  if (isObj(p)) return fromObj(p)
  return sortError('Invalid sort prop; ignored', p)
}

/** the Collection's own props (`idfield`, removed in 6.0 (D164), is still kept off the items) */
const OWN = new Set(['of', 'from', 'filter', 'sort', 'idfield', 'className'])
const NONE: any[] = []

/** the array cell for `from` (D178: a missing key renders once it appears), or null for an invalid `from` (renders nothing) */
function arrayCell(owner: Inst, from: any): Cell | null {
  const oc = owner.cell, name = owner.def.name
  if (from === undefined) {
    // the owner's state is the array (or its `value`, as today)
    return {
      get: () => { const s = oc.get(); return !Array.isArray(s) && Array.isArray(s?.value) ? s.value : s },
      set: (v) => oc.set(v),
    }
  }
  if (typeof from == 'string') {
    const cs = oc.get(), calc = owner.def.calcNames?.has(from)
    if (isObj(cs) && !(from in cs) && !calc) {
      const arrays = Object.keys(cs).filter(k => Array.isArray(cs[k]))
      warn('SYG401', name, `Collection from="${from}" is not in state${arrays.length ? ` (array fields: '${arrays.join("', '")}')` : ''}; it renders nothing until it exists`, 'Set it to an array in initialState')
    } else if (isObj(cs) && !Array.isArray(cs[from])) warn('SYG401', name, `Collection 'from' field '${from}' is not an array; it renders nothing`, 'Set it to an array in initialState')
    return keyCell(oc, from, calc && name, undefined, 'Collection')
  }
  if (isObj(from) && typeof from.get == 'function') {
    let lp: any = {}, lv: any
    return {
      get() {
        const p = oc.get()
        if (p !== lp) {
          lp = p
          let g: any
          try { g = from.get(p) } catch (e) {
            // G-298: keeps the items it had
            logError('SYG412', name, "Collection 'from' getter threw; it keeps its items", 'Guard the getter against missing data', e)
            owner.app.appError(owner, e, 'view')
            return lv
          }
          lv = g
          if (!Array.isArray(lv)) { warn('SYG401', name, "Collection 'from' getter returned a non-array; it renders nothing", 'Return an array from get()', lv); lv = NONE }
        }
        return lv
      },
      set(v) {
        if (typeof from.set != 'function') return
        const p = oc.get(), n = from.set(p, v)
        if (n !== p) oc.set(n)
      },
    }
  }
  logError('SYG412', name, "Collection 'from' prop is invalid; it renders nothing", 'Use a state key string or { get, set }', from)
  return null
}

/** a component function through the view resolvers (lazy: the loaded one; the owner renders again when it loads) */
export function resolve(view: any, owner: Inst) {
  for (const r of resolvers) view = r(view, owner) || view
  return view
}

export class CollectionHost {
  /** key -> item instance */
  items = new Map<any, Inst>()
  /** the items shown, in render order */
  shown: Inst[] = []
  arr: Cell | null
  index: Index | null
  def!: CoreDef
  ready = true
  disposed = false
  outv: any; last: any; lr = true
  ip: Record<string, any> = {}
  kids: any[] = NONE
  props!: Record<string, any>
  // the inputs of the last item list: array, filter, sort prop, comparator
  la: any; lf: any; ls: any; cmp: any
  uidBase: string
  /** the container's vnode data (the marker's, with its props set on the element, as today) */
  data: any
  key: any
  /** the marker's props the container was made from */
  mp: any

  constructor(public owner: Inst, props: Record<string, any>, children: any[], id: string, marker: any) {
    const of = props.of
    if (!of) fail('SYG411', owner, "Collection is missing 'of'", 'Use of={ItemComponent}')
    if (typeof of != 'function') fail('SYG411', owner, `Collection 'of' is a ${typeof of}`, 'Use of={ItemComponent}')
    this.uidBase = owner.uid(uidPart(id.replace(/.*::(r\.)?/, '')))
    this.arr = arrayCell(owner, props.from)
    this.index = this.arr && indexer(this.arr)
    this.def = owner.app.def(this.view = resolve(of, owner))
    this.setProps(props, children, marker, id)
  }

  /** the item component (a lazy() one: the loaded component once it has loaded, G-317) */
  view: any

  setProps(props: Record<string, any>, children: any[], marker?: any, id?: string) {
    const v = typeof props.of == 'function' ? resolve(props.of, this.owner) : this.view
    if (v !== this.view) {
      // another item component (or a lazy one loaded): the items are made again
      this.def = this.owner.app.def(this.view = v)
      this.clear()
    }
    this.props = props
    if (marker) {
      const p = marker.data?.props || {}
      if (!shallowEq(p, this.mp) || marker.key !== this.key) {
        this.mp = p
        // isCollection: as the current core's container (testing's html() leaves its props out, G-040)
        this.data = {...marker.data, isCollection: true, props: p.key === undefined ? {...p, key: id} : p}
        this.key = marker.key
        this.outv = undefined
      }
    }
    const ip: Record<string, any> = {}
    for (const k in props) if (!OWN.has(k)) ip[k] = props[k]
    const kids = children.length ? children : NONE
    if (!shallowEq(ip, this.ip) || kids !== this.kids) {
      this.ip = ip
      this.kids = kids
      this.items.forEach(i => i.setProps(ip, kids))
    }
  }

  clear() {
    this.items.forEach(i => i.dispose())
    this.items.clear()
    this.shown = []
    this.la = undefined
  }

  /** the item instances in the order shown (byId, InstanceView.children) */
  insts(): Inst[] { return this.shown }

  /** the visible keys in order: filter and sort over the raw array; a duplicate key once */
  list(a: any[], m: Map<any, number>): any[] {
    const {filter, sort} = this.props
    if (sort !== this.ls) { this.ls = sort; this.cmp = sortFn(sort) }
    let idx: number[] | null = null
    if (typeof filter == 'function' || this.cmp) {
      idx = []
      for (let i = 0; i < a.length; i++) if (typeof filter != 'function' || filter(a[i], i, a)) idx.push(i)
      const cmp = this.cmp
      if (cmp) idx.sort((x, y) => cmp(a[x], a[y]))
    }
    const n = idx ? idx.length : a.length, keys: any[] = []
    for (let x = 0; x < n; x++) {
      const i = idx ? idx[x] : x, k = keyOf(a[i], i)
      // D169: a duplicate key renders its first element (R4 reports it)
      if (m.get(k) !== i) { const H = this.owner.app.hooks; H.onDuplicateKey && H.onDuplicateKey(viewOf(this.owner), k[0] == '\0' ? i : a[i].id); continue }
      keys.push(k)
    }
    return keys
  }

  render(): any {
    if (this.disposed) return this.outv
    let changed = !this.outv
    if (this.index) {
      const [a, m] = this.index()
      const {filter, sort} = this.props
      if (a !== this.la || filter !== this.lf || sort !== this.ls) {
        this.la = a; this.lf = filter
        const keys = this.list(a, m), seen = new Set(keys)
        for (const [k, inst] of this.items) if (!seen.has(k)) { inst.dispose(); this.items.delete(k) }
        const o = this.owner, app = o.app, shown: Inst[] = []
        for (const k of keys) {
          let inst = this.items.get(k)
          if (!inst) {
            const scope = app.scope()
            inst = new Inst(app, this.def, o, itemCell(this.arr!, this.index, k), o.dom && o.dom.isolateSource(o.dom, scope),
              this.ip, this.kids, scope, this.uidBase + '-' + uidPart(keyName(k)), 'item')
            this.items.set(k, inst)
          }
          shown.push(inst)
        }
        if (!changed && (shown.length != this.shown.length || shown.some((s, i) => s !== this.shown[i]))) changed = true
        this.shown = shown
      }
    }
    const shown = this.shown, out: any[] = Array(shown.length)
    let j = 0
    for (let i = 0; i < shown.length; i++) {
      const inst = shown[i], v = inst.render()
      if (v !== inst.last) { inst.last = v; changed = true }
      // an item without state yet (or a removed one) is left out
      if (v !== undefined) out[j++] = v
    }
    out.length = j
    if (!changed) return this.outv
    return (this.outv = {sel: 'div', data: this.data, children: out, text: undefined, elm: undefined, key: this.key})
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.clear()
  }
}

// D175: registered only where the next core can run (a production build drops it)
if (NEXT_CORE) hosts.collection = (owner, props, children, id, marker) => new CollectionHost(owner, props, children, id, marker)
