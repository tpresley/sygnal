/*
 * The mapping between a plain JSON state slice and a Yjs document (research spike).
 *
 * Shape-driven, no schema:
 * - a plain object                          -> Y.Map (one LWW register per key)
 * - an array of objects that all have `id`  -> a *collection*: a Y.Map keyed by String(id), each item a
 *   Y.Map of its fields plus `$o`, a fractional order key; the array is the items sorted by ($o, key).
 *   Concurrent add / edit / move / delete of different items merge; a move is one register write,
 *   so it never duplicates or drops an item, and an edit to a moved item survives the move.
 *   An empty array becomes a collection unless the field already holds a Y.Array.
 * - any other array                         -> Y.Array of JSON values (spliced by common prefix / suffix)
 * - a string field named in `text`          -> Y.Text (character-level merge of concurrent edits)
 * - anything else                           -> a JSON value in its parent (LWW)
 *
 * write(y, prev, next) turns the *local* change prev -> next into Yjs operations. It is a 3-way
 * write: keys / items the local change didn't touch are left alone even when Yjs holds newer
 * remote values for them, and every write is idempotent against the document's current content
 * (a value Yjs already holds isn't written again), so a prev that is older than the document never
 * reverts or duplicates a remote change.
 */
import * as Y from 'yjs'

export interface MapOptions { text?: string[] }

const isPlain = (v: any) => v !== null && typeof v == 'object' && Object.getPrototypeOf(v) === Object.prototype
const hasId = (v: any) => isPlain(v) && (typeof v.id == 'string' || typeof v.id == 'number')
const isCollMap = (y: any) => y instanceof Y.Map && y.get('$c') === 1
const same = (a: any, b: any) => a === b || JSON.stringify(a) === JSON.stringify(b)

// ---- fractional order keys ---------------------------------------------------------------------
const D = '0123456789abcdefghijklmnopqrstuvwxyz'
/**
 * A key strictly between a and b ('' = start, null = end); never ends in '0', so one always exists.
 * The spike's own; a real version would depend on `fractional-indexing` (maintained, D209) or Loro-style
 * movable lists.
 */
export const between = (a: string, b: string | null): string => {
  let out = ''
  for (let i = 0; ; i++) {
    const ca = i < a.length ? D.indexOf(a[i]) : 0, cb = b != null && i < b.length ? D.indexOf(b[i]) : 36
    if (ca == cb) { out += D[ca]; continue }
    const mid = cb == 36 ? Math.min(ca + 1, 35) : (ca + cb) >> 1     // appending steps by one: keys grow 1 char per ~35 appends
    if (mid > ca) return out + D[mid]
    out += D[ca]; b = null      // cb == ca + 1: keep ca, then anything above a's remainder
  }
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
 * The local splice prev -> next, moved onto a document whose content `cur` differs from prev by
 * a remote splice: shifted when it lies after the remote one, kept when before; an overlapping
 * edit is clamped (the spike's approximation; a real binding would keep relative positions).
 */
const rebase = (l: Splice, prev: any, cur: any, eq: any): Splice => {
  const r = splice(prev, cur, eq)
  if (l.i + l.del <= r.i) return l
  if (l.i >= r.i + r.del) return {...l, i: l.i + r.ins.length - r.del}
  const i = Math.min(l.i, r.i)
  return {i, del: Math.max(0, Math.min(l.del, cur.length - i)), ins: l.ins}
}
const spliceInto = (cur: any, prev: any, next: any, eq: any, apply: (s: Splice) => void) => {
  if (eq(cur, next)) return                        // already there (a remote change, or no change)
  const l = splice(prev, next, eq)
  apply(eq(cur, prev) ? l : rebase(l, prev, cur, eq))
}
const strEq = (a: any, b: any) => a === b
const arrEq = (a: any, b: any) => a.length === b.length && a.every((x: any, i: number) => same(x, b[i]))

// ---- write -------------------------------------------------------------------------------------
/*
 * Where a value lives. On the slice's object path (the slice itself, its plain-object fields, their
 * plain-object fields, ...: `path` is set) a structured value is a *root-level* shared type named by
 * its path ('board.items#c'), and the parent holds a marker ({ $y: 'c' }). Root-level types are
 * merged by name, so two clients that create `board.items` concurrently (offline, or both seeding an
 * empty document) get one collection with both clients' items. A nested Y.Map set under a key would
 * be a last-writer-wins register: one client's whole collection would be lost (the spike hit this).
 * Inside a collection item (`path` undefined) structured values are nested types: an item is created
 * by one client (its id), so the race is rarer, and a nested value there is LWW at creation.
 */
type Kind = 't' | 'c' | 'm' | 'l' | 'v'
const kindOf = (k: string, n: any, cur: Kind | undefined, o: MapOptions): Kind =>
  typeof n == 'string' && o.text?.includes(k) ? 't'
    : Array.isArray(n) && n.every(hasId) && !(n.length == 0 && cur == 'l') ? 'c'
    : isPlain(n) ? 'm' : Array.isArray(n) ? 'l' : 'v'
const nestedKind = (y: any): Kind | undefined =>
  y instanceof Y.Text ? 't' : isCollMap(y) ? 'c' : y instanceof Y.Map ? 'm' : y instanceof Y.Array ? 'l' : undefined
const rootOf = (doc: Y.Doc, name: string, k: Kind): any =>
  k == 't' ? doc.getText(name + '#t') : k == 'l' ? doc.getArray(name + '#l') : doc.getMap(name + '#' + k)
const clear = (t: any) => {
  if (t instanceof Y.Map) for (const k of [...t.keys()]) t.delete(k)
  else if (t.length) t.delete(0, t.length)
}
const marker = (v: any): Kind | undefined => isPlain(v) && typeof v.$y == 'string' ? v.$y : undefined

export const writeMap = (y: Y.Map<any>, prev: any, next: any, o: MapOptions, path?: string): void => {
  prev = isPlain(prev) ? prev : {}
  for (const k in prev) if (!(k in next) && y.has(k)) {
    const m = path != null && marker(y.get(k))
    if (m) clear(rootOf(y.doc!, path + '.' + k, m))
    y.delete(k)
  }
  for (const k in next) if (!(k in prev) || prev[k] !== next[k] || !y.has(k)) writeValue(y, k, prev[k], next[k], o, path)
}

const writeValue = (y: Y.Map<any>, k: string, p: any, n: any, o: MapOptions, path?: string): void => {
  const cur = y.get(k), name = path != null ? path + '.' + k : undefined
  const had = name != null ? marker(cur) : nestedKind(cur), want = kindOf(k, n, had, o)
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
  } else if (want == 'c') writeColl(t, Array.isArray(p) ? p : [], n, o)
  else if (want == 'm') writeMap(t, p, n, o, name)
  else {
    const c = t.toArray()
    spliceInto(c, Array.isArray(p) ? p : c, n, arrEq, ({i, del, ins}) => { if (del) t.delete(i, del); if (ins.length) t.insert(i, ins) })
  }
}

/** a collection: removed ids deleted, new ones added, changed ones written field by field, then order */
const writeColl = (m: Y.Map<any>, prev: any[], next: any[], o: MapOptions): void => {
  const was = new Map(prev.map((x) => [String(x.id), x])), now = new Set(next.map((x) => String(x.id)))
  for (const id of was.keys()) if (!now.has(id) && m.has(id)) m.delete(id)
  for (const x of next) {
    const id = String(x.id), it = m.get(id), p = was.get(id)
    if (it instanceof Y.Map) { if (p !== x) writeMap(it, p ?? readItem(it), x, o) }
    // new here. An id this side knew that is gone from the document was deleted remotely while it
    // was edited here: the delete wins (no resurrection)
    else if (!p) { const im = new Y.Map(); m.set(id, im); writeMap(im, {}, x, o) }
  }
  // the order pass only when this side's ids or their order changed (a local edit never reorders,
  // even when the document holds a remote move this side hasn't seen)
  if (prev.length != next.length || prev.some((x, i) => x.id !== next[i].id)) order(m, next)
}

/**
 * The order keys: the longest run of items whose current keys already increase in `next`'s order
 * stays; every other item gets a key between its neighbours. Idempotent: an order the document
 * already has writes nothing; one move writes one key.
 */
const order = (m: Y.Map<any>, next: any[]): void => {
  const items = next.map((x) => m.get(String(x.id))).filter((it) => it instanceof Y.Map)
  const keys = items.map((it) => it.get('$o') as string | undefined)
  const keep = lis(keys)
  let last = ''
  items.forEach((it, i) => {
    if (keep.has(i)) { last = keys[i]!; return }
    let hi: string | null = null
    for (let j = i + 1; j < items.length; j++) if (keep.has(j) && keys[j]! > last) { hi = keys[j]!; break }
    last = between(last, hi)
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
/** a slice's JSON: read(doc.getMap(key), key) */
export const read = (y: any, path?: string): any => {
  if (y instanceof Y.Text) return y.toString()
  if (y instanceof Y.Array) return y.toArray().map((v) => read(v))
  if (y instanceof Y.Map) {
    if (isCollMap(y)) return readColl(y)
    const out: any = {}
    y.forEach((v, k) => {
      const m = path != null && marker(v)
      out[k] = !m ? read(v) : m == 'c' ? readColl(rootOf(y.doc!, path + '.' + k, m)) : read(rootOf(y.doc!, path + '.' + k, m), path + '.' + k)
    })
    return out
  }
  return y
}
const readColl = (y: Y.Map<any>) => {
  const items: [string, string, Y.Map<any>][] = []
  y.forEach((v, k) => { if (v instanceof Y.Map) items.push([v.get('$o') ?? '', k, v]) })
  items.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)
  return items.map(([, , v]) => readItem(v))
}
const readItem = (it: Y.Map<any>) => { const {$o, ...x} = read(it); return x }

/** next, reusing prev's objects wherever they are deep-equal (Collection items keep their identity) */
export const reconcile = (prev: any, next: any): any => {
  if (prev === next) return prev
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next
    const byId = new Map(prev.filter(hasId).map((x) => [x.id, x]))
    let changed = prev.length != next.length
    const out = next.map((x, i) => {
      const r = reconcile(hasId(x) ? byId.get(x.id) : prev[i], x)
      if (r !== prev[i]) changed = true
      return r
    })
    return changed ? out : prev
  }
  if (isPlain(next)) {
    if (!isPlain(prev)) return next
    let changed = Object.keys(prev).length != Object.keys(next).length
    const out: any = {}
    for (const k in next) { out[k] = reconcile(prev[k], next[k]); if (out[k] !== prev[k]) changed = true }
    return changed ? out : prev
  }
  return Object.is(prev, next) ? prev : next
}
