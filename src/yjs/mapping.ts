/*
 * 'sygnal/yjs' (research: dev-plans/research/crdt-state): the mapping between a plain JSON state
 * slice and a Yjs document.
 *
 * Inferred from the value unless a `shape` declares it (shared({ shape }), D: Q1):
 * - a plain object                          -> Y.Map (one LWW register per key)
 * - an array of objects that all have `id`  -> a *collection*: a Y.Map keyed by String(id), each item a
 *   Y.Map of its fields plus `$o`, a fractional order key (`fractional-indexing`); the array is the
 *   items sorted by ($o, id). Concurrent add / edit / move / delete of different items merge; a move
 *   is one register write, so it never duplicates or drops an item, and an edit to a moved item
 *   survives the move. An empty array is ambiguous: a collection unless the field already holds a
 *   list (or the shape says 'list'); without a shape the driver warns once (SYG261, dev).
 * - any other array                         -> Y.Array of JSON values (spliced by common prefix / suffix)
 * - a string field named in `text` / 'text' in the shape -> Y.Text (character-level merge)
 * - anything else                           -> a JSON value in its parent (LWW)
 *
 * write(y, prev, next) turns the *local* change prev -> next into Yjs operations. It is a 3-way
 * write: keys / items the local change didn't touch are left alone even when Yjs holds newer remote
 * values for them, and every write is idempotent against the document's current content (a value
 * Yjs already holds isn't written again), so a prev older than the document never reverts or
 * duplicates a remote change. Items that are the same object as before are skipped without a
 * lookup (index identity first).
 *
 * read(y, path, prev, dirty) reads the slice; with `dirty` (the types a transaction changed) it
 * re-reads only those and keeps prev's objects everywhere else (incremental read).
 */
import * as Y from 'yjs'
import {generateKeyBetween} from 'fractional-indexing'

/** a normalized shape node: k = 't' text, 'l' list, 'c' collection (i: the item's fields), 'm' map (f: fields), 'v' value */
export interface ShapeNode { k?: Kind; f?: Record<string, ShapeNode>; i?: Record<string, ShapeNode> }
export interface MapOptions {
  text?: string[]
  /** an empty array whose kind was guessed (no shape, no kind in the document yet): its path */
  ambiguous?: (path: string) => void
}

const isPlain = (v: any) => v !== null && typeof v == 'object' && Object.getPrototypeOf(v) === Object.prototype
const hasId = (v: any) => isPlain(v) && (typeof v.id == 'string' || typeof v.id == 'number')
const isCollMap = (y: any) => y instanceof Y.Map && y.get('$c') === 1
const same = (a: any, b: any) => a === b || JSON.stringify(a) === JSON.stringify(b)

// ---- shapes ------------------------------------------------------------------------------------
const COLL = Symbol.for('sygnal.yjs.collection')
const KINDS: Record<string, Kind> = {text: 't', list: 'l', collection: 'c', map: 'm', value: 'v'}
/** shape: { items: collection({ text: 'text' }) }: an id-keyed collection whose items have these field shapes */
export const collection = (item: Record<string, any> = {}) => ({[COLL]: item})
/** a public shape ({ title: 'text', items: collection(...), tags: 'list' }) as nodes */
export const normShape = (s: any): ShapeNode | undefined => {
  if (s == null) return undefined
  if (typeof s == 'string') {
    if (!KINDS[s]) throw new TypeError(`shared(): unknown shape '${s}'; use 'text', 'list', 'collection', 'map', 'value', collection({ ... }) or an object of fields`)
    return {k: KINDS[s]}
  }
  if (s[COLL]) return {k: 'c', i: fields(s[COLL])}
  if (isPlain(s)) return {k: 'm', f: fields(s)}
  throw new TypeError('shared(): a shape is a string, collection({ ... }) or an object of fields')
}
const fields = (o: any) => {
  const f: Record<string, ShapeNode> = {}
  for (const k in o) f[k] = normShape(o[k])!
  return f
}
// the item shape of a collection field as a map node (its fields)
const itemNode = (sh?: ShapeNode): ShapeNode | undefined => sh?.i ? {k: 'm', f: sh.i} : undefined

// ---- fractional order keys -----------------------------------------------------------------------
// a key generateKeyBetween accepts (its default base-62 format: a head letter giving the integer
// part's length, 'a' 2 .. 'z' 27 and 'Z' 2 .. 'A' 27, then digits; no fraction ending in '0'); any
// other value (an older document's key) is rekeyed
const B62 = /^[0-9A-Za-z]+$/
const valid = (k: any): k is string => {
  if (typeof k != 'string' || !B62.test(k)) return false
  const c = k.charCodeAt(0), n = c >= 97 ? c - 95 : c <= 90 && c >= 65 ? 92 - c : 0
  return n > 0 && k.length >= n && (k.length == n || k[k.length - 1] != '0') && !/^A0{26}/.test(k)
}

// ---- splices -----------------------------------------------------------------------------------
interface Splice { i: number; del: number; ins: any }
const splice = (a: any, b: any, eq: (x: any, y: any) => boolean): Splice => {
  let i = 0, j = 0
  while (i < a.length && i < b.length && eq(a[i], b[i])) i++
  while (j < a.length - i && j < b.length - i && eq(a[a.length - 1 - j], b[b.length - 1 - j])) j++
  return {i, del: a.length - i - j, ins: b.slice(i, b.length - j)}
}
/**
 * The local splice prev -> next, moved onto a document whose content `cur` differs from prev by a
 * remote splice: shifted when it lies after the remote one, kept when before; an overlapping edit
 * is clamped (approximate; exact when the document matches either side).
 */
const rebase = (l: Splice, prev: any, cur: any, eq: any): Splice => {
  const r = splice(prev, cur, eq)
  if (l.i + l.del <= r.i) return l
  if (l.i >= r.i + r.del) return {...l, i: l.i + r.ins.length - r.del}
  const i = Math.min(l.i, r.i)
  return {i, del: Math.max(0, Math.min(l.del, cur.length - i)), ins: l.ins}
}
// eq compares elements (characters, list values)
const spliceInto = (cur: any, prev: any, next: any, eq: any, apply: (s: Splice) => void) => {
  const all = (a: any, b: any) => a === b || a.length === b.length && splice(a, b, eq).del === 0
  if (all(cur, next)) return                       // already there (a remote change, or no change)
  const l = splice(prev, next, eq)
  apply(all(cur, prev) ? l : rebase(l, prev, cur, eq))
}
const strEq = (a: any, b: any) => a === b

// ---- write -------------------------------------------------------------------------------------
/*
 * Where a value lives. On the slice's object path (the slice itself, its plain-object fields, their
 * plain-object fields, ...: `path` is set) a structured value is a *root-level* shared type named by
 * its path ('board.items#c'), and the parent holds a marker ({ $y: 'c' }). Root-level types are
 * merged by name, so two clients that create `board.items` concurrently (offline, or both seeding an
 * empty document) get one collection with both clients' items. A nested Y.Map set under a key would
 * be a last-writer-wins register: one client's whole collection would be lost (the spike, §3.6).
 * Inside a collection item (`path` undefined) structured values are nested types: an item is created
 * by one client (its id), so the race is rarer, and a nested value there is LWW at creation.
 */
export type Kind = 't' | 'c' | 'm' | 'l' | 'v'
const kindOf = (k: string, n: any, cur: Kind | undefined, o: MapOptions, sh: ShapeNode | undefined, name: string): Kind => {
  const d = sh?.k
  if (d == 't' && typeof n == 'string' || d == 'l' && Array.isArray(n) || d == 'm' && isPlain(n) || d == 'v') return d
  if (d == 'c' && Array.isArray(n) && n.every(hasId)) return 'c'
  if (typeof n == 'string' && o.text?.includes(k)) return 't'
  if (Array.isArray(n) && n.every(hasId)) {
    if (n.length) return 'c'
    if (cur == 'l' || cur == 'c') return cur
    // an empty array the shape doesn't name: a guess (a collection); a list stays a list
    if (!d) o.ambiguous?.(name)
    return 'c'
  }
  return isPlain(n) ? 'm' : Array.isArray(n) ? 'l' : 'v'
}
const nestedKind = (y: any): Kind | undefined =>
  y instanceof Y.Text ? 't' : isCollMap(y) ? 'c' : y instanceof Y.Map ? 'm' : y instanceof Y.Array ? 'l' : undefined
export const rootOf = (doc: Y.Doc, name: string, k: Kind): any =>
  k == 't' ? doc.getText(name + '#t') : k == 'l' ? doc.getArray(name + '#l') : doc.getMap(name + '#' + k)
const clear = (t: any) => {
  if (t instanceof Y.Map) for (const k of [...t.keys()]) t.delete(k)
  else if (t.length) t.delete(0, t.length)
}
const marker = (v: any): Kind | undefined => isPlain(v) && typeof v.$y == 'string' ? v.$y : undefined

/** the local change prev -> next of a map (the slice: writeMap(doc.getMap(key), last, value, o, key, shape)) */
export const writeMap = (y: Y.Map<any>, prev: any, next: any, o: MapOptions, path?: string, sh?: ShapeNode, label = path || ''): void => {
  prev = isPlain(prev) ? prev : {}
  for (const k in prev) if (!(k in next) && y.has(k)) {
    const m = path != null && marker(y.get(k))
    if (m) clear(rootOf(y.doc!, path + '.' + k, m))
    y.delete(k)
  }
  for (const k in next) if (!(k in prev) || prev[k] !== next[k] || !y.has(k)) writeValue(y, k, prev[k], next[k], o, path, sh?.f?.[k], label + '.' + k)
}

const writeValue = (y: Y.Map<any>, k: string, p: any, n: any, o: MapOptions, path: string | undefined, sh: ShapeNode | undefined, label: string): void => {
  const cur = y.get(k), name = path != null ? path + '.' + k : undefined
  const had = name != null ? marker(cur) : nestedKind(cur), want = kindOf(k, n, had, o, sh, label)
  let t: any
  if (name != null) {
    if (had && had != want) clear(rootOf(y.doc!, name, had))
    if (want == 'v') { if (!same(cur, n)) y.set(k, n); return }
    if (had != want) { y.set(k, {$y: want}); p = undefined }
    t = rootOf(y.doc!, name, want)
  } else {
    if (want == 'v') { if (!same(cur, n)) y.set(k, n); return }
    if (had != want) {
      t = want == 't' ? new Y.Text() : want == 'l' ? new Y.Array() : new Y.Map()
      y.set(k, t); if (want == 'c') t.set('$c', 1); p = undefined
    } else t = cur
  }
  if (want == 't') {
    const s = t.toString()
    spliceInto(s, typeof p == 'string' ? p : s, n, strEq, ({i, del, ins}) => { if (del) t.delete(i, del); if (ins) t.insert(i, ins) })
  } else if (want == 'c') writeColl(t, Array.isArray(p) ? p : [], n, o, itemNode(sh), label)
  else if (want == 'm') writeMap(t, p, n, o, name, sh, label)
  else {
    const c = t.toArray()
    spliceInto(c, Array.isArray(p) ? p : c, n, same, ({i, del, ins}) => { if (del) t.delete(i, del); if (ins.length) t.insert(i, ins) })
  }
}

/** a collection: removed ids deleted, new ones added, changed ones written field by field, then order */
const writeColl = (m: Y.Map<any>, prev: any[], next: any[], o: MapOptions, sh: ShapeNode | undefined, label: string): void => {
  const item = (x: any, p: any) => {
    if (p === x) return
    const id = String(x.id), it = m.get(id)
    if (it instanceof Y.Map) { if (p !== x) writeMap(it, p ?? readItem(it), x, o, undefined, sh, label + '[]') }
    // new here. An id this side knew that is gone from the document was deleted remotely while it
    // was edited here: the delete wins (no resurrection)
    else if (!p) { const im = new Y.Map(); m.set(id, im); writeMap(im, {}, x, o, undefined, sh, label + '[]') }
  }
  // the common case (an edit, a toggle): the same ids in the same order. Unchanged items (the same
  // object) are skipped by index, no maps are built and the order is left alone
  if (prev.length == next.length && prev.every((x, i) => x === next[i] || x.id === next[i].id)) {
    for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) item(next[i], prev[i])
    return
  }
  // items added (an add, a paste) and nothing else moved: only the new items get keys, between
  // their neighbours' (the keys order() would give them)
  if (next.length > prev.length) {
    const added: number[] = []
    let j = 0
    for (let i = 0; i < next.length; i++) {
      if (j < prev.length && next[i].id === prev[j].id) item(next[i], prev[j++])
      else added.push(i)
    }
    if (j == prev.length) {
      for (const i of added) item(next[i], undefined)
      if (insertKeys(m, next, added)) return
      return order(m, next)
    }
  }
  const was = new Map(prev.map((x) => [String(x.id), x])), now = new Set(next.map((x) => String(x.id)))
  for (const id of was.keys()) if (!now.has(id) && m.has(id)) m.delete(id)
  for (const x of next) item(x, was.get(String(x.id)))
  // the ids or their order changed here (a local edit never reorders, even when the document holds
  // a remote move this side hasn't seen); removals alone leave the others' order as it was
  let j = 0
  for (const x of prev) if (j < next.length && x.id === next[j].id) j++
  if (j < next.length) order(m, next)
}

// keys for the items at `added` (indexes in next) between their neighbours' keys; false when a
// neighbour's key is missing or out of order here (a remote move): order() then sorts it out
const insertKeys = (m: Y.Map<any>, next: any[], added: number[]): boolean => {
  const keyAt = (i: number) => m.get(String(next[i].id))?.get('$o')
  for (let a = 0; a < added.length; a++) {
    const i = added[a], it = m.get(String(next[i].id))
    if (!(it instanceof Y.Map)) continue
    let lo: string | null = null, hi: string | null = null
    for (let k = i - 1; k >= 0 && lo == null; k--) { const v = keyAt(k); if (v !== undefined) { if (!valid(v)) return false; lo = v } }
    // the next item that isn't new (new ones after this one get keys after it)
    for (let k = i + 1, b = a + 1; k < next.length; k++) {
      if (b < added.length && added[b] == k) { b++; continue }
      const v = keyAt(k)
      if (v === undefined) continue
      if (!valid(v)) return false
      hi = v
      break
    }
    if (lo != null && hi != null && lo >= hi) return false
    const cur = it.get('$o')
    if (!(valid(cur) && (lo == null || cur > lo) && (hi == null || cur < hi))) it.set('$o', generateKeyBetween(lo, hi))
  }
  return true
}

/**
 * The order keys: the longest run of items whose current keys already increase in `next`'s order
 * stays; every other item gets a key between its neighbours (fractional-indexing; deterministic, so
 * two clients seeding the same ids write the same keys). Idempotent: an order the document already
 * has writes nothing; one move writes one key.
 */
const order = (m: Y.Map<any>, next: any[]): void => {
  const items = next.map((x) => m.get(String(x.id))).filter((it) => it instanceof Y.Map)
  const keys = items.map((it) => { const k = it.get('$o'); return valid(k) ? k : undefined })
  const keep = lis(keys)
  let last: string | null = null
  items.forEach((it, i) => {
    if (keep.has(i)) { last = keys[i]!; return }
    let hi: string | null = null
    for (let j = i + 1; j < items.length; j++) if (keep.has(j) && (last == null || keys[j]! > last)) { hi = keys[j]!; break }
    last = generateKeyBetween(last, hi)
    it.set('$o', last)
  })
}
/** indexes of a longest strictly increasing subsequence (undefined keys never kept) */
const lis = (keys: (string | undefined)[]): Set<number> => {
  const tails: number[] = [], prev: number[] = []
  keys.forEach((k, i) => {
    if (k === undefined) return
    let lo = 0, hi = tails.length
    while (lo < hi) { const mid = (lo + hi) >> 1; keys[tails[mid]]! < k ? lo = mid + 1 : hi = mid }
    prev[i] = lo ? tails[lo - 1] : -1
    tails[lo] = i
  })
  const out = new Set<number>()
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.add(i)
  return out
}

// ---- read --------------------------------------------------------------------------------------
/**
 * What one transaction changed, for an incremental read: `types` the changed types and their
 * ancestors, `roots` the names of the root-level types among them, `changed` the transaction's own
 * map (type -> changed keys).
 */
export interface Dirty { types: Set<any>; roots: Set<string>; changed: Map<any, Set<string | null>> }

const dirtyHere = (y: any, path: string | undefined, d: Dirty) => {
  if (d.types.has(y)) return true
  if (path != null) for (const n of d.roots) if (n.startsWith(path + '.')) return true
  return false
}

/**
 * A slice's JSON: read(doc.getMap(key), key). With `d` and `prev` (the previous read), only what
 * the transaction changed is read again; everything else is prev's object.
 */
export const read = (y: any, path?: string, prev?: any, d?: Dirty): any => {
  if (!(y instanceof Y.AbstractType)) return y
  if (d && prev !== undefined && !dirtyHere(y, path, d)) return prev
  if (y instanceof Y.Text) return y.toString()
  if (y instanceof Y.Array) return reconcile(prev, y.toArray().map((v) => read(v)))
  if (y instanceof Y.Map) {
    if (isCollMap(y)) return readColl(y, d && Array.isArray(prev) ? prev : undefined, d)
    const out: any = {}, p = d && isPlain(prev) ? prev : undefined
    y.forEach((v, k) => {
      const m = path != null && marker(v)
      out[k] = !m ? read(v, undefined, p?.[k], d)
        : m == 'c' ? readColl(rootOf(y.doc!, path + '.' + k, m), d && Array.isArray(p?.[k]) ? p![k] : undefined, d)
        : read(rootOf(y.doc!, path + '.' + k, m), path + '.' + k, p?.[k], d)
    })
    // the fields were read against p's: p itself when every one is p's
    if (!p) return out
    let n = 0
    for (const k in out) if (out[k] !== p[k] || !(k in p)) return out; else n++
    return n == Object.keys(p).length ? p : out
  }
  return y
}
const byKey = (a: [string, string, ...any[]], b: [string, string, ...any[]]) =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
const readColl = (y: Y.Map<any>, prev?: any[], d?: Dirty): any[] => {
  if (!d || !prev) {
    const items: [string, string, Y.Map<any>][] = []
    y.forEach((v, k) => { if (v instanceof Y.Map) items.push([v.get('$o') ?? '', k, v]) })
    return items.sort(byKey).map(([, , v]) => readItem(v))
  }
  if (!d.types.has(y)) return prev
  // ids to place again (added, removed, replaced, or a new order key) and items edited in place
  const place = new Set<string>(), edited = new Set<string>()
  for (const k of d.changed.get(y) || []) if (k != null) place.add(k)
  for (const t of d.types) if (t._item?.parent === y && t._item.parentSub != null) {
    const id = t._item.parentSub
    if (d.changed.get(t)?.has('$o')) place.add(id)
    else edited.add(id)
  }
  // prev is sorted by ($o, id): the items that stay keep their order; the placed ones go in by binary search
  const was = new Map<string, any>(), out: any[] = []
  for (const x of prev) {
    const id = String(x.id)
    if (place.has(id)) was.set(id, x)
    else out.push(edited.has(id) ? readItem(y.get(id), x, d) : x)
  }
  if (place.size) {
    const key = (x: any): [string, string] => [y.get(String(x.id))?.get('$o') ?? '', String(x.id)]
    const ins: [string, string, Y.Map<any>][] = []
    for (const id of place) { const v = y.get(id); if (v instanceof Y.Map) ins.push([v.get('$o') ?? '', id, v]) }
    for (const e of ins.sort(byKey)) {
      let lo = 0, hi = out.length
      while (lo < hi) { const mid = (lo + hi) >> 1; byKey(key(out[mid]), e) < 0 ? lo = mid + 1 : hi = mid }
      out.splice(lo, 0, readItem(e[2], was.get(e[1]), d))
    }
  }
  return out.length == prev.length && out.every((x, i) => x === prev[i]) ? prev : out
}
const readItem = (it: Y.Map<any>, prev?: any, d?: Dirty) => {
  const x: any = {}
  it.forEach((v, k) => { if (k != '$o') x[k] = read(v, undefined, prev?.[k], d) })
  return prev ? reconcile(prev, x) : x
}

/** next, reusing prev's objects wherever they are deep-equal (Collection items keep their identity) */
export const reconcile = (prev: any, next: any): any => {
  if (prev === next) return prev
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next
    let byId: Map<any, any> | undefined
    let changed = prev.length != next.length
    const out = next.map((x, i) => {
      // index first; by id only when the items moved
      let p = prev[i]
      if (x === p) return p
      if (hasId(x) && !(hasId(p) && p.id === x.id)) p = (byId ||= new Map(prev.filter(hasId).map((y) => [y.id, y]))).get(x.id)
      const r = reconcile(p, x)
      if (r !== prev[i]) changed = true
      return r
    })
    return changed ? out : prev
  }
  if (isPlain(next)) {
    if (!isPlain(prev)) return next
    let changed = Object.keys(prev).length != Object.keys(next).length
    const out: any = {}
    for (const k in next) { out[k] = reconcile(prev[k], next[k]); if (out[k] !== prev[k] || !(k in prev)) changed = true }
    return changed ? out : prev
  }
  return Object.is(prev, next) ? prev : next
}
