/**
 * Model analysis: action entries (shorthand expanded), sinks, next('X')
 * targets, EVENTS types returned from EVENTS sinks, and the action names of
 * reply actions of requests (`{ url, ok: 'LOADED', error: 'FAILED' }`, PLAN-3).
 */
import { walk, unwrap, isFunction, propName, stringValue, memberName } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from './resolve.js'
import { returnedExpressions } from './intent.js'

// Actions the core dispatches itself. HYDRATE is not one since 6.0 (D66): nothing dispatches it.
// RESOURCE: written by the core for a `resources` static (PLAN-3 3-A, exp)
export const BUILTIN_ACTIONS = new Set(['BOOTSTRAP', 'INITIALIZE', 'DISPOSE', 'READY', 'RESOURCE'])

/** Request keys that name the action a reply arrives as (reply actions) (PLAN-3 §1.1). */
// PLAN-3 5-4b: a router `{ block: 'CONFIRM_LEAVE' }` names the action a blocked navigation goes to
export const REPLY_KEYS = new Set(['ok', 'error', 'block'])
/**
 * PLAN-6 K-1 (G-614): an LLM request (the chat driver, sygnal/ai) also names `delta` and `tool`
 * reply actions. A request is an LLM one when it has a `messages` key or goes to the LLM sink.
 */
export const LLM_REPLY_KEYS = new Set(['ok', 'error', 'delta', 'tool'])
/**
 * PLAN-11 U-3: an HTTP request (a non-LLM one, where ok / error apply) also names a `progress`
 * reply action (`progress: 'UPLOAD_PROGRESS'`, the fetch driver's upload / download progress).
 * `progress: true` goes to `HTTP.progress()`: not a name. 7.2: a `stream` request's `chunk` names
 * the action each piece arrives as.
 */
export const HTTP_REPLY_KEYS = new Set([...REPLY_KEYS, 'progress', 'chunk'])
export const isLlmRequest = (obj, sink) => sink === 'LLM' ||
  obj.properties.some(p => (p.type === 'ObjectProperty' || p.type === 'ObjectMethod') && propName(p) === 'messages')
/** `connections` entry keys that name actions (PLAN-3 §1.3, D61). */
export const CONNECTION_KEYS = new Set(['message', 'open', 'close', 'error'])
/** Sinks the core handles itself: their values are never requests to a reply-action driver. */
// PLAN-4 GS-2: ELEMENT takes element commands (`{ scrollIntoView: Row, block: 'nearest' }`), not requests
export const NON_REPLY_SINKS = new Set(['STATE', 'EFFECT', 'EVENTS', 'PARENT', 'READY', 'DOM', 'CHILD', 'ELEMENT', 'PERSIST'])

const SHORTHAND = /^(.+?)\s*\|\s*(.+)$/

/** Is `ident` bound to the export `name` of 'sygnal' (any local name)? */
function isSygnalImport(file, ident, name) {
  ident = unwrap(ident)
  if (ident?.type !== 'Identifier') return false
  const b = findBinding(file, ident.name, ident)
  return !!b && b.kind === 'import' && b.imported === name && /^sygnal(\/|$)/.test(b.source)
}

export function splitModelKey(key) {
  const m = SHORTHAND.exec(key)
  return m ? { action: m[1].trim(), sink: m[2].trim(), shorthand: true } : { action: key, sink: null, shorthand: false }
}

/**
 * Types a sink function can emit as `{ type: 'X', ... }`.
 * @returns {{ types: Array<{ type, node }>, dynamic: Array<node> }}
 */
export function eventSinkTypes(project, file, valueNode) {
  const out = { types: [], dynamic: [] }
  const r = resolveExpr(project, file, valueNode)
  const fn = r?.node
  if (!fn) return out
  if (!isFunction(fn)) {
    // emit()/event() calls are collected file-wide; other non-functions are opaque
    const isCall = fn.type === 'CallExpression'
    if (!isCall) out.dynamic.push({ file: r.file, node: valueNode })
    return out
  }
  for (const ret of returnedExpressions(fn)) {
    const objs = []
    const collect = (e) => {
      e = unwrap(e)
      if (!e) return
      if (e.type === 'ConditionalExpression') { collect(e.consequent); collect(e.alternate); return }
      if (e.type === 'LogicalExpression') { collect(e.right); if (e.operator !== '&&') collect(e.left); return }
      objs.push(e)
    }
    collect(ret)
    for (const o of objs) {
      if (o.type === 'ObjectExpression') {
        const t = o.properties.find(p => p.type === 'ObjectProperty' && propName(p) === 'type')
        const s = t && stringValue(t.value)
        if (s != null) out.types.push({ type: s, file: r.file, node: t.value })
        else out.dynamic.push({ file: r.file, node: o })
      } else if (o.type === 'Identifier' && o.name === 'undefined') {
        // no emit
      } else if (o.type === 'NullLiteral' || o.type === 'Identifier' && /^ABORT$/.test(o.name)) {
        // no emit
      } else {
        out.dynamic.push({ file: r.file, node: o })
      }
    }
  }
  return out
}

/** `decide(...)` or `decide.openai(...)` with `decide` imported from 'sygnal/ai' (G-648). */
function isDecideCall(file, call) {
  let callee = unwrap(call.callee)
  if (callee?.type === 'MemberExpression' && !callee.computed && callee.property?.name === 'openai') callee = unwrap(callee.object)
  return isSygnalImport(file, callee, 'decide')
}

/** every key that names a reply action on some request (an object argument with one is a request's options, C-1) */
const ANY_REPLY_KEY = new Set([...HTTP_REPLY_KEYS, ...LLM_REPLY_KEYS])
const hasReplyKey = (obj) => obj.properties.some(p => p.type === 'ObjectProperty' && ANY_REPLY_KEY.has(propName(p)))

/**
 * Object literals a sink value can produce: the object itself, or a function's returns (through
 * ?:, &&, ||), and (PLAN-6 K-1, 0-S5) the returns of a local helper it calls
 * (`LLM: (state) => ask(state.messages)` with `const ask = (messages) => ({ messages, ok: 'DONE' })`),
 * and (G-648) the options object of a `decide({ ..., ok: 'TRIAGED' })` / `decide.openai(...)` call.
 * PLAN-13 C-1: a returned identifier is followed to its const (`HTTP: () => SNAP`), and a returned
 * call's object-literal arguments that hold a reply key are requests too, whatever the callee
 * (`req('/a', { ok: 'GOT_A' })`, `api.get_run(args, { ok: 'RUN' })`, an imported helper).
 */
export function returnedObjects(project, file, valueNode, depth = 0, seen = new Set(), bind = null) {
  const r = resolveExpr(project, file, valueNode)
  const fn = r?.node
  // a local helper followed with its arguments bound (bind) may be called more than once (depth-limited)
  if (!fn || (seen.has(fn) && !bind)) return []
  seen.add(fn)
  const objs = []
  // f: the file of e, b: its parameter bindings (a helper's params → the call's arguments)
  const collect = (e, f, b) => {
    e = unwrap(e)
    if (!e) return
    if (e.type === 'ConditionalExpression') { collect(e.consequent, f, b); collect(e.alternate, f, b); return }
    if (e.type === 'LogicalExpression') { collect(e.right, f, b); if (e.operator !== '&&') collect(e.left, f, b); return }
    if (e.type === 'SequenceExpression') { collect(e.expressions[e.expressions.length - 1], f, b); return }
    if (e.type === 'ObjectExpression') objs.push({ node: e, file: f, bind: b })
    else if (e.type === 'Identifier' && b?.has(e.name)) {
      const a = b.get(e.name)
      collect(a.node, a.file, a.bind)
    } else if (e.type === 'Identifier' && e.name !== 'undefined') {
      // C-1: a const holding the request (or a call that makes it)
      const x = resolveExpr(project, f, e)
      if (x?.node && x.node !== e && !seen.has(x.node) && !isFunction(x.node)) { seen.add(x.node); collect(x.node, x.file, null) }
    } else if (e.type === 'CallExpression' && isDecideCall(f, e)) {
      // G-648: decide() / decide.openai() (sygnal/ai) pass their reply keys through to the request
      const arg = e.arguments[0] && resolveExpr(project, f, e.arguments[0])
      if (arg?.node?.type === 'ObjectExpression') objs.push({ node: arg.node, file: arg.file, bind: arg.node === unwrap(e.arguments[0]) ? b : null })
    } else if (e.type === 'CallExpression') {
      if (depth < 3 && unwrap(e.callee).type === 'Identifier') {
        const h = resolveExpr(project, f, e.callee)
        if (h?.node && isFunction(h.node)) objs.push(...returnedObjects(project, h.file, h.node, depth + 1, seen, bindArgs(h.node, h.file, e, f, b)))
      }
      // C-1: the options passed to a request helper
      for (const a of e.arguments) {
        const x = a.type === 'SpreadElement' ? null : resolveExpr(project, f, a)
        if (x?.node?.type === 'ObjectExpression' && hasReplyKey(x.node) && !objs.some(o => o.node === x.node)) objs.push({ node: x.node, file: x.file, bind: x.node === unwrap(a) ? b : null })
      }
    }
  }
  if (isFunction(fn)) returnedExpressions(fn).forEach(e => collect(e, r.file, bind))
  else collect(fn, r.file, bind)
  return objs
}

/**
 * A helper's parameters bound to a call's arguments (`get('/x', 'LOADED')` with
 * `const get = (url, ok) => ...`: ok → 'LOADED'; a default value when the argument is missing).
 * @returns {Map<string, { node, file, bind }>}
 */
function bindArgs(fn, fnFile, call, file, bind) {
  const m = new Map()
  fn.params.forEach((p, i) => {
    const a = call.arguments[i]
    if (a?.type === 'SpreadElement') return
    if (p.type === 'Identifier' && a) m.set(p.name, { node: a, file, bind })
    else if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') {
      m.set(p.left.name, a ? { node: a, file, bind } : { node: p.right, file: fnFile, bind: null })
    }
  })
  return m
}

const FALSY_LITERAL = (e) => e.type === 'NullLiteral' || e.type === 'BooleanLiteral' ||
  (e.type === 'Identifier' && e.name === 'undefined')

/**
 * The action names a reply key's value can be: string literals through ?:, && and ||/??,
 * a helper's parameter bound to the call's argument (bind), a const string, what a helper
 * returns (`ok: replyOf('GOT')`, its parameters bound), and a key of a const object or of a
 * helper's returned object (`ok: NAMES.loaded`, `ok: names('item').ok`).
 * `false` / `null` / `undefined` (and `true`) name nothing.
 * @returns {{ names: Array<{ name, node, file }>, dynamic: Array<{ node, file }> }}
 */
export function literalNames(project, file, node, bind = null, out = { names: [], dynamic: [] }, depth = 0) {
  const e = unwrap(node)
  if (!e) return out
  const s = stringValue(e)
  if (s != null) { out.names.push({ name: s, node: e, file }); return out }
  if (FALSY_LITERAL(e)) return out
  if (depth > 8) { out.dynamic.push({ node: e, file }); return out }
  if (e.type === 'ConditionalExpression') {
    literalNames(project, file, e.consequent, bind, out, depth + 1)
    literalNames(project, file, e.alternate, bind, out, depth + 1)
    return out
  }
  if (e.type === 'LogicalExpression') {
    // `a && 'X'` is 'X' or a falsy a; `a || 'X'` / `a ?? 'X'` either side
    if (e.operator !== '&&') literalNames(project, file, e.left, bind, out, depth + 1)
    literalNames(project, file, e.right, bind, out, depth + 1)
    return out
  }
  if (e.type === 'Identifier' && bind?.has(e.name)) {
    const a = bind.get(e.name)
    return literalNames(project, a.file, a.node, a.bind, out, depth + 1)
  }
  if (e.type === 'Identifier') {
    const x = resolveExpr(project, file, e)
    if (x?.node && x.node !== e && !isFunction(x.node) && x.node.type !== 'ObjectExpression') return literalNames(project, x.file, x.node, null, out, depth + 1)
  }
  if (e.type === 'CallExpression' && unwrap(e.callee).type === 'Identifier') {
    const h = resolveExpr(project, file, e.callee)
    if (h?.node && isFunction(h.node) && returnedExpressions(h.node).length) {
      const b = bindArgs(h.node, h.file, e, file, bind)
      for (const r of returnedExpressions(h.node)) literalNames(project, h.file, r, b, out, depth + 1)
      return out
    }
  }
  if (e.type === 'MemberExpression' && memberName(e) != null) {
    const v = memberValue(project, file, e, bind, depth)
    if (v) {
      for (const x of v) literalNames(project, x.file, x.node, x.bind, out, depth + 1)
      return out
    }
  }
  out.dynamic.push({ node: e, file })
  return out
}

/**
 * `OBJ.key` / `helper().key`: the property's value in each object the object part can be (a
 * const object literal, a helper's returned object literals), or null when one of them has no
 * such key in sight (a spread, a computed key, a value the checker can't read).
 * @returns {Array<{ node, file, bind }> | null}
 */
function memberValue(project, file, e, bind, depth) {
  const key = memberName(e)
  let objs
  const o = unwrap(e.object)
  if (o.type === 'Identifier' && !bind?.has(o.name)) {
    const x = resolveExpr(project, file, o)
    objs = x?.node?.type === 'ObjectExpression' ? [{ node: x.node, file: x.file, bind: null }] : null
  } else if (o.type === 'CallExpression' && unwrap(o.callee).type === 'Identifier' && depth < 6) {
    const h = resolveExpr(project, file, o.callee)
    if (!h?.node || !isFunction(h.node)) return null
    const b = bindArgs(h.node, h.file, o, file, bind)
    objs = []
    for (const r of returnedExpressions(h.node)) {
      const ro = unwrap(r)
      if (ro?.type !== 'ObjectExpression') return null
      objs.push({ node: ro, file: h.file, bind: b })
    }
  }
  if (!objs?.length) return null
  const out = []
  for (const obj of objs) {
    const props = obj.node.properties
    const i = props.findIndex(x => x.type === 'ObjectProperty' && propName(x) === key)
    // (a later spread may override it)
    if (i < 0 || props.slice(i + 1).some(x => x.type === 'SpreadElement')) return null
    out.push({ node: props[i].value, file: obj.file, bind: obj.bind })
  }
  return out
}

/**
 * A request object's properties with its spreads followed (`{ ...streamRequest(s), key }`: the
 * helper's returned object(s), a const object, an object literal); an unresolvable spread is
 * `dynamic`.
 * @returns {{ props: Array<{ p, file, bind }>, dynamic: Array<{ node, file }> }}
 */
export function requestProps(project, obj, file, bind = null, out = { props: [], dynamic: [] }, seen = new Set()) {
  if (seen.has(obj) || seen.size > 16) return out
  seen.add(obj)
  for (const p of obj.properties) {
    if (p.type === 'ObjectProperty') { out.props.push({ p, file, bind }); continue }
    if (p.type !== 'SpreadElement') continue
    const objs = returnedObjects(project, file, p.argument, 0, new Set(), bind)
    if (!objs.length) { out.dynamic.push({ node: p.argument, file }); continue }
    for (const o of objs) requestProps(project, o.node, o.file, o.bind, out, seen)
  }
  return out
}

/**
 * Reply action names in the requests a sink value returns:
 *   targets  Array<{ name, key, node, file }>   (string literal `ok` / `error` / `progress` values)
 *   dynamic  Array<{ node, file }>              (non-literal values)
 */
/** PLAN-13 C-4: the config's `replyKeys` for a sink (an array: every sink; an object: per sink) */
export const customReplyKeys = (project, sink) => {
  const r = project.replyKeys
  return Array.isArray(r) ? r : (r && sink && r[sink]) || []
}

/** keys that make an object with an unresolvable spread a request */
const REQUEST_KEYS = new Set(['url', 'messages', 'key', 'latest', 'method', 'body', 'query', 'headers', 'stream', 'path', 'href'])

export function replyNames(project, file, valueNode, keys = REPLY_KEYS, sink = null, valueBind = null) {
  const out = { targets: [], dynamic: [], candidates: [] }
  const custom = customReplyKeys(project, sink)
  // a helper's object can be reached twice (its own return and as a spread / options argument)
  const seenNodes = new Set()
  const once = (n) => !seenNodes.has(n) && !!seenNodes.add(n)
  for (const { node: obj, file: f, bind } of returnedObjects(project, file, valueNode, 0, new Set(), valueBind)) {
    let k = keys !== REPLY_KEYS ? keys : isLlmRequest(obj, sink) ? new Set([...keys, ...LLM_REPLY_KEYS]) : HTTP_REPLY_KEYS
    if (custom.length) k = new Set([...k, ...custom])
    const { props, dynamic } = requestProps(project, obj, f, bind)
    // an unresolvable spread may hold reply names, when the object is a request at all
    // (`{ ...s.opts, url }`, not a reducer's `{ ...state, [from]: rows }`)
    if (dynamic.length && props.some(({ p }) => k.has(propName(p)) || REQUEST_KEYS.has(propName(p)))) {
      for (const d of dynamic) if (once(d.node)) out.dynamic.push(d)
    }
    // C-4: an UPPER_CASE value under another key may name a reply action of a custom driver
    for (const { p, file: pf } of props) {
      const key = propName(p), v = key && !k.has(key) && stringValue(p.value)
      if (v && /^[A-Z][A-Z0-9_]*$/.test(v) && once(p.value)) out.candidates.push({ name: v, key, node: p.value, file: pf })
    }
    for (const { p, file: pf, bind: pb } of props) {
      const key = propName(p)
      if (!k.has(key)) continue
      // U-3: `progress: true` (HTTP.progress()) names no action
      if (key === 'progress' && unwrap(p.value)?.type === 'BooleanLiteral') continue
      const v = literalNames(project, pf, p.value, pb)
      for (const n of v.names) if (once(n.node)) out.targets.push({ name: n.name, key, node: n.node, file: n.file })
      for (const d of v.dynamic) if (once(d.node)) out.dynamic.push(d)
    }
  }
  return out
}

/**
 * Action names a `connections` static names (message/open/close/error keys of
 * any object literal inside it, and the values of an SSE `events` map, PLAN-3 §1.3).
 * PLAN-13 C-1: a spec, an `events` map or a whole return held in a const is followed.
 * @returns {{ targets: Array<{ name, key, node, file }>, dynamic: Array<{ node, file }> }}
 */
export function connectionNames(project, file, node, keys = CONNECTION_KEYS) {
  const out = { targets: [], dynamic: [] }
  const r = resolveExpr(project, file, node)
  if (!r?.node) return out
  const seen = new Set([r.node])
  // the object literal a const (in value position) holds, walked as if written in place
  const follow = (e, f) => {
    e = unwrap(e)
    if (e?.type !== 'Identifier') return
    const x = resolveExpr(project, f, e)
    if (x?.node?.type !== 'ObjectExpression' || seen.has(x.node)) return
    seen.add(x.node)
    scan(x.node, x.file)
  }
  const scan = (root, f) => walk(root, (n) => {
    if (n.type === 'ArrowFunctionExpression' && n.body.type !== 'BlockStatement') follow(n.body, f)
    if (n.type === 'ReturnStatement' && n.argument) follow(n.argument, f)
    if (n.type === 'SpreadElement') follow(n.argument, f)
    if (n.type !== 'ObjectProperty') return true
    const key = propName(n)
    // G-163: an SSE spec's `events: { 'price-update': 'PRICE' }` names actions too (connections only)
    if (keys === CONNECTION_KEYS && key === 'events') {
      let ev = unwrap(n.value), ef = f
      if (ev?.type === 'Identifier') {
        const x = resolveExpr(project, f, ev)
        if (x?.node?.type === 'ObjectExpression') { ev = x.node; ef = x.file }
      }
      if (ev?.type === 'ObjectExpression') {
        for (const p of ev.properties) {
          if (p.type !== 'ObjectProperty') continue
          const s = stringValue(p.value)
          if (s != null) out.targets.push({ name: s, key: 'events', node: p.value, file: ef })
          else out.dynamic.push({ node: p.value, file: ef })
        }
        return false
      }
    }
    if (!keys.has(key)) { follow(n.value, f); return true }
    const s = stringValue(n.value)
    if (s != null) out.targets.push({ name: s, key, node: n.value, file: f })
    else out.dynamic.push({ node: n.value, file: f })
    return true
  })
  if (r.node.type === 'Identifier') follow(r.node, r.file)
  else scan(r.node, r.file)
  return out
}

/**
 * The entry object a model entry's value holds when it isn't written in place: a const object
 * (`FETCH: loadEntry`, same module or imported) or a helper call returning one object literal
 * (`FETCH: fetching('GOT')`). null otherwise (a reducer, or a value the checker can't read).
 */
function entryObject(project, file, value) {
  if (isFunction(value)) return null
  const v = unwrap(value)
  if (v?.type === 'Identifier' || v?.type === 'MemberExpression') {
    const x = resolveExpr(project, file, v)
    return x?.node?.type === 'ObjectExpression' ? x : null
  }
  if (v?.type !== 'CallExpression' || unwrap(v.callee).type !== 'Identifier') return null
  const h = resolveExpr(project, file, v.callee)
  if (!h?.node || !isFunction(h.node)) return null
  const rets = returnedExpressions(h.node).map(unwrap)
  // (bind: the helper's parameters, for the reply names its requests take from them)
  return rets.length === 1 && rets[0]?.type === 'ObjectExpression' ? { node: rets[0], file: h.file, bind: bindArgs(h.node, h.file, v, file, null) } : null
}

/**
 * @returns {{
 *   known: boolean,
 *   entries: Array<{ action, sinks: string[], node, key, shorthand,
 *                    stateValue, hostValue }>,   // PLAN-10 A-7: { node, file } of the STATE / HOST
 *                                                // reducer (null when the entry has none)
 *   nextTargets: Array<{ name, node, file }>,
 *   dynamicNext: Array<{ node, file }>,
 *   eventsEmitted: Array<{ type, node, file }>,
 *   eventsDynamic: Array<{ node, file }>,
 *   replyTargets: Array<{ name, key, sink, action, node, file }>,   // ok/error/progress names of requests
 *   replyDynamic: Array<{ node, file }>,
 *   requests: Array<{ node, file, sink, action }>,   // object literals non-STATE sinks return (PLAN-3 5-3)
 *   sinkValues: Array<{ action, sink, node, keyNode, file }>,  // every non-STATE-shorthand sink value (PLAN-4 GS-2: ELEMENT)
 *   computed: Array<{ node, file }>,   // PLAN-7 N-1: computed keys (`[ACTIONS.SAVE]`), not in `entries`
 * }}
 */
export function analyzeModel(project, file, modelNode) {
  const res = { known: true, entries: [], nextTargets: [], dynamicNext: [], eventsEmitted: [], eventsDynamic: [], replyTargets: [], replyDynamic: [], replyCandidates: [], requests: [], sinkValues: [], computed: [] }
  const r = resolveExpr(project, file, modelNode)
  // PLAN-4 GS-8: undoable(model, options) is the model plus UNDO / REDO (src/extra/undo.ts)
  if (r?.node?.type === 'CallExpression' && isSygnalImport(r.file, r.node.callee, 'undoable') && r.node.arguments[0]) {
    const inner = analyzeModel(project, r.file, r.node.arguments[0])
    for (const a of ['UNDO', 'REDO']) {
      if (!inner.entries.some(e => e.action === a)) inner.entries.push({ action: a, sinks: ['STATE'], node: r.node.callee, key: a, shorthand: false, file: r.file })
    }
    return inner
  }
  const obj = r?.node
  if (!obj || obj.type !== 'ObjectExpression') { res.known = false; return res }
  const mfile = r.file

  const addEvents = (valueNode, vfile = mfile) => {
    const t = eventSinkTypes(project, vfile, valueNode)
    res.eventsEmitted.push(...t.types)
    res.eventsDynamic.push(...t.dynamic)
  }
  const addReplies = (action, sink, valueNode, vfile = mfile, bind = null) => {
    if (NON_REPLY_SINKS.has(sink)) return
    const t = replyNames(project, vfile, valueNode, REPLY_KEYS, sink, bind)
    res.replyTargets.push(...t.targets.map(x => ({ ...x, sink, action })))
    res.replyDynamic.push(...t.dynamic)
    res.replyCandidates.push(...t.candidates.map(x => ({ ...x, sink, action })))
    res.requests.push(...returnedObjects(project, vfile, valueNode).filter((o, i, all) => all.findIndex(x => x.node === o.node) === i).map(o => ({ ...o, sink, action })))
  }

  for (const p of obj.properties) {
    if (p.type === 'SpreadElement') { res.known = false; continue }
    const key = propName(p)
    if (key == null) { res.known = false; if (p.computed) res.computed.push({ node: p.key, file: mfile }); continue }
    const { action, sink, shorthand } = splitModelKey(key)
    let value = p.type === 'ObjectMethod' ? p : unwrap(p.value)
    // an entry object shared through a const or made by a helper (`FETCH: loadEntry`)
    const shared = !shorthand && value && value.type !== 'ObjectExpression' ? entryObject(project, mfile, value) : null
    const vfile = shared?.file || mfile
    if (shared) value = shared.node
    let sinks
    // PLAN-10 A-7: the STATE reducer (and a behavior's HOST reducer), for the writes analysis
    let stateValue = null, hostValue = null
    if (shorthand) {
      if (sink === 'STATE') stateValue = { node: value, file: mfile }
      sinks = [sink]
      if (sink === 'EVENTS') addEvents(value)
      addReplies(action, sink, value)
      res.sinkValues.push({ action, sink, node: value, keyNode: p.key, file: mfile })
    } else if (value && value.type === 'ObjectExpression') {
      sinks = []
      for (const sp of value.properties) {
        if (sp.type === 'SpreadElement') continue
        const sname = propName(sp)
        if (!sname) continue
        sinks.push(sname)
        const sval = sp.type === 'ObjectMethod' ? sp : sp.value
        if (sname === 'STATE') stateValue = { node: sp.type === 'ObjectMethod' ? sp : unwrap(sp.value), file: vfile }
        if (sname === 'HOST') hostValue = { node: sp.type === 'ObjectMethod' ? sp : unwrap(sp.value), file: vfile }
        if (sname === 'EVENTS') addEvents(sval, vfile)
        addReplies(action, sname, sp.type === 'ObjectMethod' ? sp : unwrap(sp.value), vfile, shared?.bind)
        res.sinkValues.push({ action, sink: sname, node: sp.type === 'ObjectMethod' ? sp : unwrap(sp.value), keyNode: sp.key, file: vfile })
      }
    } else if (value?.type === 'CallExpression' && isSygnalImport(mfile, value.callee, 'emit')) {
      // `SAVE: emit('SAVED', fn)` is the entry `{ EVENTS: event('SAVED', fn) }`, not a reducer
      sinks = ['EVENTS']
      res.sinkValues.push({ action, sink: 'EVENTS', node: value, keyNode: p.key, file: mfile })
    } else {
      sinks = ['STATE']
      stateValue = { node: value, file: mfile }
    }
    res.entries.push({ action, sinks, node: p.key, key, shorthand, file: mfile, stateValue, hostValue })
  }

  // next('X') targets: inside the model object and any module-level reducer
  // functions it references by name.
  const scanned = new Set(), pushed = new Set()
  const target = (n, f) => {
    if (pushed.has(n)) return
    pushed.add(n)
    const s = stringValue(n.arguments[0])
    if (s != null) res.nextTargets.push({ name: s, node: n.arguments[0], file: f })
    else res.dynamicNext.push({ node: n, file: f })
  }
  // PLAN-13 C-3: a call that passes `next` on (`advance(next, state)`, an imported helper or one
  // in this file): the callee's parameter at that position is `next` there, scanned in the
  // callee's file (3 calls deep). A callee the checker can't read may call anything: dynamic
  const passOn = (n, f, names, depth) => {
    const i = n.arguments.findIndex(a => unwrap(a)?.type === 'Identifier' && names.has(unwrap(a).name))
    if (i < 0 || nextName(n, names)) return
    const h = resolveExpr(project, f, n.callee)
    let p = h?.node && isFunction(h.node) ? h.node.params[i] : null
    if (p?.type === 'AssignmentPattern') p = p.left
    if (p?.type !== 'Identifier') return depth < 3 && res.dynamicNext.push({ node: n, file: f })
    if (depth >= 3 || scanned.has(h.node.body)) return
    scanned.add(h.node.body)
    const inner = new Set([p.name])
    walk(h.node.body, (m) => {
      if (m.type === 'CallExpression') {
        if (nextName(m, inner)) target(m, h.file)
        else passOn(m, h.file, inner, depth + 1)
      }
      return true
    })
  }
  const nextName = (n, names) => {
    const c = unwrap(n.callee)
    return c.type === 'Identifier' && names.has(c.name) && n.arguments.length > 0
  }
  const scanNext = (root, f) => {
    if (!root || scanned.has(root)) return
    scanned.add(root)
    const nextNames = new Set(['next'])
    walk(root, (n) => {
      if (isFunction(n) && n.params.length >= 3 && n.params[2].type === 'Identifier') nextNames.add(n.params[2].name)
      return true
    })
    walk(root, (n) => {
      if (n.type === 'CallExpression') {
        if (nextName(n, nextNames)) target(n, f)
        else passOn(n, f, nextNames, 0)
      }
      if (n.type === 'Identifier' && n !== root) {
        const b = findBinding(f, n.name, n)
        if (b && b.kind === 'function' && f.parents.get(b.node)?.type === 'Program') scanNext(b.node, f)
        else if (b && b.kind === 'var' && isFunction(unwrap(b.init))) {
          const decl = f.parents.get(b.node)
          if (f.parents.get(decl)?.type === 'Program') scanNext(unwrap(b.init), f)
        }
      }
      return true
    })
  }
  scanNext(obj, mfile)
  return res
}
