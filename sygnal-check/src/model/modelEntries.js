/**
 * Model analysis: action entries (shorthand expanded), sinks, next('X')
 * targets, EVENTS types returned from EVENTS sinks, and the action names of
 * routed requests (`{ url, ok: 'LOADED', error: 'FAILED' }`, PLAN-3).
 */
import { walk, unwrap, isFunction, propName, stringValue } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from './resolve.js'
import { returnedExpressions } from './intent.js'

// Actions the core dispatches itself. HYDRATE is not one since 6.0 (D66): nothing dispatches it.
export const BUILTIN_ACTIONS = new Set(['BOOTSTRAP', 'INITIALIZE', 'DISPOSE', 'READY'])

/** Request keys that name the action a routed reply arrives as (PLAN-3 §1.1). */
export const ROUTED_KEYS = new Set(['ok', 'error'])
/** `connections` entry keys that name actions (PLAN-3 §1.3, D61). */
export const CONNECTION_KEYS = new Set(['message', 'open', 'close', 'error'])
/** Sinks the core handles itself: their values are never requests to a routing driver. */
export const NON_ROUTING_SINKS = new Set(['STATE', 'EFFECT', 'EVENTS', 'PARENT', 'READY', 'DOM', 'CHILD'])

const SHORTHAND = /^(.+?)\s*\|\s*(.+)$/

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

/** Object literals a sink value can produce: the object itself, or a function's returns (through ?:, &&, ||). */
export function returnedObjects(project, file, valueNode) {
  const r = resolveExpr(project, file, valueNode)
  const fn = r?.node
  if (!fn) return []
  const objs = []
  const collect = (e) => {
    e = unwrap(e)
    if (!e) return
    if (e.type === 'ConditionalExpression') { collect(e.consequent); collect(e.alternate); return }
    if (e.type === 'LogicalExpression') { collect(e.right); if (e.operator !== '&&') collect(e.left); return }
    if (e.type === 'SequenceExpression') { collect(e.expressions[e.expressions.length - 1]); return }
    if (e.type === 'ObjectExpression') objs.push({ node: e, file: r.file })
  }
  if (isFunction(fn)) returnedExpressions(fn).forEach(collect)
  else collect(fn)
  return objs
}

/**
 * Routed action names in the requests a sink value returns:
 *   targets  Array<{ name, key, node, file }>   (string literal `ok` / `error` values)
 *   dynamic  Array<{ node, file }>              (non-literal values)
 */
export function routedNames(project, file, valueNode, keys = ROUTED_KEYS) {
  const out = { targets: [], dynamic: [] }
  for (const { node: obj, file: f } of returnedObjects(project, file, valueNode)) {
    for (const p of obj.properties) {
      if (p.type !== 'ObjectProperty') continue
      const key = propName(p)
      if (!keys.has(key)) continue
      const s = stringValue(p.value)
      if (s != null) out.targets.push({ name: s, key, node: p.value, file: f })
      else out.dynamic.push({ node: p.value, file: f })
    }
  }
  return out
}

/**
 * Action names a `connections` static names (message/open/close/error keys of
 * any object literal inside it, PLAN-3 §1.3).
 * @returns {{ targets: Array<{ name, key, node, file }>, dynamic: Array<{ node, file }> }}
 */
export function connectionNames(project, file, node) {
  const out = { targets: [], dynamic: [] }
  const r = resolveExpr(project, file, node)
  if (!r?.node) return out
  walk(r.node, (n) => {
    if (n.type !== 'ObjectProperty') return true
    const key = propName(n)
    if (!CONNECTION_KEYS.has(key)) return true
    const s = stringValue(n.value)
    if (s != null) out.targets.push({ name: s, key, node: n.value, file: r.file })
    else out.dynamic.push({ node: n.value, file: r.file })
    return true
  })
  return out
}

/**
 * @returns {{
 *   known: boolean,
 *   entries: Array<{ action, sinks: string[], node, key, shorthand }>,
 *   nextTargets: Array<{ name, node, file }>,
 *   dynamicNext: Array<{ node, file }>,
 *   eventsEmitted: Array<{ type, node, file }>,
 *   eventsDynamic: Array<{ node, file }>,
 *   routedTargets: Array<{ name, key, sink, action, node, file }>,   // ok/error names of requests
 *   routedDynamic: Array<{ node, file }>,
 * }}
 */
export function analyzeModel(project, file, modelNode) {
  const res = { known: true, entries: [], nextTargets: [], dynamicNext: [], eventsEmitted: [], eventsDynamic: [], routedTargets: [], routedDynamic: [] }
  const r = resolveExpr(project, file, modelNode)
  const obj = r?.node
  if (!obj || obj.type !== 'ObjectExpression') { res.known = false; return res }
  const mfile = r.file

  const addEvents = (valueNode) => {
    const t = eventSinkTypes(project, mfile, valueNode)
    res.eventsEmitted.push(...t.types)
    res.eventsDynamic.push(...t.dynamic)
  }
  const addRouted = (action, sink, valueNode) => {
    if (NON_ROUTING_SINKS.has(sink)) return
    const t = routedNames(project, mfile, valueNode)
    res.routedTargets.push(...t.targets.map(x => ({ ...x, sink, action })))
    res.routedDynamic.push(...t.dynamic)
  }

  for (const p of obj.properties) {
    if (p.type === 'SpreadElement') { res.known = false; continue }
    const key = propName(p)
    if (key == null) { res.known = false; continue }
    const { action, sink, shorthand } = splitModelKey(key)
    const value = p.type === 'ObjectMethod' ? p : unwrap(p.value)
    let sinks
    if (shorthand) {
      sinks = [sink]
      if (sink === 'EVENTS') addEvents(value)
      addRouted(action, sink, value)
    } else if (value && value.type === 'ObjectExpression') {
      sinks = []
      for (const sp of value.properties) {
        if (sp.type === 'SpreadElement') continue
        const sname = propName(sp)
        if (!sname) continue
        sinks.push(sname)
        const sval = sp.type === 'ObjectMethod' ? sp : sp.value
        if (sname === 'EVENTS') addEvents(sval)
        addRouted(action, sname, sp.type === 'ObjectMethod' ? sp : unwrap(sp.value))
      }
    } else {
      sinks = ['STATE']
    }
    res.entries.push({ action, sinks, node: p.key, key, shorthand, file: mfile })
  }

  // next('X') targets: inside the model object and any module-level reducer
  // functions it references by name.
  const scanned = new Set()
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
        const c = unwrap(n.callee)
        if (c.type === 'Identifier' && nextNames.has(c.name) && n.arguments.length) {
          const s = stringValue(n.arguments[0])
          if (s != null) res.nextTargets.push({ name: s, node: n.arguments[0], file: f })
          else res.dynamicNext.push({ node: n, file: f })
        }
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
