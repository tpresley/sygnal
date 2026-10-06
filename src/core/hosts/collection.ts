/**
 * PLAN-4.6 core: the Collection host (03-proposal §2 hosts/, R2). Registered on import (the
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
 * - The other props go to every item, and the Collection's children are each item's children.
 * - 4-H (D229): no element of its own. It renders a keyed fragment of the items' vnodes (its key:
 *   the marker's, else its id), which the DOM driver splices into the parent's children before
 *   each patch (utils.ts flat): the items are the parent element's own children, and their keys
 *   take the fragment's, so two sibling Collections' items never collide. The wrapper `div` of
 *   5.x is gone: `className` / `style` / `class` / ... on the marker are a removed-form error in development
 *   (checks/next.ts) and are ignored.
 * - Removed items are disposed synchronously in the render that drops them (G-257: a move between
 *   two Collections is one patch).
 * - PLAN-5 A-1: `viewTransitionName="card"` styles each keyed item's root element with
 *   `view-transition-name: card-<id>` (shared.ts vtStyle) and `view-transition-class:
 *   card`, the item's own style winning, so a `viewTransitions` action animates each item between
 *   its places, across Collections with the same prefix too. Id-less items (keyed by index) and
 *   fragment roots get none.
 */
import {hosts, resolvers} from '../registry'
import {Inst, shallowEq} from '../instance'
import {Cell, Index, indexer, itemCell, keyCell, keyOf, keyName} from '../cell'
import {CoreDef, isObj} from '../define'
import {uidPart, vtStyle} from '../../shared'
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
const OWN = new Set(['of', 'from', 'filter', 'sort', 'idfield', 'className', 'viewTransitionName'])
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
  /** the fragment's key (the marker's, else the Collection's id) */
  key: any
  tr: any
  /** the app's render epoch it last rendered at (G-311) */
  ep = 0

  constructor(public owner: Inst, props: Record<string, any>, children: any[], id: string, marker: any) {
    this.hostProps(props, marker)
    const of = props.of
    if (!of) fail('SYG411', owner, "Collection is missing 'of'", 'Use of={ItemComponent}')
    if (typeof of != 'function') fail('SYG411', owner, `Collection 'of' is a ${typeof of}`, 'Use of={ItemComponent}')
    this.uidBase = owner.uid(uidPart(id.replace(/.*::(r\.)?/, '')))
    this.arr = arrayCell(owner, props.from)
    this.index = this.arr && indexer(this.arr)
    this.def = owner.app.def(this.view = resolve(of, owner))
    this.setProps(props, children, marker, id)
  }

  /**
   * onHostProps (R4): the Collection checks of the dev entry (SYG401 for a missing `from`, D173's
   * string `of`, 4-H's wrapper props: the marker's data); the marker's sel tells a
   * VirtualCollection from a Collection
   */
  hostProps(props: Record<string, any>, m: any) {
    const H = this.owner.app.hooks
    if (H.onHostProps) H.onHostProps(viewOf(this.owner), m.sel, props, m.data)
  }

  /** the item component (a lazy() one: the loaded component once it has loaded, G-317) */
  view: any

  setProps(props: Record<string, any>, children: any[], marker?: any, id?: string) {
    // (the constructor called the hook before its own checks)
    if (this.props) this.hostProps(props, marker)
    const v = typeof props.of == 'function' ? resolve(props.of, this.owner) : this.view
    if (v !== this.view) {
      // another item component (or a lazy one loaded): the items are made again
      this.def = this.owner.app.def(this.view = v)
      this.clear()
    }
    this.props = props
    if (marker) {
      // tr: a <Transition> around it, applied to each item (4-I G-559, markers/transition.ts):
      // the fragment is made again on each of the owner's renders while there is one (or was)
      const k = marker.key ?? id
      if (this.tr !== (this.tr = marker.data?.tr) || k !== this.key) { this.key = k; this.outv = undefined }
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
    const cmp = sort !== this.ls ? sortFn(sort) : this.cmp
    let idx: number[] | null = null
    if (typeof filter == 'function' || cmp) {
      idx = []
      for (let i = 0; i < a.length; i++) if (typeof filter != 'function' || filter(a[i], i, a)) idx.push(i)
      if (cmp) idx.sort((x, y) => cmp(a[x], a[y]))
    }
    // G-311: the inputs are kept only once the list was made (a throwing filter / sort is retried)
    this.ls = sort; this.cmp = cmp
    const n = idx ? idx.length : a.length, keys: any[] = []
    for (let x = 0; x < n; x++) {
      const i = idx ? idx[x] : x, k = keyOf(a[i], i)
      // D169: a duplicate key renders its first element (R4 reports it)
      if (m.get(k) !== i) { const H = this.owner.app.hooks; H.onDuplicateKey && H.onDuplicateKey(viewOf(this.owner), k[0] == '\0' ? i : a[i].id); continue }
      keys.push(k)
    }
    return keys
  }

  /**
   * G-319: on a hidden Switchable page (no render): the items follow the array (removed ones are
   * disposed, new ones created, so their background statics and replies run), with no view call
   */
  sync() {
    if (this.disposed) return
    this.items_()
    for (const i of this.shown) i.sync()
  }

  /** the item instances for the current array, filter and sort; true when the list changed */
  items_(): boolean {
    if (!this.index) return false
    const app = this.owner.app
    let changed = false
    {
      const [a, m] = this.index()
      const {filter, sort} = this.props
      if (a !== this.la || filter !== this.lf || sort !== this.ls) {
        const keys = this.list(a, m), seen = new Set(keys)
        this.la = a; this.lf = filter
        for (const [k, inst] of this.items) if (!seen.has(k)) { inst.dispose(); this.items.delete(k) }
        const o = this.owner, shown: Inst[] = []
        for (const k of keys) {
          let inst = this.items.get(k)
          if (!inst) {
            const scope = app.scope()
            inst = new Inst(app, this.def, o, itemCell(this.arr!, this.index, k), o.dom && o.dom.isolateSource(o.dom, scope),
              this.ip, this.kids, scope, this.uidBase + '-' + keyName(k), 'item')
            this.items.set(k, inst);
            // its key (A-1's view-transition name)
            (inst as any).k = k
          }
          shown.push(inst)
        }
        if (shown.length != this.shown.length || shown.some((s, i) => s !== this.shown[i])) changed = true
        this.shown = shown
      }
    }
    return changed
  }

  render(): any {
    if (this.disposed) return this.outv
    // G-311: after a render that threw, every container is made again once
    const app = this.owner.app
    let changed = !this.outv || this.ep !== app.ep
    this.ep = app.ep
    if (this.items_()) changed = true
    const shown = this.shown, out: any[] = Array(shown.length), vn = this.props.viewTransitionName
    let j = 0
    for (let i = 0; i < shown.length; i++) {
      const inst: any = shown[i], v = inst.render()
      if (v !== inst.last) { inst.last = v; changed = true }
      // an item without state yet (or a removed one) is left out
      if (v !== undefined) out[j++] = this.tr ? this.tr(vn ? named(inst, v, vn) : v) : vn ? named(inst, v, vn) : v
    }
    out.length = j
    if (!changed) return this.outv
    return (this.outv = {sel: undefined, data: {}, children: out, text: undefined, elm: undefined, key: this.key})
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.clear()
  }
}

/**
 * A-1: the item's vnode with its view-transition name (cached per item, so an unchanged item
 * keeps its vnode). VirtualCollection's rows too (extra/virtual.ts, G-417)
 */
export function named(inst: any, v: any, p: string): any {
  const k = inst.k
  if (!v.sel || k[0] == '\0') return v
  if (inst.vi !== v || inst.vp !== p) {
    inst.vi = v; inst.vp = p
    inst.vo = {...v, data: {...v.data, style: vtStyle(p, k, v.data?.style)}}
  }
  return inst.vo
}

hosts.collection = (owner, props, children, id, marker) => new CollectionHost(owner, props, children, id, marker)
