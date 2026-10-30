// sygnal/replay (7.2 dev preview; research: dev-plans/research/record-replay): the recording
// format's helpers (no core import).
//
// - encode / decode: action data as JSON. A DOM event becomes { $event: type, key?, target? }, an
//   element { $el: TAG, dataset?, id?, value?, checked? } (what reducers read: copyAsTest's stubs),
//   Date / Map / Set / bigint / undefined-in-arrays tagged; a function is lossy ({ $fn: name }).
//   decode turns the stubs back into objects with no-op preventDefault / stopPropagation.
// - stable(v): a canonical string (sorted keys) of a JSON-able value; hash(v): FNV-1a of it.
// - diff(a, b) / patch(a, ops): the state between two checkpoints as [path, value] ops
//   ([path] deletes; [path..., 'length'], n truncates an array).
// - vnodeString(v): a vnode as markup (sel, attrs, props, class, style, dataset, text; no
//   listeners, hooks or isolation scope classes; fragments flattened), what the vnode checkpoints
//   hash.
// - mask(s) / maskAll(v): privacy (letters -> x / X, digits -> 0, everything else kept: length,
//   whitespace and punctuation survive, so trim() / === '' / split(' ') behave the same).

export const isElement = (x: any): any => !!x && typeof x == 'object' && x.nodeType === 1 && typeof x.tagName == 'string'
export const isEvent = (x: any): any => !!x && typeof x == 'object' && typeof x.type == 'string' && typeof x.preventDefault == 'function' && 'target' in x

function elementStub(el: any): any {
  const out: any = { $el: String(el.tagName).toUpperCase() }
  const ds = el.dataset && typeof el.dataset == 'object' ? { ...el.dataset } : {}
  if (Object.keys(ds).length) out.dataset = ds
  if (el.id) out.id = el.id
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(out.$el) && typeof el.value == 'string') out.value = el.value
  if (out.$el == 'INPUT' && /^(checkbox|radio)$/i.test(el.type || '')) out.checked = !!el.checked
  return out
}

const encoded = /*#__PURE__*/ new WeakMap<object, any>()  // plain object / array -> its encoding (state is immutable)

/**
 * action data -> JSON-able (see the module comment); `seen` guards cycles. Plain objects and
 * arrays are memoized by identity: the subtrees a reducer didn't touch are the same objects, so
 * they encode once and diff() skips them by identity (research README §8). A reducer that mutates its
 * state in place defeats this (and Sygnal's own change detection).
 */
export function encode(v: any, seen = new Set<any>()): any {
  if (v && typeof v == 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype)) {
    let e = encoded.get(v)
    if (e === undefined && !seen.has(v)) encoded.set(v, e = encodeOnce(v, seen))
    if (e !== undefined) return e
  }
  return encodeOnce(v, seen)
}

function encodeOnce(v: any, seen: any): any {
  if (v === null || typeof v == 'boolean' || typeof v == 'string') return v
  if (typeof v == 'number') return Number.isFinite(v) && !Object.is(v, -0) ? v : { $num: String(Object.is(v, -0) ? '-0' : v) }
  if (v === undefined) return { $u: 1 }
  if (typeof v == 'bigint') return { $big: String(v) }
  if (typeof v == 'function') return { $fn: v.name || 'anonymous' }
  if (typeof v == 'symbol') return { $sym: String(v) }
  if (seen.has(v)) return { $cycle: 1 }
  if (isElement(v)) return elementStub(v)
  if (isEvent(v)) {
    const out: any = { $event: v.type }
    if (typeof v.key == 'string') out.key = v.key
    if (typeof v.keyCode == 'number' && v.keyCode) out.keyCode = v.keyCode
    if (isElement(v.target)) out.target = elementStub(v.target)
    return out
  }
  seen.add(v)
  try {
    if (Array.isArray(v)) return v.map((x: any) => encode(x, seen))
    if (v instanceof Date) return { $date: isNaN(+v) ? null : v.toISOString() }
    if (v instanceof Map) return { $map: [...v].map(([k, x]: any) => [encode(k, seen), encode(x, seen)]) }
    if (v instanceof Set) return { $set: [...v].map((x: any) => encode(x, seen)) }
    const out: any = {}
    for (const k of Object.keys(v)) if (v[k] !== undefined) out[k] = encode(v[k], seen)
    return out
  } finally { seen.delete(v) }
}

const noop = () => {}
/** the inverse of encode (stubs for events / elements) */
export function decode(v: any): any {
  if (v === null || typeof v != 'object') return v
  if (Array.isArray(v)) return v.map(decode)
  if ('$u' in v) return undefined
  if ('$num' in v) return v.$num == '-0' ? -0 : Number(v.$num)
  if ('$big' in v) return BigInt(v.$big)
  if ('$date' in v) return new Date(v.$date ?? NaN)
  if ('$map' in v) return new Map(v.$map.map(([k, x]: any) => [decode(k), decode(x)]))
  if ('$set' in v) return new Set(v.$set.map(decode))
  if ('$fn' in v || '$sym' in v || '$cycle' in v) return undefined
  const out: any = {}
  for (const k of Object.keys(v)) out[k] = decode(v[k])
  if ('$event' in v) {
    out.type = v.$event
    delete out.$event
    out.preventDefault = out.stopPropagation = out.stopImmediatePropagation = noop
    out.currentTarget = out.target
  } else if ('$el' in v) {
    out.tagName = v.$el
    out.nodeType = 1
    delete out.$el
    out.dataset ||= {}
  }
  return out
}

/** a JSON-able copy of a state (elements / events as stubs), for checkpoints and diffs */
export const plain = (v: any): any => {
  const e = encode(v)
  return e && typeof e == 'object' && '$u' in e ? null : e
}

/** canonical JSON: sorted object keys (a refactor that reorders keys is not a divergence) */
export function stable(v: any): string {
  if (v === null || typeof v != 'object') return v === undefined ? 'null' : JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  return '{' + Object.keys(v).filter((k: any) => v[k] !== undefined).sort().map((k: any) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
}

/** FNV-1a 32-bit of a string, as 8 hex digits */
export function fnv(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}
export const hash = (v: any): any => fnv(stable(plain(v)))

export const isObj = (x: any): any => !!x && typeof x == 'object'

/** the ops that turn `a` into `b` (both JSON-able) */
export function diff(a: any, b: any, path: any[] = [], ops: any[] = []): any[] {
  if (a === b) return ops
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a)) {
      const n = Math.max(a.length, b.length)
      for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], [...path, i], ops)
      for (let i = a.length; i < n; i++) ops.push([[...path, i], b[i]])
      if (b.length < a.length) ops.push([[...path, 'length'], b.length])
      return ops
    }
    for (const k of Object.keys(a)) if (!(k in b)) ops.push([[...path, k]])
    for (const k of Object.keys(b)) diff(a[k], b[k], [...path, k], ops)
    return ops
  }
  if (stable(a) !== stable(b)) ops.push([path, b])
  return ops
}

/** a deep copy of a JSON value */
export const clone = (v: any): any => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

/** `a` with the ops applied (a new value; `a` is not changed) */
export function patch(a: any, ops: any): any {
  let root = clone(a)
  for (const [path, ...rest] of ops) {
    if (!path.length) { root = clone(rest[0]); continue }
    let o = root
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]]
    const k = path[path.length - 1]
    if (!rest.length) delete o[k]
    else o[k] = clone(rest[0])
  }
  return root
}

const same = (s: string) => s
const memos = /*#__PURE__*/ new WeakMap<any, WeakMap<object, string>>()   // text function -> (vnode -> markup)

/**
 * markup of a vnode tree: what the user saw (no listeners, hooks or element refs). Memoized per
 * vnode object: the core reuses the cached vnode of an instance that didn't re-render, so a
 * checkpoint costs what changed, not the whole tree (research README §8).
 */
export function vnodeString(v: any, text: (s: string) => string = same): string {
  if (v == null || v === false) return ''
  if (typeof v != 'object') return text(String(v))
  let memo = memos.get(text)
  if (!memo) memos.set(text, memo = new WeakMap())
  let out: string | undefined = memo.get(v)
  if (out === undefined) memo.set(v, out = markup(v, text))
  return out as string
}

function markup(v: any, text: (s: string) => string): string {
  // a fragment (a Collection's items, a component's injected children): its children in place
  if (v.sel === undefined) return v.children ? v.children.map((c: any) => vnodeString(c, text)).join('') : text(v.text ?? '')
  const d = v.data || {}
  const parts: string[] = []
  // (no keys: the real DOM driver's isolation writes scope keys onto cached vnodes, the mock DOM
  // doesn't, and a key is not something the user sees)
  for (const bucket of ['attrs', 'props', 'class', 'style', 'dataset']) {
    const b = d[bucket]
    if (!b || typeof b != 'object') continue
    for (const k of Object.keys(b).sort()) {
      const x = b[k]
      if (typeof x == 'function' || (x && typeof x == 'object')) continue
      parts.push(`${bucket[0]}:${k}=${JSON.stringify(typeof x == 'string' ? text(x) : x)}`)
    }
  }
  const kids = v.children ? v.children.map((c: any) => vnodeString(c, text)).join('') : v.text != null ? text(v.text) : ''
  // the isolation scope classes (div.___s4) depend on creation order, not on what is shown
  return `<${v.sel.replace(/\.___[\w-]+/g, '')}${parts.length ? ' ' + parts.join(' ') : ''}>${kids}</>`
}

/** letters -> x / X, digits -> 0; length, whitespace and punctuation kept */
export const mask = (s: string): string => s.replace(/[\p{L}\p{N}]/gu, (c: string) => /\p{N}/u.test(c) ? '0' : /\p{Lu}/u.test(c) ? 'X' : 'x')

const masked = /*#__PURE__*/ new WeakMap<object, any>()
/** every string in a JSON-able value masked (keys kept); memoized by identity, as encode() */
export function maskAll(v: any): any {
  if (typeof v == 'string') return mask(v)
  if (!isObj(v)) return v
  let m = masked.get(v)
  if (m === undefined) masked.set(v, m = maskOnce(v))
  return m
}
function maskOnce(v: any): any {
  if (Array.isArray(v)) return v.map(maskAll)
  const out: any = {}
  for (const k of Object.keys(v)) out[k] = k.startsWith('$') ? v[k] : maskAll(v[k])
  return out
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz', UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', DIGITS = '0123456789'
/**
 * Format-preserving pseudonymization: each letter / digit replaced by one of the same class
 * (case kept), chosen from a hash of (salt, the whole string, the position). The same string
 * always gives the same token within a recording and two strings almost never collide, so
 * equality survives (ids in a server reply, then in the dataset of what was clicked), unlike
 * mask(). The salt is not stored: the tokens can't be reversed from the log.
 */
export function pseudo(s: any, salt: any): any {
  const base = fnv(salt + '\u0000' + s)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const set = /\p{N}/u.test(c) ? DIGITS : /\p{Lu}/u.test(c) ? UPPER : /\p{L}/u.test(c) ? LOWER : null
    out += set ? set[parseInt(fnv(base + i), 16) % set.length] : c
  }
  return out
}

/**
 * The redaction of an input action's (encoded) data: its strings pseudonymized; event types and
 * keys (Enter, Escape) and element datasets (ids the app rendered) kept, so the replay takes the
 * same branches.
 */
export function redactInput(v: any, salt: string, key?: string): any {
  if (typeof v == 'string') return key === '$event' || key === 'key' || key === '$el' ? v : pseudo(v, salt)
  if (!isObj(v)) return v
  if (Array.isArray(v)) return v.map((x: any) => redactInput(x, salt))
  const out: any = {}
  for (const k of Object.keys(v)) out[k] = k === 'dataset' ? v[k] : redactInput(v[k], salt, k)
  return out
}

/** a DOM event a user types text with: an input event of a text field, a keydown in one, a form submit */
export function isTextEntry(e: any): boolean {
  if (!e || typeof e != 'object') return false
  if (e.type === 'submit') return true
  const t = e.target
  if (!t || typeof t.tagName != 'string') return false
  const tag = t.tagName.toUpperCase()
  if (tag === 'TEXTAREA' || t.isContentEditable) return true
  return tag === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file|image|hidden)$/i.test(t.type || '')
}
