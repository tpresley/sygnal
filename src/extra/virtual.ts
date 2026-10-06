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
 *   of the array, so nothing in state is lost; what lives only in the DOM (an uncontrolled input's
 *   text, a running EFFECT) is. Keep row state in the array (the canonical Collection item).
 * - G-401: rows are keyed (a row's element is its own). The row holding the focus stays rendered
 *   while scrolled out (pinned at its own offset, out of the window's flow) until the focus leaves
 *   the list, and no row element is moved in the DOM (a move blurs it in every engine): a window
 *   that loses rows at its front while its end changes is patched in two steps. G-424: the pin
 *   follows the row's key through a reorder (filter, sort, a new array), and a row element a
 *   reorder moves gets the focus back (when it went nowhere; preventScroll; G-462: the element
 *   inside a shadow root in the row when the focus is there).
 * - Row heights: `estimateSize` (a number, or `(item, index) => number`, default 32) until a row is
 *   rendered; then its measured height (ResizeObserver follows later changes, applied in the next
 *   frame: G-402). A 0 measurement (no layout: jsdom) keeps the estimate. A new function at each
 *   render is the same estimate (G-394); a number that changes, or a switch between a number and a
 *   function, re-measures.
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
 *   Whether it grows is measured (G-395, G-427): a max-height that fits the rows bounds it; a
 *   percentage of an unbounded parent, calc() or fit-content that follows the rows doesn't.
 *   G-462: also under an ancestor's CSS zoom, and the measurement doesn't move the page (scroll
 *   anchoring is off around it meanwhile).
 *   Items without `id`: SYG431 (index keys: rows and measured heights follow the position).
 * - `viewTransitionName="row"` names each keyed row's root element as Collection does (`row-<id>`,
 *   class `row`; G-417), as its SSR markup does.
 *
 * Dev text lives in 'sygnal/diagnostics' (checks/virtual.ts), reached through the core bridge as
 * `virtual(code, owner, extra)`; production reports nothing.
 */
import {hosts} from '../core/registry'
import {CollectionHost, named} from '../core/hosts/collection'
import {Inst} from '../core/instance'
import {itemCell, keyName, keyOf} from '../core/cell'
import {chainHooks} from '../pragma/index'
import {Virtualizer, defaultRangeExtractor, elementScroll, observeElementOffset, observeElementRect} from '@tanstack/virtual-core'

const SEL = 'virtual-collection'
/** the container's props (not passed to the items) */
const OWN = /^(estimateSize|overscan|role|tabIndex|style|id|aria-(label|labelledby|describedby))$/
const NONE: any[] = []
/** rows in the window when there is no layout (SSR, mock DOM, jsdom) */
const ROWS0 = 10

const dev = (code: number, owner: any, x?: any): any => (globalThis as any).__SYGNAL_DIAGNOSTICS__?.virtual?.(code, owner, x)

const px = (n: number) => n + 'px'
/** the element with the focus in `el`'s root (its shadow root: G-426), if any */
const act = (el: any): any => el && (el.getRootNode?.() || el.ownerDocument)?.activeElement
/** G-462: the focused element itself when it is inside open shadow roots (`a` is their host) */
const deep = (a: any): any => {
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement
  return a
}
/** the props the container's vnode data is made from (not estimateSize / overscan: G-394) */
const BOX = (x: string) => x != 'estimateSize' && x != 'overscan'
const same = (a: any, b: any, d?: any): boolean => {
  const k = Object.keys(a).filter(x => d || BOX(x))
  return k.length == Object.keys(b).filter(x => d || BOX(x)).length && k.every(x => a[x] === b[x] || !d && x == 'style' && a[x] && b[x] && typeof a[x] == 'object' && same(a[x], b[x], 1))
}
/** an estimate's kind: a number (by value) or 'f' (any function: an inline one is new each render, G-394) */
const kind = (e: any) => (typeof e == 'function' ? 'f' : e)

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
  /** per item instance: [its vnode, index, set size, role, pinned top, the decorated vnode] */
  declare dc: WeakMap<Inst, any[]>
  /** the shown rows' indexes (aligned with `shown`) */
  declare si: number[]
  /** the focused row's key and index (G-401: kept in the range), and the index pinned outside the window */
  declare fk: any
  declare fi: number
  declare pin: number
  /** the range extractor (a new one when the focused row changes: the virtualizer memoizes the range on it) */
  declare re: (r: any) => number[]
  /** the stable estimateSize the virtualizer calls (it reads the current prop, G-394) */
  declare sz: (i: number) => number
  /** a first patch step that only removed rows ran (G-401) */
  declare p1: boolean
  /** the element in the list with the focus before a patch (G-424) */
  declare fa: any
  declare warned: number
  declare un: (() => void) | undefined

  setProps(props: Record<string, any>, children: any[], marker?: any, id?: string) {
    const vp: Record<string, any> = {}, rest: Record<string, any> = {}
    for (const k in props) (OWN.test(k) ? vp : rest)[k] = props[k]
    rest.className = props.className
    if (!this.dc) { this.dc = new WeakMap(); this.all = NONE; this.warned = 0; this.si = []; this.fi = this.pin = -1 }
    const was = this.vp, cls = this.props?.className
    this.vp = vp
    super.setProps(rest, children, marker, id)
    // G-394: the virtualizer reads the estimate through a stable function, so a new inline function
    // keeps the measurements; a number that changes, or a switch between a number and a function,
    // re-measures
    const re = was && kind(vp.estimateSize) !== kind(was.estimateSize)
    if (!was || re || vp.overscan !== was.overscan) this.opts(re)
    // the container's data is made again when its props change (a style object one level deep)
    if (!was || cls !== rest.className || !same(vp, was)) this.cd = undefined
  }

  /** the virtualizer, (re)configured from the props and the current list */
  opts(remeasure?: any) {
    const p = this.vp, est = p.estimateSize, o = p.overscan
    if (est !== undefined && !(typeof est == 'function' || est > 0)) dev(434, this.owner, {prop: 'estimateSize', value: est})
    if (o !== undefined && !(o >= 0)) dev(434, this.owner, {prop: 'overscan', value: o})
    this.sz ||= (i: number) => {
      const e = this.vp.estimateSize, s = typeof e == 'function' ? e(this.itemAt(i), i) : e
      return s > 0 ? s : 32
    }
    this.re ||= (r: any) => this.range(r)
    const opts: any = {
      count: this.all.length,
      getItemKey: this.gk ||= (i: number) => this.all[i],
      getScrollElement: () => this.el,
      estimateSize: this.sz,
      rangeExtractor: this.re,
      // G-402: ResizeObserver results are applied in the next frame (no ResizeObserver loop error)
      useAnimationFrameWithResizeObserver: typeof requestAnimationFrame == 'function',
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

  /**
   * G-401: the default range, plus the focused row when it is outside it (its element must stay:
   * removing it loses the focus). It is pinned at its own offset, out of the window's flow.
   */
  range(r: any): number[] {
    const out = defaultRangeExtractor(r), f = this.fk === undefined ? -1 : this.fi
    this.pin = -1
    if (f >= 0 && f < r.count && out.length && (f < out[0] || f > out[out.length - 1])) {
      this.pin = f
      f < out[0] ? out.unshift(f) : out.push(f)
    }
    return out
  }

  /** the row element (container > spacer > window > row) holding `t`, if any */
  rowOf(t: any): any {
    const el = this.el
    for (let n = t; n && n !== el; n = n.parentNode) if (n.parentNode?.parentNode?.parentNode === el && n.hasAttribute?.('data-index')) return n
  }

  /** the focused row's key changed: a new range (the virtualizer memoizes it on the extractor) */
  focus(k: any) {
    if (k === this.fk || this.disposed) return
    this.fk = k
    this.fi = k === undefined ? -1 : this.all.indexOf(k)
    this.re = (r: any) => this.range(r)
    this.opts()
    this.owner.app.commit()
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
    // G-462: (the rect is scaled by an ancestor's CSS zoom, clientHeight isn't, as the sizes)
    if (vh && total > vh && Math.max(r.height, el.clientHeight || 0) >= total - 1 && this.grows(el)) {
      this.warn(2, {reason: 'grows', height: r.height})
      // G-502: the viewport's height in the rows' px (an ancestor's zoom or scale shrinks the rect,
      // not offsetHeight; no layout: as is)
      const q = el.getBoundingClientRect().height
      return {width: r.width, height: q ? vh * el.offsetHeight / q : vh}
    }
    return r
  }

  /**
   * G-395 / G-427: as tall as its rows and taller than the viewport is "grows" only when its
   * height follows its content. Measured, not parsed (a max-height that is a percentage of an
   * unbounded parent, calc(), fit-content, a flex or grid item): the spacer is made 1e6 px taller
   * for one forced layout and put back before anything renders (no resize is observed); a
   * container that grows with it is unbounded, one bounded by a max-height that fits its rows
   * stops at it. G-462: with scroll anchoring off in the scrollers around it meanwhile (the
   * content after the list moves by 1e6 px and back: the page would move with it, or in WebKit not
   * quite back)
   */
  grows(el: any): boolean {
    const s = el.firstElementChild?.style
    if (!s) return true
    const up: any[] = [], O = 'overflow-anchor'
    // (G-498: a slotted element's scroller can be in the shadow tree: its slot first)
    for (let n = el.assignedSlot || el.parentElement || el.getRootNode?.().host; n?.style; n = n.assignedSlot || n.parentElement || n.getRootNode?.().host) {
      up.push(n, n.style.getPropertyValue(O), n.style.getPropertyPriority(O), n.hasAttribute('style'))
      n.style.setProperty(O, 'none')
    }
    const h = s.height, a = el.offsetHeight
    s.height = (parseFloat(h) || 0) + 1e6 + 'px'
    const b = el.offsetHeight
    s.height = h
    // (laid out again before anchoring is back)
    void el.offsetHeight
    // G-498: put back through the CSSOM (setting the style attribute is blocked under a CSP
    // style-src without 'unsafe-inline'); no style attribute stays none (read first: Chromium and
    // WebKit write the attribute lazily, and would add style="" after the removal)
    for (let i = 0; i < up.length; i += 4) {
      const n = up[i]
      up[i + 1] ? n.style.setProperty(O, up[i + 1], up[i + 2]) : n.style.removeProperty(O)
      if (!up[i + 3]) n.getAttribute('style'), n.removeAttribute('style')
    }
    return b - a > 5e5
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
    let all: any[]
    if (typeof filter != 'function' && !sort && m.size == a.length) { all = [...m.keys()]; this.ls = sort; this.cmp = undefined }
    else all = this.list(a, m)
    this.la = a; this.lf = filter
    // SYG431 (dev only: a pass over the array)
    if (a.length && !(this.warned & 4) && (globalThis as any).__SYGNAL_DIAGNOSTICS__?.virtual && a.some((x, i) => keyOf(x, i)[0] == '\0')) { this.warned |= 4; dev(431, this.owner, {count: a.length}) }
    // G-407: the same keys in the same order (a row edited): the virtualizer keeps its key
    // function, so it doesn't rebuild every row's measurement
    const old = this.all
    if (all.length == old.length && all.every((x, i) => x === old[i])) return false
    this.all = all
    if (this.fk !== undefined) {
      if ((this.fi = all.indexOf(this.fk)) < 0) this.fk = undefined
      // G-424: the focused row's new index (or none): a new extractor, since the virtualizer
      // memoizes the indexes on it and on the range (a reorder can keep both)
      this.re = (r: any) => this.range(r)
    }
    // a new key function: the virtualizer re-reads the keys (its measurements are by key)
    this.gk = (i: number) => this.all[i]
    this.opts()
    return true
  }

  /** the item instances in the window; true when they changed */
  items_(): boolean {
    const kc = this.keys()
    const v = this.v!, app = this.owner.app, o = this.owner, all = this.all
    const vis = all.length ? v.getVirtualIndexes() : NONE
    const want = new Set<any>()
    for (const i of vis) want.add(all[i])
    const prev = this.shown
    // G-401: rows are keyed, and snabbdom moves (detaches: the focus is lost) every kept row when
    // rows leave the front while the end changes too. Then the rows leaving the front are removed
    // in a patch of their own first (the ends match: nothing moves), the rest in the next one
    // (the starts match): a microtask after the first patch, before the frame is painted. The
    // flush may render again before it patches: the first step's rows stay until then.
    if (this.p1 && !kc) return false
    if (!kc && prev.length && vis.length) {
      const k = (j: number) => (prev[j] as any).k
      let h = 0, e = 0
      while (h < prev.length && h < vis.length && k(h) === all[vis[h]]) h++
      for (e = h; e < prev.length && !want.has(k(e)); e++);
      if (e > h && e < prev.length && k(prev.length - 1) !== all[vis[vis.length - 1]]) {
        for (let j = h; j < e; j++) { prev[j].dispose(); this.items.delete(k(j)) }
        this.shown = prev.slice(0, h).concat(prev.slice(e))
        this.si = this.si.slice(0, h).concat(this.si.slice(e))
        this.p1 = true
        queueMicrotask(() => { this.p1 = false; this.disposed || app.commit() })
        return true
      }
    }
    this.p1 = false
    for (const [k, inst] of this.items) if (!want.has(k)) { inst.dispose(); this.items.delete(k) }
    const shown: Inst[] = []
    for (const i of vis) {
      const k = all[i]
      let inst = this.items.get(k)
      if (!inst) {
        const scope = app.scope()
        inst = new Inst(app, this.def, o, itemCell(this.arr!, this.index!, k), o.dom && o.dom.isolateSource(o.dom, scope),
          this.ip, this.kids, scope, this.uidBase + '-' + keyName(k), 'item')
        this.items.set(k, inst);
        (inst as any).k = k
      }
      shown.push(inst)
    }
    const changed = shown.length != prev.length || shown.some((s, i) => s !== prev[i])
    this.shown = shown
    this.si = vis as number[]
    return changed
  }

  clear() {
    super.clear()
    this.all = NONE
    this.si = []
  }

  /** a row's root with its index, ARIA position and measuring hook (the same vnode while nothing changed) */
  deco(inst: Inst, x: any, i: number, n: number, list: boolean, top?: string): any {
    const c = this.dc.get(inst)
    if (c && c[0] === x && c[1] === i && c[2] === n && c[3] === list && c[4] === top) return c[5]
    let out = x
    if (!x.sel) {
      // a fragment or text: nothing to measure or label
      if (!(this.warned & 8)) { this.warned |= 8; dev(432, this.owner, {component: this.def.name}) }
    } else {
      // the position for a row with a role (its own, or listitem in a list): not on a generic element
      const d = x.data || {}, role = d.attrs?.role || d.props?.role, attrs: any = {...d.attrs, 'data-index': i}
      if (list || role) attrs['aria-posinset'] = i + 1, attrs['aria-setsize'] = n
      if (list && !role) attrs.role = 'listitem'
      const data: any = {...d, attrs}
      // G-401: the focused row out of the window, at its own offset (relative to the window)
      if (top !== undefined) data.style = {...d.style, position: 'absolute', top, left: '0', width: '100%'}
      chainHooks(data, {insert: (y: any) => this.v?.measureElement(y.elm)})
      // keyed (G-401): a row's element is its own, not the one at its position before
      out = {...x, data, key: (inst as any).k}
    }
    this.dc.set(inst, [x, i, n, list, top, out])
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
        // G-424: a row element the patch moves (a reorder) loses the focus in every engine: the
        // element in the list that had it gets it back when it is still on the page and the
        // focus went nowhere
        // G-462: none when the cached vnode is patched again (snabbdom calls no postpatch then:
        // nothing would let go of the element); in a shadow root in a row, its focused element
        prepatch: (o: any, y: any) => { const a = o !== y && act(this.el); this.fa = a && this.el.contains(a) ? deep(a) : null },
        // G-500: "went nowhere" is the document's active element (body or none): in a shadow root,
        // the root's own is none when the focus went to an element outside it
        postpatch: (_: any, y: any) => {
          const a = this.fa, b = a?.ownerDocument.activeElement
          this.fa = null
          if (a?.isConnected && (!b || b === a.ownerDocument.body)) a.focus({preventScroll: true})
          y.elm !== this.el && this.attach(y.elm)
        },
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
    // G-401: which row holds the focus (a focusout to outside the list: none)
    const fin = (e: any) => this.focus(this.all[this.rowOf(e.target)?.getAttribute('data-index')])
    // G-428: no relatedTarget while the focus is still in the list: the window lost the focus
    // (another window, devtools), and it comes back to the same element
    const fout = (e: any) => el.contains(e.relatedTarget || act(el)) || this.focus(undefined)
    el.addEventListener('focusin', fin)
    el.addEventListener('focusout', fout)
    const un = this.v!._didMount()
    this.un = () => { un(); el.removeEventListener('focusin', fin); el.removeEventListener('focusout', fout) }
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
    const v = this.v!, all = this.all, n = all.length, shown = this.shown, si = this.si
    const ms: any[] = n && si.length ? (v as any).getMeasurements() : NONE, pin = this.pin
    // the window starts at its first row in the flow (a pinned row is out of it)
    const w0 = si[0] === pin && si.length > 1 ? si[1] : si[0]
    const start = ms[w0] ? ms[w0].start : 0, total = v.getTotalSize()
    const list = (this.vp.role === undefined ? 'list' : this.vp.role) == 'list'
    const lw = this.lw
    if (!lw || lw[0] !== start || lw[1] !== total || lw[2] !== si[0]) changed = true
    const out: any[] = []
    const vn = this.props.viewTransitionName
    for (let j = 0; j < shown.length; j++) {
      const inst = shown[j], x = inst.render(), i = si[j]
      if (x !== inst.last) { inst.last = x; changed = true }
      // an item without state yet (or a removed one) is left out; G-417: named as a Collection's
      if (x !== undefined) out.push(this.deco(inst, vn ? named(inst, x, vn) : x, i, n, list, i === pin && ms[i] ? px(ms[i].start - start) : undefined))
    }
    const data = this.box()
    if (data !== lw?.[3]) changed = true
    if (!changed) return this.outv
    this.lw = [start, total, si[0], data]
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
  // (G-493: `m`, the marker, as the pragma's markers carry it: SYG669 tells it from a plain element)
  return {sel: SEL, data: {props: p, m: VirtualCollection}, children: kids, text: undefined, elm: undefined, key}
}
VirtualCollection.componentName = SEL
