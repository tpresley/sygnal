/**
 * Hosts (spike 0-S, ../03-proposal.md §2 hosts/): Collection and Switchable, registered on
 * import. A host stands in the owner's template where its marker vnode was, renders its
 * instances inside the owner's render, and has no stream of its own.
 */
import {Cell, indexer, itemCell, keyCell, keyOf, lensCell, isObj} from './cell'
import {defOf, Def} from './define'
import {hosts} from './registry'
import {Inst, shallowEq} from './instance'

// ------------------------------------------------------------------ sort props (as today)
const sortErr = (msg: string, v: any) => void console.error(`[Sygnal SYG418] Collection: ${msg}`, v)
const base = (a: any, b: any, asc = true) => (a > b ? (asc ? 1 : -1) : a < b ? (asc ? -1 : 1) : 0)
function fromObj(o: any): any {
  const e = Object.entries(o)
  if (e.length > 1) return sortErr('sort object must have one key; ignored', o)
  const [f, d] = e[0] as [string, any]
  let asc
  if (typeof d == 'string') { const x = d.toLowerCase(); if (x != 'asc' && x != 'desc') return sortErr("sort direction must be 'asc' or 'desc'; ignored", o); asc = x == 'asc' }
  else if (typeof d == 'number') { if (d !== 1 && d !== -1) return sortErr('sort direction must be 1 or -1; ignored', o); asc = d === 1 }
  else return sortErr('sort direction must be a string or number; ignored', o)
  return (a: any, b: any) => base(a[f], b[f], asc)
}
export function sortFn(p: any): ((a: any, b: any) => number) | undefined {
  if (!p) return
  if (typeof p == 'function') return p
  if (typeof p == 'string') {
    const d = p.toLowerCase()
    if (d == 'asc' || d == 'desc') return (a, b) => base(a, b, d == 'asc')
    return (a, b) => base(a[p], b[p])
  }
  if (Array.isArray(p)) {
    const fs = p.map(i => typeof i == 'function' ? i
      : typeof i == 'string' ? (['asc', 'desc'].includes(i.toLowerCase()) ? undefined : (a: any, b: any) => base(a[i], b[i]))
      : isObj(i) ? fromObj(i) : undefined).filter(f => typeof f == 'function')
    return (a, b) => fs.reduce((r, f) => (r !== 0 ? r : f(a, b)), 0)
  }
  if (isObj(p)) return fromObj(p)
  return sortErr('Invalid sort prop; ignored', p)
}

const COLL_KEYS = new Set(['of', 'from', 'filter', 'sort', 'idfield', 'className', 'children'])

// ------------------------------------------------------------------ Collection
let COLL = 0
class Coll {
  items = new Map<any, Inst>()
  arr: Cell
  index: () => [any[], Map<any, number>]
  key = 'coll' + ++COLL
  def: Def
  ready = true
  outv: any; last: any; lr = true
  ids: any[] = []
  ip: any = {}
  la: any; lf: any; lsort: any; cmp: any
  props: any
  constructor(public owner: Inst, props: any) {
    const from = props.from
    this.arr = from === undefined ? owner.cell
      : typeof from == 'string' ? keyCell(owner.cell, from, owner.def.calcNames?.has(from) && owner.def.name)
      : lensCell(owner.cell, from)
    this.index = indexer(this.arr)
    this.def = defOf(props.of)
    this.setProps(props)
  }
  setProps(p: any) {
    this.props = p
    const ip: any = {}
    for (const k in p) if (!COLL_KEYS.has(k)) ip[k] = p[k]
    if (!shallowEq(ip, this.ip)) { this.ip = ip; this.items.forEach(i => (i.props = ip)) }
  }
  render() {
    const [a, m] = this.index()
    const {filter, sort} = this.props
    let changed = false
    if (a !== this.la || filter !== this.lf || sort !== this.lsort) {
      this.la = a; this.lf = filter
      if (sort !== this.lsort) { this.lsort = sort; this.cmp = sortFn(sort) }
      // the visible items: the state array keeps its order; filter + sort only change what renders
      let idx: number[] = []
      for (let i = 0; i < a.length; i++) if (typeof filter != 'function' || filter(a[i])) idx.push(i)
      const cmp = this.cmp
      if (cmp) idx = idx.sort((x, y) => cmp(a[x], a[y]))
      const ids: any[] = [], seen = new Set<any>()
      for (const i of idx) { const id = keyOf(a[i], i); if (m.get(id) === i && !seen.has(id)) seen.add(id), ids.push(id) }
      for (const [id, inst] of this.items) if (!seen.has(id)) { inst.dispose(); this.items.delete(id) }
      const o = this.owner
      for (const id of ids) {
        if (!this.items.has(id)) {
          const scope = `${this.key}-${id}`
          this.items.set(id, new Inst(o.app, this.def, o, itemCell(this.arr, this.index, id), o.dom.isolateSource(o.dom, scope), this.ip, [], scope))
        }
      }
      this.ids = ids
      changed = true
    }
    const ids = this.ids, kids: any[] = Array(ids.length)
    for (let i = 0; i < ids.length; i++) {
      const inst = this.items.get(ids[i])!
      const v = inst.render()
      if (v !== inst.last || inst.ready !== inst.lr) { inst.last = v; inst.lr = inst.ready; changed = true }
      kids[i] = inst.ready ? v : notReady(v)
    }
    if (!changed && this.outv) return this.outv
    return (this.outv = {sel: 'div', data: this.props.className ? {props: {className: this.props.className}} : {}, children: kids, key: this.key, text: undefined, elm: undefined})
  }
  dispose() { this.items.forEach(i => i.dispose()); this.items.clear() }
}
const notReady = (v: any) => v && v.sel ? {...v, data: {...v.data, attrs: {...v.data?.attrs, 'data-sygnal-ready': 'false'}}} : v

// ------------------------------------------------------------------ Switchable
let SW = 0
class Switch {
  pages: Record<string, {inst: Inst; i: any; name: string}> = {}
  cell: Cell
  ready = true
  cur: any
  outv: any; last: any; lr = true; lcur: any
  key = 'sw' + ++SW
  constructor(public owner: Inst, props: any) {
    const st = props.state
    this.cell = typeof st == 'string' ? keyCell(owner.cell, st, owner.def.calcNames?.has(st) && owner.def.name)
      : st && typeof st == 'object' ? lensCell(owner.cell, st) : owner.cell
    // every page is created at mount and stays alive while hidden (R4-1)
    for (const name in props.of || {}) this.pages[name] = {inst: this.make(name, props.of[name]), i: undefined, name}
    this.setProps(props)
  }
  make(name: string, view: any) {
    const o = this.owner, scope = `${this.key}-${name}`
    return new Inst(o.app, defOf(view), o, this.cell, o.dom.isolateSource(o.dom, scope), {}, [])
  }
  setProps(p: any) {
    const cur = p.current, page = this.pages[cur]
    // D83: shown with another instance key than the one it was last shown with: re-created
    if (page) {
      if (page.i !== undefined && page.i !== p.instance) { page.inst.dispose(); page.inst = this.make(cur, page.inst.def.view) }
      page.i = p.instance
    }
    for (const n in this.pages) this.pages[n].inst.hidden = n !== cur
    this.cur = cur
  }
  render() {
    const page = this.pages[this.cur]
    if (!page) return (this.outv = undefined)
    // hidden pages are not rendered at all (their render is skipped; they catch up when shown)
    const v = page.inst.render()
    return (this.outv = page.inst.ready === false ? notReady(v) : v)
  }
  dispose() { for (const n in this.pages) this.pages[n].inst.dispose() }
}

hosts.collection = (owner, props) => new Coll(owner, props)
hosts.switchable = (owner, props) => new Switch(owner, props)
