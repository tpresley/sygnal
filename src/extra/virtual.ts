/**
 * PLAN-5 V-1: `<VirtualCollection>`, a Collection that renders only the rows in view.
 *
 *   <VirtualCollection of={Row} from="rows" className="rows" estimateSize={32} />
 *   // a fixed height in CSS: .rows { height: 400px }
 *   // jump:  JUMP: { ELEMENT: (s, i) => ({ scrollToIndex: '.rows', index: i }) }
 *   //        FIND: { ELEMENT: (s, id) => ({ scrollToId: '.rows', id, align: 'center' }) }
 *
 * The same `of` / `from` / `filter` / `sort` as Collection (it is the core's Collection host with
 * a window: D169 keys, D177 duplicates, D178 a missing `from`, SYG401/411/412/418), and the other
 * props go to every item. Measurement and the window come from `@tanstack/virtual-core`, a regular
 * dependency of sygnal (D209; tree-shaken when unused).
 *
 * 0 B when unused: nothing runs on import. The tag is a function carrying the pragma's render
 * hook (`__sygnalControl`, as `defineWidget` tags), so its first render registers the host
 * (`hosts['virtual-collection']`) and returns the marker the core's reconcile hands to it.
 *
 * - The element is its own scroll container: a `div` (className, id, style, aria-label/-labelledby/
 *   -describedby, `role` (default `list`), tabIndex (default 0, so the keyboard scrolls it)) with
 *   `overflow-y: auto` and `overflow-anchor: none` (the virtualizer corrects the offset itself).
 *   Inside: a spacer as tall as every row (measured or estimated), and a window moved down to the
 *   first rendered row; the rows are in normal flow inside it, so a row's height is its own.
 * - Only the rows in view (+ `overscan`, default 5) have instances. A row scrolled out is disposed
 *   like a removed Collection item and made again when it comes back. Its state is its element
 *   of the array, so nothing in state is lost; what lives only in the DOM (focus, an uncontrolled
 *   input's text, a running EFFECT) is. Keep row state in the array (the canonical Collection item).
 * - Row heights: `estimateSize` (a number, or `(item, index) => number`, default 32) until a row is
 *   rendered; then its measured height (ResizeObserver follows later changes). A 0 measurement (no
 *   layout: jsdom) keeps the estimate.
 * - Each row's root element gets `data-index`, `aria-setsize` and `aria-posinset` (1-based, over the
 *   filtered list), and `role="listitem"` when the container's role is `list` and the row's root has
 *   no role of its own. A row must render one element (SYG432 for a fragment or text).
 * - `scrollToIndex` / `scrollToId` are element commands (methods of the container element):
 *   `{ scrollToIndex: '.rows', index, align?, behavior? }`, `{ scrollToId: '.rows', id, align?,
 *   behavior? }` (align: 'auto' (default: only when not in view) | 'start' | 'center' | 'end').
 *   The row needs no element: the virtualizer scrolls to its offset and keeps correcting it while
 *   the rows around it are measured. An id not in the (filtered) list: SYG433 in dev, no scroll.
 * - Without layout (SSR, the mock DOM, jsdom), the window is the first 10 rows' estimate + overscan.
 * - The container must have a bounded height. When it has none (0 tall: SYG430) or grows with its
 *   rows (it would render every row: SYG430), the window is clamped to the viewport's height.
 *   Items without `id`: SYG431 (index keys: rows and measured heights follow the position).
 *
 * Dev text lives in 'sygnal/diagnostics' (checks/virtual.ts), reached through the core bridge as
 * `virtual(code, owner, extra)`; production reports nothing.
 */
import {hosts} from '../core/registry'
import {CollectionHost} from '../core/hosts/collection'
import {Inst} from '../core/instance'
import {itemCell, keyName, keyOf} from '../core/cell'
import {chainHooks} from '../pragma/index'
import {Virtualizer, elementScroll, observeElementOffset, observeElementRect} from '@tanstack/virtual-core'

const SEL = 'virtual-collection'
/** the container's props (not passed to the items) */
const OWN = /^(estimateSize|overscan|role|tabIndex|style|id|aria-(label|labelledby|describedby))$/
const NONE: any[] = []
/** rows in the window when there is no layout (SSR, mock DOM, jsdom) */
const ROWS0 = 10

const dev = (code: number, owner: any, x?: any): any => (globalThis as any).__SYGNAL_DIAGNOSTICS__?.virtual?.(code, owner, x)

const px = (n: number) => n + 'px'
const same = (a: any, b: any, d?: any): boolean => {
  const k = Object.keys(a)
  return k.length == Object.keys(b).length && k.every(x => a[x] === b[x] || !d && x == 'style' && a[x] && b[x] && typeof a[x] == 'object' && same(a[x], b[x], 1))
}

export class VirtualHost extends CollectionHost {
  // (no field initializers: the base constructor calls setProps() before they would run)
  declare vp: Record<string, any>
  /** every visible key in order (filter, sort applied); the virtualizer's items */
  declare all: any[]
  declare v: Virtualizer<any, any> | undefined
  /** the scroll container, once on the page */
  declare el: any
  /** the last window: start offset, total size, first index, rows; the container's data */
  declare lw: any
  declare cd: any
  declare gk: (i: number) => any
  /** per item instance: [its vnode, index, set size, role, the decorated vnode] */
  declare dc: WeakMap<Inst, any[]>
  declare warned: number
  declare un: (() => void) | undefined

  setProps(props: Record<string, any>, children: any[], marker?: any, id?: string) {
    const vp: Record<string, any> = {}, rest: Record<string, any> = {}
    for (const k in props) (OWN.test(k) ? vp : rest)[k] = props[k]
    rest.className = props.className
    if (!this.dc) { this.dc = new WeakMap(); this.all = NONE; this.warned = 0 }
    const was = this.vp, cls = this.props?.className
    this.vp = vp
    super.setProps(rest, children, marker, id)
    if (!was || vp.estimateSize !== was.estimateSize || vp.overscan !== was.overscan) this.opts(was && vp.estimateSize !== was.estimateSize)
    // the container's data is made again when its props change (a style object one level deep)
    if (!was || cls !== rest.className || !same(vp, was)) this.cd = undefined
  }

  /** the virtualizer, (re)configured from the props and the current list */
  opts(remeasure?: any) {
    const p = this.vp, est = p.estimateSize, o = p.overscan
    if (est !== undefined && !(typeof est == 'function' || est > 0)) dev(434, this.owner, {prop: 'estimateSize', value: est})
    if (o !== undefined && !(o >= 0)) dev(434, this.owner, {prop: 'overscan', value: o})
    const size = typeof est == 'function' ? (i: number) => { const s = est(this.itemAt(i), i); return s > 0 ? s : 32 } : () => (est > 0 ? est : 32)
    const opts: any = {
      count: this.all.length,
      getItemKey: this.gk ||= (i: number) => this.all[i],
      getScrollElement: () => this.el,
      estimateSize: size,
      overscan: o >= 0 ? o : 5,
      initialRect: {width: 0, height: (est > 0 ? est : 32) * ROWS0},
      scrollToFn: elementScroll,
      observeElementOffset,
      observeElementRect: (v: any, cb: any) => observeElementRect(v, (r: any) => cb(this.bound(r))),
      // the height unrounded (rows are in normal flow: rounded sizes would drift from where the
      // browser puts them, by up to half a pixel a row); 0 (no layout: jsdom) is no measurement
      measureElement: (e: any, entry: any, v: any) =>
        entry?.borderBoxSize?.[0]?.blockSize || e.getBoundingClientRect().height || e.offsetHeight || v.options.estimateSize(v.indexFromElement(e)),
      onChange: () => this.disposed || this.owner.app.commit(),
    }
    if (this.v) {
      this.v.setOptions(opts)
      if (remeasure) this.v.measure()
    } else this.v = new Virtualizer(opts)
  }

  /** the raw array element shown at index i */
  itemAt(i: number) {
    const [a, m] = this.index!()
    return a[m.get(this.all[i])!]
  }

  /**
   * The rect the window is computed from. No height: SYG430 when the element is laid out (in jsdom
   * nothing is), and the no-layout window. As tall as all the rows and taller than the viewport:
   * the container grows with its rows (no bounded height), so the window is the viewport's height
   */
  bound(r: {width: number; height: number}) {
    const el = this.el, v = this.v!, total = v.getTotalSize(), win = el?.ownerDocument?.defaultView
    if (!r.height) {
      if (el?.getClientRects?.().length) this.warn(1, {reason: 'height'})
      return {width: r.width, height: v.options.initialRect!.height}
    }
    const vh = win?.innerHeight || 0
    if (vh && total > vh && r.height >= total - 1) {
      this.warn(2, {reason: 'grows', height: r.height})
      return {width: r.width, height: vh}
    }
    return r
  }

  warn(bit: number, x: any) {
    if (this.warned & bit) return
    this.warned |= bit
    dev(430, this.owner, x)
  }

  /** the list of keys (as a Collection's: filter, sort, the first of a duplicate key); true when it changed */
  keys(): boolean {
    if (!this.index) return false
    const [a, m] = this.index(), {filter, sort} = this.props
    if (a === this.la && filter === this.lf && sort === this.ls) return false
    // no filter, no sort and no duplicate key: the index's keys are the list, in order (100k rows:
    // no second pass making keys)
    if (typeof filter != 'function' && !sort && m.size == a.length) { this.all = [...m.keys()]; this.ls = sort; this.cmp = undefined }
    else this.all = this.list(a, m)
    this.la = a; this.lf = filter
    // SYG431 (dev only: a pass over the array)
    if (a.length && !(this.warned & 4) && (globalThis as any).__SYGNAL_DIAGNOSTICS__?.virtual && a.some((x, i) => keyOf(x, i)[0] == '\0')) { this.warned |= 4; dev(431, this.owner, {count: a.length}) }
    // a new key function: the virtualizer re-reads the keys (its measurements are by key)
    this.gk = (i: number) => this.all[i]
    this.opts()
    return true
  }

  /** the item instances in the window; true when they changed */
  items_(): boolean {
    this.keys()
    const v = this.v!, app = this.owner.app, o = this.owner, all = this.all
    const vis = all.length ? v.getVirtualIndexes() : NONE
    const want = new Set<any>()
    for (const i of vis) want.add(all[i])
    for (const [k, inst] of this.items) if (!want.has(k)) { inst.dispose(); this.items.delete(k) }
    const shown: Inst[] = []
    for (const i of vis) {
      const k = all[i]
      let inst = this.items.get(k)
      if (!inst) {
        const scope = app.scope()
        inst = new Inst(app, this.def, o, itemCell(this.arr!, this.index!, k), o.dom && o.dom.isolateSource(o.dom, scope),
          this.ip, this.kids, scope, this.uidBase + '-' + keyName(k), 'item')
        this.items.set(k, inst)
      }
      shown.push(inst)
    }
    const changed = shown.length != this.shown.length || shown.some((s, i) => s !== this.shown[i])
    this.shown = shown
    return changed
  }

  clear() {
    super.clear()
    this.all = NONE
  }

  /** a row's root with its index, ARIA position and measuring hook (the same vnode while nothing changed) */
  deco(inst: Inst, x: any, i: number, n: number, list: boolean): any {
    const c = this.dc.get(inst)
    if (c && c[0] === x && c[1] === i && c[2] === n && c[3] === list) return c[4]
    let out = x
    if (!x.sel) {
      // a fragment or text: nothing to measure or label
      if (!(this.warned & 8)) { this.warned |= 8; dev(432, this.owner, {component: this.def.name}) }
    } else {
      // the position for a row with a role (its own, or listitem in a list): not on a generic element
      const d = x.data || {}, role = d.attrs?.role || d.props?.role, attrs: any = {...d.attrs, 'data-index': i}
      if (list || role) attrs['aria-posinset'] = i + 1, attrs['aria-setsize'] = n
      if (list && !role) attrs.role = 'listitem'
      const data = {...d, attrs}
      chainHooks(data, {insert: (y: any) => this.v?.measureElement(y.elm)})
      out = {...x, data}
    }
    this.dc.set(inst, [x, i, n, list, out])
    return out
  }

  /** the container's vnode data: its props, attributes, style and the hooks that attach the virtualizer */
  box() {
    if (this.cd) return this.cd
    const p = this.vp, attrs: any = {role: p.role === undefined ? 'list' : p.role, tabindex: p.tabIndex ?? 0}
    for (const k of ['id', 'aria-label', 'aria-labelledby', 'aria-describedby']) if (p[k] != null) attrs[k] = p[k]
    if (attrs.role == null) delete attrs.role
    return (this.cd = {
      props: this.props.className ? {className: this.props.className} : {},
      attrs,
      style: {overflowY: 'auto', overflowAnchor: 'none', ...p.style},
      // (the mock DOM's command check: these methods are the container's)
      vc: {commands: {scrollToIndex: 1, scrollToId: 1}},
      hook: {
        insert: (y: any) => this.attach(y.elm),
        postpatch: (_: any, y: any) => y.elm !== this.el && this.attach(y.elm),
        destroy: () => this.detach(),
      },
    })
  }

  attach(el: any) {
    if (this.el) this.detach()
    this.el = el
    el.scrollToIndex = (x: any) => this.scrollTo(typeof x == 'number' ? x : x?.index, x)
    el.scrollToId = (x: any) => {
      const id = typeof x == 'object' && x ? x.id : x, i = id == null ? -1 : this.all.indexOf('' + id)
      if (i < 0) return void dev(433, this.owner, {id, count: this.all.length})
      this.scrollTo(i, x)
    }
    this.un = this.v!._didMount()
    this.v!._willUpdate()
  }

  scrollTo(i: any, x: any) {
    const n = this.all.length
    if (!(i >= 0 && i < n) || i % 1) return void dev(433, this.owner, {index: i, count: n})
    this.v!.scrollToIndex(i, {align: x?.align, behavior: x?.behavior})
  }

  detach() {
    const el = this.el
    if (!el) return
    this.el = undefined
    delete el.scrollToIndex
    delete el.scrollToId
    this.un?.()
  }

  render(): any {
    if (this.disposed) return this.outv
    const app = this.owner.app
    let changed = !this.outv || this.ep !== app.ep
    this.ep = app.ep
    if (this.items_()) changed = true
    const v = this.v!, all = this.all, n = all.length, shown = this.shown
    const vis = n ? v.getVirtualIndexes() : NONE, first = n ? v.getVirtualItems()[0] : undefined
    const start = first ? first.start : 0, total = v.getTotalSize()
    const list = (this.vp.role === undefined ? 'list' : this.vp.role) == 'list'
    const lw = this.lw
    if (!lw || lw[0] !== start || lw[1] !== total || lw[2] !== vis[0]) changed = true
    const out: any[] = []
    for (let j = 0; j < shown.length; j++) {
      const inst = shown[j], x = inst.render()
      if (x !== inst.last) { inst.last = x; changed = true }
      // an item without state yet (or a removed one) is left out
      if (x !== undefined) out.push(this.deco(inst, x, vis[j], n, list))
    }
    const data = this.box()
    if (data !== lw?.[3]) changed = true
    if (!changed) return this.outv
    this.lw = [start, total, vis[0], data]
    const win = {sel: 'div', data: {style: {position: 'absolute', top: '0', left: '0', width: '100%', transform: `translateY(${px(start)})`}}, children: out, text: undefined, elm: undefined, key: undefined}
    const spacer = {sel: 'div', data: {style: {position: 'relative', width: '100%', height: px(total)}}, children: [win], text: undefined, elm: undefined, key: undefined}
    return (this.outv = {sel: 'div', data, children: [spacer], text: undefined, elm: undefined, key: this.key})
  }

  dispose() {
    if (this.disposed) return
    super.dispose()
    this.detach()
  }
}

const make = (owner: any, props: Record<string, any>, children: any[], id: string, marker: any) => new VirtualHost(owner, props, children, id, marker)

/**
 * `<VirtualCollection of={Row} from="rows" className="rows" estimateSize={32} overscan={5} />`:
 * a Collection that instantiates only the rows in view (see the module comment)
 */
export const VirtualCollection: any = () => {}
VirtualCollection.__sygnalControl = (props: any, children: any) => {
  hosts[SEL] ||= make
  const {key, children: c, ...p} = props || {}
  const kids = children?.length ? children : c ? [].concat(c) : NONE
  return {sel: SEL, data: {props: p}, children: kids, text: undefined, elm: undefined, key}
}
VirtualCollection.componentName = SEL
