/**
 * Model analysis: action entries (shorthand expanded), sinks, next('X')
 * targets, and EVENTS types returned from EVENTS sinks.
 */
import { walk, unwrap, isFunction, propName, stringValue } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from './resolve.js'
import { returnedExpressions } from './intent.js'

export const BUILTIN_ACTIONS = new Set(['BOOTSTRAP', 'INITIALIZE', 'HYDRATE', 'DISPOSE', 'READY'])

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

/**
 * @returns {{
 *   known: boolean,
 *   entries: Array<{ action, sinks: string[], node, key, shorthand }>,
 *   nextTargets: Array<{ name, node, file }>,
 *   dynamicNext: Array<{ node, file }>,
 *   eventsEmitted: Array<{ type, node, file }>,
 *   eventsDynamic: Array<{ node, file }>,
 * }}
 */
export function analyzeModel(project, file, modelNode) {
  const res = { known: true, entries: [], nextTargets: [], dynamicNext: [], eventsEmitted: [], eventsDynamic: [] }
  const r = resolveExpr(project, file, modelNode)
  const obj = r?.node
  if (!obj || obj.type !== 'ObjectExpression') { res.known = false; return res }
  const mfile = r.file
  const reducerFns = []

  const addEvents = (valueNode) => {
    const t = eventSinkTypes(project, mfile, valueNode)
    res.eventsEmitted.push(...t.types)
    res.eventsDynamic.push(...t.dynamic)
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
      reducerFns.push(value)
    } else if (value && value.type === 'ObjectExpression') {
      sinks = []
      for (const sp of value.properties) {
        if (sp.type === 'SpreadElement') continue
        const sname = propName(sp)
        if (!sname) continue
        sinks.push(sname)
        const sval = sp.type === 'ObjectMethod' ? sp : sp.value
        if (sname === 'EVENTS') addEvents(sval)
        reducerFns.push(sval)
      }
    } else {
      sinks = ['STATE']
      reducerFns.push(value)
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
