/**
 * CV-3: compiled blocks (dev-plans/research/compile-wasm/compiled-views-plan.md). The compiler
 * (src/vite/compile.ts) emits a block for a row-like subtree as `__cvb.B(def, values, key)` with
 * `def = __cvb.b(fn, kinds)`: `fn(h)` is the subtree's tier-A code with hole i read through `h(i)`,
 * so `fn(i => values[i])` IS the vnode tree the JSX runtime would make (the expansion every non-DOM
 * consumer gets, and the fallback). Hole kinds: 'r' the root's data (always hole 0), 'd' an inner
 * element's data, 't' a text child.
 *
 * On the browser DOM (makeDOMDriver with its default modules: `DOMDriver.blocks`), a block is one
 * vnode: snabbdom makes its root element (and its data, through the modules, as for any vnode),
 * and its create hook appends a clone of the template (the skeleton rendered once by snabbdom with
 * Sygnal's own modules). Afterwards only the holes are patched: text nodes written, and inner data
 * passed to the same modules' create / update. To snabbdom a block is childless, so the diff never
 * walks inside it. For any other driver the core expands blocks first (`registry` below).
 */
import {init} from '../cycle/dom/snabbdom'
import modules from '../cycle/dom/modules'
import {ext} from '../core/registry'
import {sameData} from '../cycle/dom/utils'
import {Plain} from './index'

// (no module-level call or property write here: an app without blocks must drop this module)
const EMPTY: any = {sel: '', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
let patch: any, creates: any[], update: any
const MARK = '\u0001'
const txt = (v: any): string => v == null || v === false || v === true ? '' : '' + v

type Def = {fn: (h: (i: number) => any) => any; kinds: string; ok?: boolean; sel?: string; frag?: any; paths?: number[][]; tags?: string[]; hook?: any; rd?: any; rdh?: any}

// the template: the skeleton (text holes as markers, inner data holes as a data-cvh marker)
// rendered by snabbdom; the hole paths found by walking the skeleton and the DOM together; a
// static prop that a clone doesn't keep (not reflected to an attribute) makes the block a plain
// vnode always (ok: false)
function setup(def: Def): void {
  def.ok = false
  if (typeof document == 'undefined') return
  const k = def.kinds
  const skel = def.fn(i => k[i] == 't' ? MARK + i : k[i] == 'd' ? {dataset: {cvh: '' + i}} : {})
  patch ||= init(modules as any)
  creates ||= modules.map((m: any) => m.create).filter(Boolean)
  update ||= (modules[modules.length - 1] as any).update
  patch(document.createElement('div'), skel)
  const root = skel.elm, copy = root.cloneNode(true)
  const paths: number[][] = [], tags: string[] = []
  let ok = true
  const walk = (v: any, el: any, cp: any, path: number[]): void => {
    const d = v.data
    if (d?.dataset?.cvh !== undefined) { const i = +d.dataset.cvh; paths[i] = path; tags[i] = v.sel; el.removeAttribute('data-cvh') }
    else for (const p in d?.props) if (cp[p] !== el[p]) ok = false
    if (v.text != null) { if (v.text.startsWith(MARK)) paths[+v.text.slice(1)] = path.concat(0), el.firstChild.data = ''; return }
    const c = v.children || []
    for (let i = 0; i < c.length; i++) {
      const x = c[i]
      if (x.sel === undefined) { if (x.text?.startsWith(MARK)) paths[+x.text.slice(1)] = path.concat(i), el.childNodes[i].data = '' }
      else walk(x, el.childNodes[i], cp.childNodes[i], path.concat(i))
    }
  }
  const c = skel.children || []
  if (skel.text != null) { if (skel.text.startsWith(MARK)) paths[+skel.text.slice(1)] = [0], root.firstChild.data = '' }
  else for (let i = 0; i < c.length; i++) {
    const x = c[i]
    if (x.sel === undefined) { if (x.text?.startsWith(MARK)) paths[+x.text.slice(1)] = [i], root.childNodes[i].data = '' }
    else walk(x, root.childNodes[i], copy.childNodes[i], [i])
  }
  if (!ok) return
  const frag = document.createDocumentFragment()
  while (root.firstChild) frag.appendChild(root.firstChild)
  def.frag = frag; def.paths = paths; def.tags = tags; def.sel = skel.sel; def.ok = true
  const at = (elm: any, p: number[]): any => { let n = elm; for (let i = 0; i < p.length; i++) n = n.childNodes[p[i]]; return n }
  const write = (vn: any, fresh: boolean, old?: any): void => {
    const r = vn.r, v = vn.v
    for (let i = 1; i < k.length; i++) {
      if (k[i] == 't') { if (fresh || old.v[i] !== v[i]) r[i].data = txt(v[i]) }
      else if (fresh) { const n = {sel: tags[i], data: v[i], elm: r[i]}; for (const f of creates) f(EMPTY, n) }
      else if (old.v[i] !== v[i]) update({sel: tags[i], data: old.v[i], elm: r[i]}, {sel: tags[i], data: v[i], elm: r[i]})
    }
  }
  const make = (vn: any): void => {
    __cvb.n++
    const elm = vn.elm
    elm.appendChild(frag.cloneNode(true))
    const r = vn.r = new Array(k.length)
    for (let i = 1; i < k.length; i++) r[i] = at(elm, paths[i])
    write(vn, true)
  }
  def.hook = {
    create: (_: any, vn: any) => make(vn),
    // an old vnode that isn't this block's (hydration adopted the server markup): its children are
    // left to the block, which makes its inside again
    prepatch: (old: any) => { if (!old.r) old.children = old.text = undefined },
    update: (old: any, vn: any) => {
      if (!old.r) { vn.elm.textContent = ''; return make(vn) }
      vn.r = old.r
      write(vn, false, old)
    },
  }
}

const expandOne = new WeakMap<any, any>()
/** the vnode tree with every block replaced by its tier-A vnodes (any driver but the browser DOM's) */
export function expand(v: any): any {
  if (!v || typeof v != 'object') return v
  if (v.$b) {
    let x = expandOne.get(v)
    if (!x) { x = v.$b.fn((i: number) => v.v[i]); x.key = v.key; expandOne.set(v, x) }
    return x
  }
  const c = v.children
  if (!c) return v
  let out: any
  for (let i = 0; i < c.length; i++) {
    const e = expand(c[i])
    if (e !== c[i]) (out ||= c.slice())[i] = e
  }
  if (!out) return v
  let x = expandOne.get(v)
  if (!x || x.children.length !== out.length || x.children.some((y: any, i: number) => y !== out[i])) {
    x = Object.assign(Object.create(Object.getPrototypeOf(v)), v, {children: out})
    expandOne.set(v, x)
  }
  return x
}

// the same hole values: text identical, data the same for the DOM modules (made anew each render)
const same = (a: any, b: any): boolean => {
  if (a.$b !== b.$b || a.key !== b.key) return false
  const k = b.$b.kinds, x = a.v, y = b.v
  for (let i = 0; i < k.length; i++) if (x[i] !== y[i] && (k[i] == 't' || !sameData(x[i], y[i]))) return false
  return true
}

/** @internal compiled blocks (sygnal/vite `compile`, production client builds) */
export const __cvb = {
  /** blocks made on the DOM so far (tests) */
  n: 0,
  b: (fn: Def['fn'], kinds: string): Def => (ext.xb ||= expand, ext.sb ||= same, {fn, kinds}),
  B: (def: Def, v: any[], key?: any): any => {
    if (def.ok === undefined) setup(def)
    const k = def.kinds
    let plain = !def.ok
    if (!plain) for (let i = 1; i < k.length; i++) if (k[i] == 't' && v[i] !== null && typeof v[i] == 'object') { plain = true; break }
    if (plain) {
      // the JSX runtime's vnodes; under another key, so snabbdom never patches a block into them
      const x = def.fn(i => v[i])
      x.key = def.ok ? MARK + (key ?? '') : key
      return x
    }
    const rd = v[0]
    const data = rd === def.rd ? def.rdh : (def.rd = rd, def.rdh = {...rd, hook: def.hook})
    const vn = new (Plain as any)(def.sel, data, undefined, undefined, key)
    vn.v = v
    vn.$b = def
    return vn
  },
}
