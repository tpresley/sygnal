/**
 * Model analysis: action entries (shorthand expanded), sinks, next('X')
 * targets, EVENTS types returned from EVENTS sinks, and the action names of
 * reply actions of requests (`{ url, ok: 'LOADED', error: 'FAILED' }`, PLAN-3).
 */
import { walk, unwrap, isFunction, propName, stringValue } from '../ast.js'
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
 * `progress: true` goes to `HTTP.progress()`: not a name.
 */
export const HTTP_REPLY_KEYS = new Set([...REPLY_KEYS, 'progress'])
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
export function returnedObjects(project, file, valueNode, depth = 0, seen = new Set()) {
  const r = resolveExpr(project, file, valueNode)
  const fn = r?.node
  if (!fn || seen.has(fn)) return []
  seen.add(fn)
  const objs = []
  const collect = (e, f) => {
    e = unwrap(e)
    if (!e) return
    if (e.type === 'ConditionalExpression') { collect(e.consequent, f); collect(e.alternate, f); return }
    if (e.type === 'LogicalExpression') { collect(e.right, f); if (e.operator !== '&&') collect(e.left, f); return }
    if (e.type === 'SequenceExpression') { collect(e.expressions[e.expressions.length - 1], f); return }
    if (e.type === 'ObjectExpression') objs.push({ node: e, file: f })
    else if (e.type === 'Identifier' && e.name !== 'undefined') {
      // C-1: a const holding the request (or a call that makes it)
      const x = resolveExpr(project, f, e)
      if (x?.node && x.node !== e && !seen.has(x.node) && !isFunction(x.node)) { seen.add(x.node); collect(x.node, x.file) }
    } else if (e.type === 'CallExpression' && isDecideCall(f, e)) {
      // G-648: decide() / decide.openai() (sygnal/ai) pass their reply keys through to the request
      const arg = e.arguments[0] && resolveExpr(project, f, e.arguments[0])
      if (arg?.node?.type === 'ObjectExpression') objs.push({ node: arg.node, file: arg.file })
    } else if (e.type === 'CallExpression') {
      if (depth < 3 && unwrap(e.callee).type === 'Identifier') {
        const h = resolveExpr(project, f, e.callee)
        if (h?.node && isFunction(h.node)) objs.push(...returnedObjects(project, h.file, h.node, depth + 1, seen))
      }
      // C-1: the options passed to a request helper
      for (const a of e.arguments) {
        const x = a.type === 'SpreadElement' ? null : resolveExpr(project, f, a)
        if (x?.node?.type === 'ObjectExpression' && hasReplyKey(x.node) && !objs.some(o => o.node === x.node)) objs.push({ node: x.node, file: x.file })
      }
    }
  }
  if (isFunction(fn)) returnedExpressions(fn).forEach(e => collect(e, r.file))
  else collect(fn, r.file)
  return objs
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

export function replyNames(project, file, valueNode, keys = REPLY_KEYS, sink = null) {
  const out = { targets: [], dynamic: [], candidates: [] }
  const custom = customReplyKeys(project, sink)
  for (const { node: obj, file: f } of returnedObjects(project, file, valueNode)) {
    let k = keys !== REPLY_KEYS ? keys : isLlmRequest(obj, sink) ? new Set([...keys, ...LLM_REPLY_KEYS]) : HTTP_REPLY_KEYS
    if (custom.length) k = new Set([...k, ...custom])
    // C-4: an UPPER_CASE value under another key may name a reply action of a custom driver
    for (const p of obj.properties) {
      const key = p.type === 'ObjectProperty' && propName(p), v = key && !k.has(key) && stringValue(p.value)
      if (v && /^[A-Z][A-Z0-9_]*$/.test(v)) out.candidates.push({ name: v, key, node: p.value, file: f })
    }
    for (const p of obj.properties) {
      if (p.type !== 'ObjectProperty') continue
      const key = propName(p)
      if (!k.has(key)) continue
      // U-3: `progress: true` (HTTP.progress()) names no action
      if (key === 'progress' && unwrap(p.value)?.type === 'BooleanLiteral') continue
      const s = stringValue(p.value)
      if (s != null) out.targets.push({ name: s, key, node: p.value, file: f })
      else out.dynamic.push({ node: p.value, file: f })
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

  const addEvents = (valueNode) => {
    const t = eventSinkTypes(project, mfile, valueNode)
    res.eventsEmitted.push(...t.types)
    res.eventsDynamic.push(...t.dynamic)
  }
  const addReplies = (action, sink, valueNode) => {
    if (NON_REPLY_SINKS.has(sink)) return
    const t = replyNames(project, mfile, valueNode, REPLY_KEYS, sink)
    res.replyTargets.push(...t.targets.map(x => ({ ...x, sink, action })))
    res.replyDynamic.push(...t.dynamic)
    res.replyCandidates.push(...t.candidates.map(x => ({ ...x, sink, action })))
    res.requests.push(...returnedObjects(project, mfile, valueNode).map(o => ({ ...o, sink, action })))
  }

  for (const p of obj.properties) {
    if (p.type === 'SpreadElement') { res.known = false; continue }
    const key = propName(p)
    if (key == null) { res.known = false; if (p.computed) res.computed.push({ node: p.key, file: mfile }); continue }
    const { action, sink, shorthand } = splitModelKey(key)
    const value = p.type === 'ObjectMethod' ? p : unwrap(p.value)
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
        if (sname === 'STATE') stateValue = { node: sp.type === 'ObjectMethod' ? sp : unwrap(sp.value), file: mfile }
        if (sname === 'HOST') hostValue = { node: sp.type === 'ObjectMethod' ? sp : unwrap(sp.value), file: mfile }
        if (sname === 'EVENTS') addEvents(sval)
        addReplies(action, sname, sp.type === 'ObjectMethod' ? sp : unwrap(sp.value))
        res.sinkValues.push({ action, sink: sname, node: sp.type === 'ObjectMethod' ? sp : unwrap(sp.value), keyNode: sp.key, file: mfile })
      }
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
