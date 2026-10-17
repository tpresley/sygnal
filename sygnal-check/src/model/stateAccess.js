/**
 * State writes and reads (PLAN-10 A-7): which top-level state keys an action's STATE reducer
 * writes, and which a component's view (and its calculated / context functions) reads.
 *
 * Keys are top-level keys of the component's own state (its lens, its Collection item), never
 * dotted paths: `{ ...state, cart: { ...state.cart, open: true } }` writes 'cart'. A list is what
 * the reducer MAY write (the union over its returns); an empty list means it never changes state
 * (only ABORT, or the state itself); null means the checker can't tell. Nothing is guessed:
 *
 *   reducerWrites(project, file, valueNode, { stateKeys, keyParam }) → string[] | null
 *     valueNode: a model entry's STATE value (a function, a set() / toggle() call, ABORT).
 *     Known: `({ ...state, a, b })` (keys after any number of `...state` spreads and nested
 *     object-literal spreads), `state` / ABORT returns, `set({ a })`, `set((s, d) => ({ a }))`,
 *     `toggle('a')`, a local const holding such an object (not mutated), a local helper called
 *     with the state (`(s, d) => add(s, d)`, depth 3). An object without a `...state` spread
 *     replaces the state: it writes its keys and every other initialState key (stateKeys; null
 *     when those aren't known). Unknown (null): any other spread or computed key, a call into
 *     code it can't see, a non-object return, `return;`, no return at all, `true` (data as state).
 *     opts.out: when given, a reducer that returns `undefined` (`() => undefined`, `void 0`,
 *     `return;`) sets out.removes = true (it removes a Collection item / clears the lensed slice)
 *     and that return writes no key; without it such a return is unknown.
 *     keyParam { index, value }: a parameter holding a known key (a behavior's HOST reducer gets
 *     its uses key as the 6th parameter: `{ ...st, [k]: slice }` writes that key).
 *
 *   behaviorWrites(project, entry, action) → string[] | null
 *     a behavior-owned action ('pager.NEXT'): its STATE reducer writes the slice (the uses key);
 *     a user behavior's HOST reducer is analyzed on the host's state; first-party HOST reducers
 *     are listed (sortable also moves the `from` lists: their literal names, else null).
 *
 *   stateReads(project, file, fn, { state?, index? }) → { keys: string[], partial: boolean } | null
 *     the state keys a function reads through its first parameter (a view's props), or, with
 *     `state: true`, through the parameter `index` (default 0) that IS the state (a calculated /
 *     context function, a local helper the view gives the state: followed to depth 3):
 *     `state.x`, `state?.x`, `state['x']`, `({ state: { x } })`, `const { x } = state`,
 *     `props.state.x`. partial: the state is also used whole or in a way that can't be listed
 *     (passed to a helper or a child, spread, a computed key, a rest pattern).
 */
import { walk, unwrap, isFunction, propName, memberName, stringValue } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from './resolve.js'
import { returnedExpressions } from './intent.js'

const SYGNAL = /^sygnal(\/|$)/

/** The 'sygnal' export an expression is bound to (any local name), or null. */
function sygnalName(file, node) {
  node = unwrap(node)
  if (node?.type !== 'Identifier') return null
  const b = findBinding(file, node.name, node)
  return b?.kind === 'import' && SYGNAL.test(b.source) ? b.imported : null
}

const union = (lists) => {
  const out = []
  for (const l of lists) {
    if (l === null) return null
    for (const k of l) if (!out.includes(k)) out.push(k)
  }
  return out
}

export function reducerWrites(project, file, valueNode, opts = {}) {
  const r = resolveExpr(project, file, valueNode)
  const v = r?.node
  if (!v) return null
  if (isFunction(v)) return fnWrites(project, r.file, v, opts, 0)
  const name = sygnalName(r.file, v)
  if (name === 'ABORT') return []
  if (v.type === 'CallExpression') {
    const helper = sygnalName(r.file, v.callee)
    const arg = v.arguments[0]
    if (helper === 'toggle') {
      const s = arg && stringValue(arg)
      return s != null ? [s] : null
    }
    if (helper === 'set' && arg && arg.type !== 'SpreadElement') {
      const a = resolveExpr(project, r.file, arg)
      if (a?.node?.type === 'ObjectExpression') return objectWrites(project, a.file, a.node, { names: new Set(), partial: true }, opts, 0)
      if (a?.node && isFunction(a.node)) return fnWrites(project, a.file, a.node, { ...opts, partial: true, out: null }, 0)
    }
  }
  return null
}

/** The writes of a reducer function: the union over its returns. */
function fnWrites(project, file, fn, opts, depth, stateIndex = 0) {
  const ctx = { names: new Set(), partial: !!opts.partial, keyParam: null, fn }
  const p0 = fn.params[stateIndex]
  if (p0?.type === 'Identifier') ctx.names.add(p0.name)
  else if (p0?.type === 'AssignmentPattern' && p0.left.type === 'Identifier') ctx.names.add(p0.left.name)
  if (opts.keyParam) {
    const p = fn.params[opts.keyParam.index]
    if (p?.type === 'Identifier') ctx.keyParam = { name: p.name, value: opts.keyParam.value }
  }
  if (fn.body.type === 'BlockStatement') {
    let bare = false
    walk(fn.body, (n) => {
      if (n !== fn.body && isFunction(n)) return false
      if (n.type === 'ReturnStatement' && !n.argument) bare = true
      return true
    })
    if (bare) { if (!opts.out) return null; opts.out.removes = true }
  }
  const rets = returnedExpressions(fn)
  if (!rets.length) return opts.out?.removes ? [] : null
  return union(rets.map(e => exprWrites(project, file, e, ctx, opts, depth)))
}

function isStateRef(ctx, file, n) {
  n = unwrap(n)
  if (n?.type !== 'Identifier' || !ctx.names.has(n.name)) return false
  const b = findBinding(file, n.name, n)
  return b?.kind === 'param' && b.node === ctx.fn
}

function exprWrites(project, file, e, ctx, opts, depth) {
  e = unwrap(e)
  if (!e) return null
  switch (e.type) {
    case 'ConditionalExpression':
      return union([exprWrites(project, file, e.consequent, ctx, opts, depth), exprWrites(project, file, e.alternate, ctx, opts, depth)])
    case 'LogicalExpression':
      return union([exprWrites(project, file, e.left, ctx, opts, depth), exprWrites(project, file, e.right, ctx, opts, depth)])
    case 'SequenceExpression':
      return exprWrites(project, file, e.expressions[e.expressions.length - 1], ctx, opts, depth)
    case 'ObjectExpression':
      return objectWrites(project, file, e, ctx, opts, depth)
    case 'UnaryExpression':
      if (e.operator === 'void' && opts.out) { opts.out.removes = true; return [] }
      return null
    case 'Identifier': {
      if (isStateRef(ctx, file, e)) return []
      if (e.name === 'undefined' && !findBinding(file, e.name, e) && opts.out) { opts.out.removes = true; return [] }
      if (sygnalName(file, e) === 'ABORT') return []
      // a local const holding an object literal that is never mutated
      const b = findBinding(file, e.name, e)
      if (b?.kind === 'var' && b.declKind === 'const' && unwrap(b.init)?.type === 'ObjectExpression' && inside(ctx.fn, b.node) && !mutated(ctx.fn, e.name)) {
        return objectWrites(project, file, unwrap(b.init), ctx, opts, depth)
      }
      return null
    }
    case 'CallExpression': {
      // a local helper called with the state: (s, d) => add(s, d)
      if (depth >= 3) return null
      const callee = unwrap(e.callee)
      if (callee?.type !== 'Identifier') return null
      const i = e.arguments.findIndex(a => isStateRef(ctx, file, a))
      if (i < 0) return null
      const h = resolveExpr(project, file, callee)
      if (!h?.node || !isFunction(h.node)) return null
      if (h.node.params[i]?.type !== 'Identifier') return null
      return fnWrites(project, h.file, h.node, { stateKeys: opts.stateKeys, partial: ctx.partial, out: opts.out }, depth + 1, i)
    }
    default:
      return null
  }
}

function objectWrites(project, file, obj, ctx, opts, depth) {
  const keys = []
  let spread = false
  for (const p of obj.properties) {
    if (p.type === 'SpreadElement') {
      const a = unwrap(p.argument)
      if (isStateRef(ctx, file, a)) { spread = true; continue }
      if (a?.type === 'ObjectExpression') {
        const inner = objectWrites(project, file, a, { ...ctx, partial: true }, opts, depth)
        if (inner === null) return null
        for (const k of inner) if (!keys.includes(k)) keys.push(k)
        continue
      }
      return null
    }
    let k = propName(p)
    if (k == null && p.computed && ctx.keyParam && unwrap(p.key)?.type === 'Identifier' && p.key.name === ctx.keyParam.name) k = ctx.keyParam.value
    if (k == null) return null
    if (!keys.includes(k)) keys.push(k)
  }
  if (spread || ctx.partial) return keys
  // no `...state`: the object replaces the state, so every other key is written (removed) too
  if (!opts.stateKeys) return null
  return union([keys, opts.stateKeys])
}

const inside = (outer, inner) => inner.start >= outer.start && inner.end <= outer.end

/** Is `name` assigned through (`name.x = …`, `delete name.x`, Object.assign(name, …)) in fn? */
function mutated(fn, name) {
  let hit = false
  const isName = (n) => { n = unwrap(n); return n?.type === 'Identifier' && n.name === name }
  const base = (n) => { n = unwrap(n); while (n && (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression')) n = unwrap(n.object); return n }
  walk(fn.body, (n) => {
    if (hit) return false
    if (n.type === 'AssignmentExpression' && (n.left.type === 'MemberExpression') && isName(base(n.left))) hit = true
    else if (n.type === 'UnaryExpression' && n.operator === 'delete' && isName(base(n.argument))) hit = true
    else if (n.type === 'UpdateExpression' && isName(base(n.argument))) hit = true
    else if (n.type === 'CallExpression' && n.arguments.some(isName)) hit = true
    return true
  })
  return hit
}

// First-party behaviors whose model has HOST reducers that write more than the slice
// (src/extra/sortable.ts: INIT / END put the lists back, UP / KEY move items between them;
// DROPPED is ABORT). Every other first-party action writes only its slice.
const FIRST_PARTY_EXTRA = {
  sortable: { option: 'from', actions: new Set(['INIT', 'END', 'UP', 'KEY']), none: new Set(['DROPPED']) },
}

export function behaviorWrites(project, entry, action) {
  const def = entry.def
  if (!def) return null
  const key = entry.key
  if (def.firstParty) {
    const x = FIRST_PARTY_EXTRA[def.name]
    if (x?.none.has(action)) return []
    if (x?.actions.has(action)) {
      const o = entry.options?.get(x.option)
      if (!o) return null
      const r = resolveExpr(project, o.file, o.node)
      const n = r?.node
      const s = n && stringValue(n)
      if (s != null) return [key, s]
      if (n?.type === 'ArrayExpression') {
        const lists = n.elements.map(el => el && stringValue(el))
        return lists.every(l => l != null) ? union([[key], lists]) : null
      }
      return null
    }
    return [key]
  }
  const m = def.analysis?.model
  if (!m?.known) return null
  const lists = []
  for (const e of m.entries) {
    if (e.action !== action) continue
    if (e.stateValue) {
      // the slice reducer writes only the slice (or nothing)
      const w = reducerWrites(project, e.stateValue.file, e.stateValue.node, { partial: false, stateKeys: def.stateKeys })
      lists.push(w && w.length === 0 ? [] : [key])
    }
    if (e.hostValue) lists.push(reducerWrites(project, e.hostValue.file, e.hostValue.node, { stateKeys: null, keyParam: { index: 5, value: key } }))
  }
  return lists.length ? union(lists) : null
}

export function stateReads(project, file, fn, opts = {}) {
  if (!fn || !fn.params) return null
  const keys = []
  let partial = false
  const depth = opts.depth || 0
  const seen = opts.seen || new Set([fn])
  const push = (k) => { if (!keys.includes(k)) keys.push(k) }
  const locals = new Set() // names bound to the state
  let propsName = null
  let first = fn.params[opts.index || 0]
  if (first?.type === 'AssignmentPattern') first = first.left
  const fromPattern = (pat) => {
    for (const p of pat.properties) {
      if (p.type === 'RestElement') { partial = true; continue }
      const k = propName(p)
      if (k) push(k); else partial = true
    }
  }
  if (opts.state) {
    if (first?.type === 'Identifier') locals.add(first.name)
    else if (first?.type === 'ObjectPattern') fromPattern(first)
  } else if (first?.type === 'ObjectPattern') {
    for (const p of first.properties) {
      if (p.type === 'RestElement') continue
      if (p.type !== 'ObjectProperty' || propName(p) !== 'state') continue
      let v = p.value
      if (v.type === 'AssignmentPattern') v = v.left
      if (v.type === 'Identifier') locals.add(v.name)
      else if (v.type === 'ObjectPattern') fromPattern(v)
      else partial = true
    }
  } else if (first?.type === 'Identifier') {
    propsName = first.name
  }
  const isStateRef = (n) => {
    n = unwrap(n)
    if (!n) return false
    if (n.type === 'Identifier') {
      if (!locals.has(n.name)) return false
      const b = findBinding(file, n.name, n)
      return b?.kind === 'param' && b.node === fn
    }
    if (propsName && (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && memberName(n) === 'state') {
      const o = unwrap(n.object)
      if (o.type !== 'Identifier' || o.name !== propsName) return false
      const b = findBinding(file, o.name, o)
      return b?.kind === 'param' && b.node === fn
    }
    return false
  }
  const handled = new Set()
  walk(fn.body, (n) => {
    if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && isStateRef(n.object)) {
      handled.add(unwrap(n.object))
      const k = memberName(n) ?? (n.computed ? stringValue(n.property) : null)
      if (k) push(k); else partial = true
    } else if (n.type === 'VariableDeclarator' && n.id.type === 'ObjectPattern' && isStateRef(n.init)) {
      handled.add(unwrap(n.init))
      fromPattern(n.id)
    }
    return true
  })
  // any other use of the state (passed whole, spread, compared): the list may be incomplete
  walk(fn.body, (n) => {
    if (partial) return false
    if (handled.has(n)) return false
    if (n.type === 'CallExpression' && depth < 3) {
      // a local helper given the state (`panel(state)`): its reads through that parameter
      const i = n.arguments.findIndex(a => isStateRef(a))
      const callee = unwrap(n.callee)
      if (i >= 0 && callee?.type === 'Identifier' && n.arguments.filter(a => isStateRef(a)).length === 1) {
        const h = resolveExpr(project, file, callee)
        if (h?.node && isFunction(h.node) && h.node !== fn && !seen.has(h.node)) {
          seen.add(h.node)
          const sub = stateReads(project, h.file, h.node, { state: true, index: i, depth: depth + 1, seen })
          if (!sub) { partial = true; return false }
          for (const k of sub.keys) push(k)
          if (sub.partial) partial = true
          handled.add(unwrap(n.arguments[i]))
        }
      }
      return true
    }
    if (isStateRef(n)) {
      // props.state as a member object is handled above; `props.state` alone is a whole use
      partial = true
      return false
    }
    return true
  })
  return { keys, partial }
}
