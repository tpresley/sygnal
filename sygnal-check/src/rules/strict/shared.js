/**
 * Helpers shared by the strict-mode (SYG5xx) rules.
 */
import { walk, unwrap, isFunction, propName, stringValue } from '../../ast.js'
import { findBinding } from '../../scope.js'
import { resolveExpr } from '../../model/resolve.js'
import { splitModelKey } from '../../model/modelEntries.js'

/** Source text of a node. */
export const text = (file, node) => file.source.slice(node.start, node.end)

/** Short single-line source text, or `fallback` when it is long / multi-line. */
export function shortText(file, node, max = 70, fallback = '…') {
  const t = text(file, node)
  return t.length <= max && !t.includes('\n') ? t : fallback
}

export const IDENT = /^[A-Za-z_$][\w$]*$/
export const keyText = (name) => (IDENT.test(name) ? name : `'${name.replace(/'/g, "\\'")}'`)

/**
 * The resolved model object of a component: { file, node: ObjectExpression } or null.
 */
export function modelObject(project, comp) {
  const m = comp.staticProps.model
  if (!m) return null
  const r = resolveExpr(project, comp.file, m)
  return r?.node?.type === 'ObjectExpression' ? r : null
}

/**
 * Model entries of a component.
 * @returns Array<{ prop, key, action, sink, shorthand, value, file }>
 *   value: the property value (unwrapped), or the ObjectMethod itself
 */
export function modelEntries(project, comp) {
  const r = modelObject(project, comp)
  if (!r) return []
  const out = []
  for (const p of r.node.properties) {
    if (p.type === 'SpreadElement') continue
    const key = propName(p)
    if (key == null) continue
    const { action, sink, shorthand } = splitModelKey(key)
    out.push({ prop: p, key, action, sink, shorthand, value: p.type === 'ObjectMethod' ? p : unwrap(p.value), file: r.file })
  }
  return out
}

/** Object-form sink properties of an entry value: Array<{ prop, sink, value }>. */
export function sinkProps(value) {
  if (!value || value.type !== 'ObjectExpression') return []
  const out = []
  for (const p of value.properties) {
    if (p.type === 'SpreadElement') continue
    const sink = propName(p)
    if (sink) out.push({ prop: p, sink, value: p.type === 'ObjectMethod' ? p : unwrap(p.value) })
  }
  return out
}

/** Resolve a value to a function node: { file, node } or null. */
export function fnOf(project, file, value) {
  if (!value) return null
  if (isFunction(value)) return { file, node: value }
  const r = resolveExpr(project, file, value)
  return r && isFunction(r.node) ? { file: r.file, node: r.node } : null
}

/**
 * STATE reducers of a component's model:
 * Array<{ action, fn: { file, node }, entry, valueNode }>
 */
export function stateReducers(project, comp) {
  const out = []
  const seen = new Set()
  for (const e of modelEntries(project, comp)) {
    const candidates = []
    if (e.shorthand) {
      if (e.sink === 'STATE') candidates.push(e.value)
    } else if (e.value?.type === 'ObjectExpression') {
      for (const s of sinkProps(e.value)) if (s.sink === 'STATE') candidates.push(s.value)
    } else {
      candidates.push(e.value)
    }
    for (const v of candidates) {
      const fn = fnOf(project, e.file, v)
      if (!fn || seen.has(fn.node)) continue
      seen.add(fn.node)
      out.push({ action: e.action, fn, entry: e, valueNode: v })
    }
  }
  return out
}

/** ReturnStatements that belong to `fn` itself (not nested functions). */
export function ownReturns(fn) {
  const out = []
  if (fn.body.type !== 'BlockStatement') return out
  walk(fn.body, (n) => {
    if (n !== fn.body && isFunction(n)) return false
    if (n.type === 'ReturnStatement') out.push(n)
    return true
  })
  return out
}

/** Leaf value expressions of a return value (through ?: and sequences). */
export function leaves(expr, out = []) {
  const e = unwrap(expr)
  if (!e) return out
  if (e.type === 'ConditionalExpression') { leaves(e.consequent, out); leaves(e.alternate, out) }
  else if (e.type === 'SequenceExpression') leaves(e.expressions[e.expressions.length - 1], out)
  else out.push(e)
  return out
}

/** Every value `fn` can return: Array<expr | null (bare return / fall-through)> */
export function returnLeaves(fn) {
  if (fn.body.type !== 'BlockStatement') return leaves(fn.body)
  const out = []
  for (const r of ownReturns(fn)) {
    if (r.argument) leaves(r.argument, out)
    else out.push(null)
  }
  return out
}

/** Name of the first parameter when it is a plain identifier. */
export function paramName(fn, i) {
  let p = fn.params[i]
  if (p?.type === 'AssignmentPattern') p = p.left
  return p?.type === 'Identifier' ? p.name : null
}

export const isAbort = (e) => e?.type === 'Identifier' && e.name === 'ABORT'
export const isUndefined = (e) =>
  (e?.type === 'Identifier' && e.name === 'undefined') || (e?.type === 'UnaryExpression' && e.operator === 'void')

/**
 * Can executing these statements reach their end (fall through)? Conservative
 * in the "yes" direction only for constructs it understands; loops and
 * labeled statements are assumed to fall through.
 */
export function completes(stmts) {
  for (const s of stmts) if (!stmtCompletes(s)) return false
  return true
}

function stmtCompletes(s) {
  switch (s.type) {
    case 'ReturnStatement':
    case 'ThrowStatement':
      return false
    case 'BlockStatement':
      return completes(s.body)
    case 'IfStatement':
      return !s.alternate || stmtCompletes(s.consequent) || stmtCompletes(s.alternate)
    case 'TryStatement': {
      if (s.finalizer && !completes(s.finalizer.body)) return false
      const tryDone = completes(s.block.body)
      const catchDone = s.handler ? completes(s.handler.body.body) : false
      return tryDone || catchDone
    }
    case 'SwitchStatement': {
      // no default, a `break`, or a last case that falls off the end → completes;
      // otherwise every case runs into the next one and ends in the last case
      if (!s.cases.some(c => !c.test)) return true
      if (s.cases.some(c => hasBreak(c.consequent))) return true
      return completes(s.cases[s.cases.length - 1].consequent)
    }
    default:
      return true
  }
}

function hasBreak(stmts) {
  let found = false
  for (const s of stmts) {
    walk(s, (n) => {
      if (found || isFunction(n)) return false
      if (n.type === 'SwitchStatement' || n.type === 'ForStatement' || n.type === 'WhileStatement' ||
          n.type === 'DoWhileStatement' || n.type === 'ForInStatement' || n.type === 'ForOfStatement') return false
      if (n.type === 'BreakStatement' && !n.label) { found = true; return false }
      return true
    })
  }
  return found
}

/** Is `ident` (an Identifier node named `name`) bound to a sygnal import, or unbound? */
export function isSygnalName(file, node, name) {
  const b = findBinding(file, name, node)
  if (!b) return true
  return b.kind === 'import' && /^sygnal(\/|$)/.test(b.source) && b.imported === name
}

/** `emit(...)` call (the sygnal helper) */
export function isEmitCall(file, node) {
  const n = unwrap(node)
  if (n?.type !== 'CallExpression') return false
  const c = unwrap(n.callee)
  return c.type === 'Identifier' && c.name === 'emit' && isSygnalName(file, c, 'emit')
}

/** The static `{ type: 'X', data?: expr }` shape of an object literal, or null. */
export function eventLiteral(obj) {
  obj = unwrap(obj)
  if (obj?.type !== 'ObjectExpression') return null
  let type = null
  let data
  for (const p of obj.properties) {
    if (p.type !== 'ObjectProperty') return null
    const k = propName(p)
    if (k === 'type') type = stringValue(p.value)
    else if (k === 'data') data = p
    else return null
  }
  return type == null ? null : { type, dataProp: data || null }
}

/**
 * Raw EVENTS sink function `(s) => ({ type: 'X', data })`: when every return
 * is the same static type, the canonical event() rewrite. null otherwise.
 * @returns {{ type, rewrite: string, exact: boolean } | null}
 *   exact: the rewrite is a faithful mechanical translation (single expression body)
 */
export function rawEventRewrite(file, fn) {
  const rets = returnLeaves(fn)
  if (!rets.length || rets.some(r => r == null)) return null
  const lits = rets.map(eventLiteral)
  if (lits.some(l => !l)) return null
  const type = lits[0].type
  if (lits.some(l => l.type !== type)) return null
  const q = `'${type.replace(/'/g, "\\'")}'`
  const single = fn.body.type !== 'BlockStatement' && lits.length === 1
  if (single && !lits[0].dataProp) return { type, rewrite: `event(${q})`, exact: true }
  if (single && !fn.async && !fn.generator) {
    const dp = lits[0].dataProp
    const dataText = dp.shorthand ? dp.key.name : text(file, dp.value)
    // keep the parens of `data: (a, b)` / `data: (x)` (text() excludes them),
    // and wrap object literals so the arrow body isn't read as a block
    const v = dp.shorthand ? null : dp.value
    const needsParens = v && (v.extra?.parenthesized || v.type === 'ParenthesizedExpression' ||
      v.type === 'SequenceExpression' || unwrap(v)?.type === 'ObjectExpression')
    const body = needsParens ? `(${dataText})` : dataText
    const params = fn.params.map(p => text(file, p)).join(', ')
    const p0 = fn.params[0]
    // `s => …` only for a lone untyped identifier written without parens;
    // type parameters, a type annotation or a return type need `(…)`
    const bare = fn.params.length === 1 && p0.type === 'Identifier' && !p0.typeAnnotation && !p0.optional &&
      !fn.typeParameters && !fn.returnType && file.source[fn.start] !== '(' && !fn.async
    const typeParams = fn.typeParameters ? text(file, fn.typeParameters) : ''
    const returnType = fn.returnType ? text(file, fn.returnType) : ''
    const paramsText = bare ? params : `${typeParams}(${params})${returnType}`
    if (fn.type === 'ArrowFunctionExpression') return { type, rewrite: `event(${q}, ${paramsText} => ${body})`, exact: true }
  }
  return { type, rewrite: `event(${q}, (state, data) => payload)`, exact: false }
}

/**
 * Edit(s) that make `event` available in `file` (added to the sygnal import),
 * or [] when it is already imported. null when it can't be done safely
 * (no sygnal import, or `event` is bound to something else at `at`).
 */
export function ensureEventImport(file, at) {
  const b = findBinding(file, 'event', at)
  if (b) return b.kind === 'import' && /^sygnal(\/|$)/.test(b.source) && b.imported === 'event' ? [] : null
  const imp = file.ast.program.body.find(s => s.type === 'ImportDeclaration' && s.source.value === 'sygnal' && s.importKind !== 'type' &&
    s.specifiers.some(sp => sp.type === 'ImportSpecifier'))
  if (!imp) return null
  const specs = imp.specifiers.filter(sp => sp.type === 'ImportSpecifier')
  const last = specs[specs.length - 1]
  return [{ file: file.path, start: last.end, end: last.end, text: ', event' }]
}
