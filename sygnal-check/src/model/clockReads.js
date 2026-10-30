/**
 * Clock and randomness reads in model handlers (SYG258, SYG509): `Date.now()`, `new Date()` with
 * no arguments, `Math.random()` and `crypto.randomUUID()` (also through `globalThis.`, `window.`
 * or `self.`) called directly in a STATE reducer, an EFFECT handler or another sink handler of a
 * model. The canonical form takes `now()`, `random()` and `uuid()` from the handler's 4th
 * argument (props), which record/replay and renderComponent can supply.
 *
 *   modelHandlers(project, comp) → Array<{ action, sink, fn: { file, node } }>
 *   clockReads(file, fn)         → Array<{ node, kind: 'now'|'random'|'uuid', text }>
 *   clockRewrite(file, fn, reads) → { sig, replacement(read), edits | null }
 *
 * Only reads in the handler's own body count: nested functions (callbacks, helpers) are not
 * walked, and neither are views or intents.
 */
import { walk, unwrap, isFunction, propName, stringValue } from '../ast.js'
import { findBinding } from '../scope.js'
import { modelEntries, sinkProps, fnOf, keyText } from '../rules/strict/shared.js'

const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self'])

/** The callee of `event('T', fn)` imported from sygnal? */
function isEventCall(file, node) {
  const n = unwrap(node)
  if (n?.type !== 'CallExpression') return false
  const c = unwrap(n.callee)
  if (c?.type !== 'Identifier') return false
  const b = findBinding(file, c.name, c)
  return !!b && b.kind === 'import' && b.imported === 'event' && /^sygnal(\/|$)/.test(b.source)
}

/**
 * Every handler function of a component's model: shorthand entries (STATE reducers), object-form
 * sink values that are (or resolve to) functions, and the payload function of `event('T', fn)`.
 */
export function modelHandlers(project, comp) {
  const out = []
  const seen = new Set()
  const add = (action, sink, file, value) => {
    let v = value
    if (isEventCall(file, v) && unwrap(v).arguments.length > 1) v = unwrap(v).arguments[1]
    const fn = fnOf(project, file, v)
    if (!fn || seen.has(fn.node)) return
    seen.add(fn.node)
    out.push({ action, sink, fn })
  }
  for (const e of modelEntries(project, comp)) {
    if (e.shorthand) add(e.action, e.sink, e.file, e.value)
    else if (e.value?.type === 'ObjectExpression') for (const s of sinkProps(e.value)) add(e.action, s.sink, e.file, s.value)
    else add(e.action, 'STATE', e.file, e.value)
  }
  return out
}

/** `Date`, `globalThis.Date`, ... unbound in the file: the name of the global, or null. */
function globalName(file, node) {
  const n = unwrap(node)
  if (n?.type === 'Identifier') return findBinding(file, n.name, n) ? null : n.name
  if ((n?.type === 'MemberExpression' || n?.type === 'OptionalMemberExpression') && !n.computed &&
      n.property.type === 'Identifier') {
    const obj = unwrap(n.object)
    if (obj?.type === 'Identifier' && GLOBAL_OBJECTS.has(obj.name) && !findBinding(file, obj.name, obj)) return n.property.name
  }
  return null
}

const METHODS = { Date: { now: 'now' }, Math: { random: 'random' }, crypto: { randomUUID: 'uuid' } }

/** What a call or `new` reads: 'now' | 'random' | 'uuid' | null. */
function readKind(file, n) {
  if (n.type === 'NewExpression') return n.arguments.length === 0 && globalName(file, n.callee) === 'Date' ? 'now' : null
  if (n.type !== 'CallExpression' && n.type !== 'OptionalCallExpression') return null
  const c = unwrap(n.callee)
  if ((c?.type !== 'MemberExpression' && c?.type !== 'OptionalMemberExpression') || c.computed) return null
  const method = c.property.type === 'Identifier' ? c.property.name : stringValue(c.property)
  const obj = globalName(file, c.object)
  return (obj && Object.hasOwn(METHODS, obj) && METHODS[obj][method]) || null
}

/** The clock / randomness reads directly in `fn`'s body, in source order. */
export function clockReads(file, fn) {
  const out = []
  walk(fn.body, (n) => {
    if (n !== fn.body && isFunction(n)) return false
    const kind = readKind(file, n)
    if (kind) out.push({ node: n, kind, text: file.source.slice(n.start, n.end) })
    return true
  })
  return out
}

/** Identifiers named `name` in `fn` that are references or bindings (not property keys/members). */
function usesName(fn, name) {
  let found = false
  walk(fn, (n, parent) => {
    if (found) return false
    if (n.type !== 'Identifier' || n.name !== name) return true
    if (parent && (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && parent.property === n && !parent.computed) return true
    if (parent && (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') && parent.key === n && !parent.computed && !parent.shorthand) return true
    found = true
    return false
  })
  return found
}

const DEFAULT_PARAMS = [['state', '_state'], ['data', '_data'], ['next', '_next']]

/**
 * The canonical rewrite of a handler's reads:
 *   sig          the rewritten parameter list, `(state, data, next, { now })` (for the message)
 *   replacement  read → the text it becomes (`now()`, `new Date(now())`, `props.uuid()`)
 *   edits        the mechanical edits (the parameter list and every read), or null when they
 *                can't be made safely (a rest or default parameter, a name already in use, a
 *                typed TypeScript handler)
 */
export function clockRewrite(file, fn, reads) {
  const kinds = [...new Set(reads.map(r => r.kind))]
  const src = file.source
  const text = (n) => src.slice(n.start, n.end)
  const params = fn.params
  const fourth = params[3]
  const callText = (r, local) => r.node.type === 'NewExpression' ? `new Date(${local}())` : `${local}()`
  let safe = !params.slice(0, 4).some(p => p.type === 'RestElement') &&
    !(/\.(c|m)?tsx?$/.test(file.path) && params.some(p => p.typeAnnotation || p.left?.typeAnnotation))
  const edits = []

  // the 4th parameter: `props` (an identifier) or a destructuring pattern
  let local = {}
  let sig
  if (fourth?.type === 'Identifier') {
    const p = fourth.name
    for (const k of kinds) local[k] = `${p}.${k}`
    sig = params.slice(0, 4).map(text).join(', ')
    // `props` must still mean the parameter where each read is
    if (reads.some(r => findBinding(file, p, r.node)?.node !== fn)) safe = false
  } else if (fourth?.type === 'ObjectPattern') {
    const missing = []
    for (const k of kinds) {
      const prop = fourth.properties.find(pr => pr.type === 'ObjectProperty' && !pr.computed && propName(pr) === k)
      const v = prop && unwrap(prop.value?.type === 'AssignmentPattern' ? prop.value.left : prop.value)
      if (v?.type === 'Identifier') {
        local[k] = v.name
        if (reads.some(r => r.kind === k && findBinding(file, v.name, r.node)?.node !== fn)) safe = false
      } else if (prop) {
        local[k] = k
        safe = false
      } else {
        local[k] = k
        missing.push(k)
        if (usesName(fn, k)) safe = false
      }
    }
    if (missing.length) {
      const first = fourth.properties[0]
      if (first) edits.push({ file: file.path, start: first.start, end: first.start, text: `${missing.join(', ')}, ` })
      else edits.push({ file: file.path, start: fourth.start, end: fourth.end, text: `{ ${missing.join(', ')} }` })
    }
    const pattern = missing.length
      ? (fourth.properties.length ? `{ ${missing.join(', ')}, ${fourth.properties.map(text).join(', ')} }` : `{ ${missing.join(', ')} }`)
      : text(fourth)
    sig = [...params.slice(0, 3).map(text), pattern].join(', ')
  } else if (!fourth) {
    // fewer than 4 parameters: fill in the missing ones, then `{ now, ... }`
    for (const k of kinds) { local[k] = k; if (usesName(fn, k)) safe = false }
    const names = params.map(text)
    for (let i = params.length; i < 3; i++) {
      const name = DEFAULT_PARAMS[i].find(n => !usesName(fn, n))
      if (!name) { safe = false; names.push(DEFAULT_PARAMS[i][0]) } else names.push(name)
    }
    const added = [...names.slice(params.length), `{ ${kinds.join(', ')} }`]
    names.push(`{ ${kinds.join(', ')} }`)
    sig = names.join(', ')
    if (params.length) {
      const last = params[params.length - 1]
      const p0 = params[0]
      // `state => …`: no parentheses to add to
      let i = p0.start - 1
      while (i >= 0 && /\s/.test(src[i])) i--
      if (fn.type === 'ArrowFunctionExpression' && params.length === 1 && src[i] !== '(') {
        edits.push({ file: file.path, start: p0.start, end: p0.end, text: `(${sig})` })
      } else {
        edits.push({ file: file.path, start: last.end, end: last.end, text: `, ${added.join(', ')}` })
      }
    } else {
      // `() => …`, `function () {}`, `SAVE() {}`: the empty parentheses
      let i = fn.type === 'ObjectMethod' || fn.type === 'ClassMethod' ? fn.key.end : fn.start
      while (i < fn.body.start && src[i] !== '(') i++
      let j = i + 1
      while (j < fn.body.start && /\s/.test(src[j])) j++
      if (src[i] === '(' && src[j] === ')') edits.push({ file: file.path, start: i, end: j + 1, text: `(${sig})` })
      else safe = false
    }
  } else {
    // a default value or another pattern: say what to write, no edits
    for (const k of kinds) local[k] = k
    sig = [...params.slice(0, 3).map(text), `{ ${kinds.join(', ')} }`].join(', ')
    safe = false
  }

  const replacement = (r) => callText(r, local[r.kind])
  for (const r of reads) edits.push({ file: file.path, start: r.node.start, end: r.node.end, text: replacement(r) })
  return { sig: `(${sig})`, replacement, edits: safe ? edits : null }
}

/** The report fields shared by SYG258 and SYG509 for one read. */
export function clockReport(file, h, read, rewrite, code) {
  const what = read.kind === 'now' ? 'the clock' : read.kind === 'random' ? 'a random number' : 'a random id'
  const where = h.sink === 'STATE' ? `the STATE reducer for '${h.action}'` : `the ${h.sink} handler of '${h.action}'`
  const after = rewrite.replacement(read)
  const body = h.sink === 'STATE' ? `${keyText(h.action)}: ${rewrite.sig} => …` : `${h.sink}: ${rewrite.sig} => …`
  const fixes = rewrite.edits
    ? [{ title: `Use ${after} from the handler's props`, kind: 'quickfix', preferred: true, fixAll: true, edits: rewrite.edits }]
    : undefined
  return {
    code,
    file,
    node: read.node,
    message: `${where} reads ${what} from a global (\`${read.text}\`)${code === 'SYG258' ? ', so replaying its actions can give a different state' : ''}`,
    fix: `take it from the handler's 4th argument: \`${body}\` with \`${after}\` in place of \`${read.text}\``,
    fixes,
    data: { action: h.action, sink: h.sink, read: read.kind },
  }
}

