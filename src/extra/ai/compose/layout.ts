/*
 * PLAN-9 K-3: the layout utilities, shared by both backends (phase1-contract.md).
 *
 * Layout: `{ root: 'page', nodes: { [key]: { part, params?, slots?: { [slot]: [key] } } } }`.
 * Node keys are identities: the part id; `part:recordValue` for a record node; repeats `~2`, `~3`;
 * containers by id (`row`, `row~2`, `tabs`). `params` holds only non-default values.
 *
 * - fromTree(catalog, tree, previous?): a nested tree (what a model writes, what tests use) → a
 *   layout. Keys come from `previous` where they can: the same (part, params) first, then the same
 *   identity (a param change keeps the node key, so its instance and state), then new ones.
 *   Children given as an array go into the container's `default` slot (else its first);
 *   `{ slot: [...] }` names them. Not validated: finish() does that.
 * - toTree(layout): the inverse (keys dropped).
 * - removeNode(layout, key): the node and its subtree removed (not finished).
 * - finish(catalog, layout, state): the deterministic finishing step, idempotent:
 *   1. validation (reported, ./diag.ts): an unknown node, part or slot is dropped (SYG250; the
 *      children of an unknown container or slot take its place); an invalid param value falls
 *      back to the default, an invalid or missing record (or a missing required text / list) drops
 *      the node (SYG251); a key listed twice keeps its first place (SYG452; also the cycle guard);
 *   2. then, repeated until nothing changes (at most 6 rounds): required parts (at the end of the
 *      page; parts that need a record or a required text are never added), `companions` (right
 *      after their part), `maxUses`, `in` (a node outside its places moves to its first place
 *      that exists, else into a new container of its first place; rows are transparent: a part
 *      in a row is where the row is; a row in an `arranged` slot or in a row is unwrapped),
 *      `maxDepth` (a container deeper than it moves to the page), `maxParts` (the last
 *      non-required parts go), empty containers removed, `minSlots` (a container with fewer
 *      filled slots is replaced by its children when they may go where it is), a single-part
 *      row unwrapped, then `pin` (start / end of their slot).
 */
import {dev} from './diag'
import type {Catalog, Layout, Node, Part, Tree} from './types'

/** a node of the working tree */
interface T {key: string; part: string; params?: Record<string, any>; slots?: Record<string, T[]>}

const own = (o: any, k: string) => !!o && Object.prototype.hasOwnProperty.call(o, k)
const same = (a: any, b: any) => a === b || (a !== null && typeof a == 'object' && JSON.stringify(a) === JSON.stringify(b))

export const emptyLayout = (): Layout => ({root: 'page', nodes: {page: {part: 'page', slots: {default: []}}}})

/** a node's identity: the part id, or `part:recordValue` for a record part */
export function identityOf(cat: Catalog, part: string, params?: Record<string, any> | null): string {
  const e: any = cat.get(part)
  const r = e?.kind == 'part' && e.record
  return r && params && params[r] != null ? `${part}:${params[r]}` : part
}

/** `base`, else `base~2`, `base~3`, … (the first not in `used`; added to it) */
function uniqueKey(base: string, used: Set<string>): string {
  let k = base
  for (let i = 2; used.has(k); i++) k = `${base}~${i}`
  used.add(k)
  return k
}

/** params without the values equal to their default (undefined when none is left) */
function stripDefaults(cat: Catalog, part: string, params: any): Record<string, any> | undefined {
  if (!params || typeof params != 'object') return
  const e: any = cat.get(part), out: any = {}
  for (const k in params) {
    const d = e?.kind == 'part' && e.params[k]
    if (params[k] === undefined || (d && same(params[k], d.default))) continue
    out[k] = params[k]
  }
  return Object.keys(out).length ? out : undefined
}

/** the working tree → a layout (empty slots omitted, but the page's `default`) */
function emit(root: T): Layout {
  const nodes: Record<string, Node> = {}
  const visit = (t: T): string => {
    const n: Node = {part: t.part}
    if (t.params && Object.keys(t.params).length) n.params = t.params
    if (t.slots) {
      n.slots = {}
      for (const s in t.slots) if (t.slots[s].length || t === root) n.slots[s] = t.slots[s].map(visit)
    }
    nodes[t.key] = n
    return t.key
  }
  visit(root)
  return {root: 'page', nodes}
}

// ------------------------------------------------------------------ fromTree / toTree / removeNode

/** a nested tree → a layout, reusing `previous`'s keys (see the header) */
export function fromTree(cat: Catalog, tree: Tree, previous?: Layout | null): Layout {
  const items: Array<{t: T; base: string; pj: string}> = []
  const build = (n: any): T | null => {
    if (!n || typeof n != 'object' || typeof n.part != 'string') return null
    const e: any = cat.get(n.part)
    const params = stripDefaults(cat, n.part, n.params)
    const t: T = {key: '', part: n.part, ...(params && {params})}
    items.push({t, base: identityOf(cat, n.part, params), pj: JSON.stringify(params ?? {})})
    const ch = n.children
    if (e?.kind == 'container' || ch) {
      t.slots = {}
      const names: string[] = e?.kind == 'container' ? e.slotNames : ['default']
      if (Array.isArray(ch)) t.slots[names.includes('default') ? 'default' : names[0]] = ch.map(build).filter(Boolean) as T[]
      else if (ch && typeof ch == 'object') for (const s in ch) t.slots[s] = (Array.isArray(ch[s]) ? ch[s] : []).map(build).filter(Boolean) as T[]
    }
    return t
  }
  const root: T = {key: 'page', part: 'page', slots: {default: (Array.isArray(tree) ? tree : []).map(build).filter(Boolean) as T[]}}
  const prev = previous?.nodes && typeof previous.nodes == 'object' ? previous.nodes : {}
  const byBase = new Map<string, Array<{k: string; pj: string}>>()
  for (const k in prev) {
    const n = prev[k]
    if (k == (previous!.root || 'page') || !n || typeof n.part != 'string') continue
    const params = stripDefaults(cat, n.part, n.params), b = identityOf(cat, n.part, params)
    if (!byBase.has(b)) byBase.set(b, [])
    byBase.get(b)!.push({k, pj: JSON.stringify(params ?? {})})
  }
  const used = new Set(['page'])
  const take = (match: (x: {k: string; pj: string}, pj: string) => boolean) => {
    for (const it of items) {
      if (it.t.key) continue
      const c = byBase.get(it.base)?.find(x => !used.has(x.k) && match(x, it.pj))
      if (c) { it.t.key = c.k; used.add(c.k) }
    }
  }
  take((x, pj) => x.pj === pj)
  take(() => true)
  for (const it of items) if (!it.t.key) it.t.key = uniqueKey(it.base, used)
  return emit(root)
}

/** a layout → the nested tree (keys dropped; a container with only `default` filled: an array) */
export function toTree(layout: Layout | null | undefined): Tree {
  const nodes: any = layout?.nodes || {}
  const rk: string = layout?.root || 'page', seen = new Set<string>([rk])
  const walk = (k: string): any => {
    const n = nodes[k]
    if (seen.has(k) || !n) return null
    seen.add(k)
    const o: any = {part: n.part}
    if (n.params && Object.keys(n.params).length) o.params = n.params
    if (n.slots) {
      const names = Object.keys(n.slots).filter(s => Array.isArray(n.slots[s]) && n.slots[s].length)
      if (names.length == 1 && names[0] == 'default') o.children = n.slots.default.map(walk).filter(Boolean)
      else if (names.length) {
        o.children = {}
        for (const s of names) o.children[s] = n.slots[s].map(walk).filter(Boolean)
      }
    }
    return o
  }
  return (nodes[rk]?.slots?.default || []).map(walk).filter(Boolean)
}

/** the layout without `key` and its subtree (not finished) */
export function removeNode(layout: Layout, key: string): Layout {
  if (!layout?.nodes || !own(layout.nodes, key) || key == layout.root) return layout
  const drop = new Set<string>()
  const mark = (k: string) => {
    if (drop.has(k)) return
    drop.add(k)
    const s = layout.nodes[k]?.slots
    for (const n in s) (s[n] || []).forEach(mark)
  }
  mark(key)
  const nodes: Record<string, Node> = {}
  for (const k in layout.nodes) {
    if (drop.has(k)) continue
    const n = layout.nodes[k]
    if (!n.slots) { nodes[k] = n; continue }
    const slots: Record<string, string[]> = {}
    for (const s in n.slots) slots[s] = (n.slots[s] || []).filter(c => !drop.has(c))
    nodes[k] = {...n, slots}
  }
  return {...layout, nodes}
}

// ------------------------------------------------------------------ finish

/**
 * a part's params checked against its declaration (SYG251): the non-default values, or null when
 * the node can't exist (no valid record; a required text or list missing)
 */
function checkParams(cat: Catalog, part: Part, raw: any, state: any, key: string): Record<string, any> | null {
  const bad = (msg: string) => dev('SYG251', 'compose', `node '${key}' (${part.id}): ${msg}`)
  const p = raw && typeof raw == 'object' ? raw : {}
  const out: Record<string, any> = {}
  for (const name in p) if (!own(part.params, name)) bad(`unknown param '${name}'; it is dropped`)
  for (const name in part.params) {
    const d: any = part.params[name]
    let v = p[name]
    const needed = d.kind == 'record' || ((d.kind == 'text' || d.kind == 'list') && d.required && d.default === undefined)
    if (v == null || (needed && d.kind == 'text' && v === '')) {
      if (needed) { bad(d.kind == 'record' ? `no record for '${name}'; the node is dropped` : `the required param '${name}' is missing; the node is dropped`); return null }
      continue
    }
    if (d.kind == 'record') {
      const r = cat.records(part, state).find((x: any) => String(x.value) === String(v))
      if (!r) { bad(`'${v}' is not one of the records of '${name}'; the node is dropped`); return null }
      v = r.value
    } else if (d.kind == 'options') {
      if (!own(d.options, String(v))) { bad(`'${v}' is not an option of '${name}'; the default is used`); continue }
    } else if (d.kind == 'number') {
      if (typeof v == 'string' && v.trim() && isFinite(+v)) v = +v
      if (typeof v != 'number' || !isFinite(v)) { bad(`'${name}' is not a number; the default is used`); continue }
      const c = Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, v))
      if (c !== v) { bad(`'${name}' ${v} is outside ${d.min ?? '-∞'}…${d.max ?? '∞'}; it is clamped to ${c}`); v = c }
    } else if (d.kind == 'text') {
      if (typeof v != 'string') { bad(`'${name}' is not text; the default is used`); if (needed) return null; continue }
      if (d.maxLength && v.length > d.maxLength) v = v.slice(0, d.maxLength)
    } else if (d.kind == 'list') {
      if (!Array.isArray(v)) { bad(`'${name}' is not a list; the default is used`); if (needed) return null; continue }
      const n = d.items?.maxLength
      v = v.filter((x: any) => typeof x == 'string').map((x: string) => n && x.length > n ? x.slice(0, n) : x)
      if (d.max != null) v = v.slice(0, d.max)
      if (d.min != null && v.length < d.min) { bad(`'${name}' has fewer than ${d.min} items; the default is used`); if (needed) return null; continue }
    }
    if (!same(v, d.default)) out[name] = v
  }
  return out
}

/** step 1: the layout as a working tree, validated and reported */
function validate(cat: Catalog, layout: any, state: any): T {
  const nodes = layout?.nodes && typeof layout.nodes == 'object' ? layout.nodes : {}
  const rk = typeof layout?.root == 'string' && nodes[layout.root] ? layout.root : 'page'
  const root: T = {key: 'page', part: 'page', slots: {default: []}}
  const seen = new Set([rk, 'page'])
  const place = (keys: any, into: T[]) => { if (Array.isArray(keys)) for (const k of keys) visit(String(k), into) }
  const visit = (k: string, into: T[]) => {
    if (seen.has(k)) {
      dev('SYG452', 'compose', `the layout lists the node key '${k}' ${k == rk ? 'inside the page' : 'twice (or inside itself)'}; only its first place is kept`)
      return
    }
    const n = nodes[k]
    if (!n || typeof n != 'object') { dev('SYG250', 'compose', `the layout lists '${k}', which is not one of its nodes; it is dropped`); return }
    seen.add(k)
    const e: any = cat.get(n.part), kids = n.slots && typeof n.slots == 'object' ? n.slots : null
    if (!e || e.id == 'page') {
      dev('SYG250', 'compose', `node '${k}' names ${e ? 'the page' : `an unknown part '${n.part}'`}; it is dropped${kids ? ' (its children take its place)' : ''}`)
      for (const s in kids) place(kids[s], into)
      return
    }
    if (e.kind == 'part') {
      const params = checkParams(cat, e, n.params, state, k)
      if (params) into.push({key: k, part: e.id, ...(Object.keys(params).length && {params})})
      if (kids && Object.keys(kids).some(s => Array.isArray(kids[s]) && kids[s].length)) {
        dev('SYG250', 'compose', `node '${k}' (${e.id}) is a part, which has no slots; its children take its place`)
        for (const s in kids) place(kids[s], into)
      }
      return
    }
    const t: T = {key: k, part: e.id, slots: {}}
    for (const s of e.slotNames) t.slots![s] = []
    into.push(t)
    for (const s in kids) {
      if (own(e.slots, s)) place(kids[s], t.slots![s])
      else if (Array.isArray(kids[s]) && kids[s].length) {
        dev('SYG250', 'compose', `node '${k}' (${e.id}) has no slot '${s}'; its children go into '${e.slotNames[0]}'`)
        place(kids[s], t.slots![e.slotNames[0]])
      }
    }
  }
  const rs = nodes[rk]?.slots
  for (const s in rs) {
    if (s != 'default' && Array.isArray(rs[s]) && rs[s].length) dev('SYG250', 'compose', `the page has no slot '${s}'; its children go into 'default'`)
    place(rs[s], root.slots!.default)
  }
  return root
}

/** visit every node below the root: (t, its array, index, parent, slot, effective place, depth) */
type Visit = (t: T, arr: T[], i: number, parent: T, slot: string, eff: string, depth: number) => void
function each(root: T, f: Visit) {
  const go = (t: T, eff: (s: string) => string, depth: number) => {
    for (const s in t.slots) {
      const arr = t.slots[s]
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i]
        f(c, arr, i, t, s, eff(s), depth + 1)
        if (c.slots) go(c, c.part == 'row' ? () => eff(s) : (x: string) => c.part + ':' + x, depth + 1)
      }
    }
  }
  go(root, (s: string) => 'page:' + s, 0)
}

const without = (arr: T[], t: T) => { const i = arr.indexOf(t); if (i > -1) arr.splice(i, 1) }

/** a part a finishing step may add (needs no record and no required free text) */
const addable = (p: Part) => !p.record && !Object.values(p.params).some((d: any) => (d.kind == 'text' || d.kind == 'list') && d.required && d.default === undefined)

/** step 2: one round of the deterministic rules */
function round(cat: Catalog, root: T) {
  const used = new Set<string>(['page'])
  each(root, t => { used.add(t.key) })
  const make = (part: string): T => {
    const e: any = cat.get(part)
    const t: T = {key: uniqueKey(part, used), part}
    if (e?.kind == 'container') { t.slots = {}; for (const s of e.slotNames) t.slots[s] = [] }
    return t
  }
  const present = new Set<string>()
  each(root, t => { present.add(t.part) })
  // required parts, then companions
  for (const id in cat.parts) {
    const p = cat.parts[id]
    if (p.required && !present.has(id) && addable(p)) { root.slots!.default.push(make(id)); present.add(id) }
  }
  const leaves: Array<[T, T[]]> = []
  each(root, (t, arr) => { if (!t.slots) leaves.push([t, arr]) })
  for (const [t, arr] of leaves) {
    let at = arr.indexOf(t)
    for (const c of cat.parts[t.part]?.companions || []) {
      if (present.has(c) || !addable(cat.parts[c])) continue
      arr.splice(++at, 0, make(c))
      present.add(c)
    }
  }
  // maxUses
  const uses = new Map<string, number>(), over: Array<[T, T[]]> = []
  each(root, (t, arr) => {
    const p = cat.parts[t.part]
    if (!p) return
    const n = (uses.get(t.part) || 0) + 1
    uses.set(t.part, n)
    if (n > p.maxUses) over.push([t, arr])
  })
  for (const [t, arr] of over) without(arr, t)
  // `in` (rows are transparent; a row in an arranged slot or in a row is unwrapped)
  const moves: Array<[T, T[]]> = [], unwrap: Array<[T, T[]]> = []
  each(root, (t, arr, _i, parent, _s, eff) => {
    if (t.part == 'row') {
      const c: any = cat.get(eff.split(':')[0])
      if (parent.part == 'row' || c?.arranged) unwrap.push([t, arr])
      return
    }
    const e: any = cat.get(t.part)
    if (e && !e.in.includes(eff)) moves.push([t, arr])
  })
  for (const [t, arr] of unwrap) {
    const i = arr.indexOf(t)
    if (i > -1) arr.splice(i, 1, ...(t.slots?.default || []))
  }
  for (const [t, arr] of moves) {
    without(arr, t)
    const e: any = cat.get(t.part)
    let into: T[] | undefined
    for (const pl of e.in) {
      const [c, s] = pl.split(':')
      if (c == 'page') { into = root.slots!.default; break }
      let found: T | undefined
      each(root, x => { if (!found && x.part == c) found = x })
      if (found) { into = found.slots![s] ||= []; break }
    }
    if (!into) {
      const [c, s] = e.in[0].split(':'), ct = make(c)
      root.slots!.default.push(ct)
      into = ct.slots![s]
    }
    into.push(t)
  }
  // maxDepth: a container deeper than it moves to the page
  const deep: Array<[T, T[]]> = []
  each(root, (t, arr, _i, _p, _s, _e, depth) => { if (t.slots && depth > cat.limits.maxDepth) deep.push([t, arr]) })
  for (const [t, arr] of deep) { without(arr, t); root.slots!.default.push(t) }
  // maxParts: the last non-required parts go
  const parts: Array<[T, T[]]> = []
  each(root, (t, arr) => { if (!t.slots) parts.push([t, arr]) })
  for (let n = parts.length, i = parts.length - 1; n > cat.limits.maxParts && i >= 0; i--) {
    const [t, arr] = parts[i]
    if (cat.parts[t.part]?.required) continue
    without(arr, t)
    n--
  }
  // empty containers, minSlots, single-part rows (bottom up)
  const clean = (t: T, effOf: (s: string) => string) => {
    for (const s in t.slots) {
      const out: T[] = [], eff = effOf(s)
      for (const c of t.slots[s]) {
        if (!c.slots) { out.push(c); continue }
        clean(c, c.part == 'row' ? () => eff : (x: string) => c.part + ':' + x)
        const filled = Object.keys(c.slots).filter(x => c.slots![x].length)
        if (!filled.length) continue
        const kids = filled.flatMap(x => c.slots![x])
        if (c.part == 'row' && kids.length == 1) { out.push(...kids); continue }
        const ct: any = cat.get(c.part)
        const fits = kids.every(k => k.part == 'row' || (cat.get(k.part) as any)?.in.includes(eff))
        if (ct?.minSlots && filled.length < ct.minSlots && fits) { out.push(...kids); continue }
        out.push(c)
      }
      t.slots[s] = out
    }
  }
  clean(root, s => 'page:' + s)
  // pins: start first, end last (stable)
  const pin = (t: T) => (cat.parts[t.part]?.pin == 'start' ? 0 : cat.parts[t.part]?.pin == 'end' ? 2 : 1)
  const order = (t: T) => {
    for (const s in t.slots) {
      const a = t.slots[s]
      if (a.some(x => pin(x) != 1)) t.slots[s] = [...a.filter(x => pin(x) == 0), ...a.filter(x => pin(x) == 1), ...a.filter(x => pin(x) == 2)]
      t.slots[s].forEach(x => x.slots && order(x))
    }
  }
  order(root)
}

/** the deterministic finishing step (see the header); idempotent */
export function finish(cat: Catalog, layout: Layout | null | undefined, state?: any): Layout {
  const root = validate(cat, layout, state)
  let last = ''
  for (let i = 0; i < 6; i++) {
    round(cat, root)
    const s = JSON.stringify(root)
    if (s === last) break
    last = s
  }
  return emit(root)
}
