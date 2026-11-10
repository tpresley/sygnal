/**
 * Canonical forms of code, for the behaviour report (`sygnal-check --report`; research:
 * dev-plans/research/behaviour-report): two pieces of code get the same fingerprint when they differ
 * only in formatting, comments, types, the names of their parameters and locals, or the spelling of
 * a function (arrow with a one-return block = arrow with an expression body).
 *
 *   fingerprint(project, file, node, opts?) → { own, deps: { name: { file, h } }, opaque: [name], touches: [path] }
 *     own      hash of the node's canonical form
 *     deps     the module-level functions / consts it uses (this file or imported, transitively,
 *              5 levels): a change there is a change here even when `own` is equal
 *     opaque   names it uses that can't be followed (a relative import the checker can't load)
 *     touches  the globals it calls or uses that aren't plain computation ('localStorage.setItem')
 *     opts     strip: object literals whose `...<first param>` spread is dropped and keys sorted
 *              (a reducer's `{ ...state, a }` = `set({ a })`); inline: local consts written out
 *   canonOf(file, node, root, opts?) → the hash with the root's parameters by position and other names
 *              as written (conditions: stable when unrelated locals come and go)
 *   hash(text), textOf(file, node) (the source, whitespace collapsed)
 */
import { createHash } from 'node:crypto'
import { unwrap, isFunction, walk, propName } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from '../model/resolve.js'

const SKIP = new Set(['type', 'loc', 'start', 'end', 'extra', 'range', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens',
  'typeAnnotation', 'returnType', 'typeParameters', 'superTypeParameters', 'typeArguments', 'predicate', 'implements', 'shorthand', 'errors', 'directives'])

/** Globals that are plain computation: not reported as `touches`. */
const PURE_GLOBALS = new Set(['undefined', 'NaN', 'Infinity', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'BigInt', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'RegExp', 'Error', 'TypeError', 'RangeError', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'Intl', 'structuredClone', 'Blob', 'File', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'FormData', 'Headers', 'AbortController', 'DOMParser', 'console'])
/** Clocks and randomness: not side effects, but a reducer that reads them is not a pure function. */
export const CLOCK_GLOBALS = /^(Date|performance|crypto)(\.|$)/

export const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12)
export const textOf = (file, node) => file.source.slice(node.start, node.end).replace(/\s+/g, ' ').trim()

const inside = (outer, inner) => inner && inner.start >= outer.start && inner.end <= outer.end

function bare(n) {
  n = unwrap(n)
  while (n?.type === 'ChainExpression') n = unwrap(n.expression)
  return n
}

/** The object literals a function returns (through ?: and ||, ?? and the right of &&). */
export function returnedLiterals(fn, returns) {
  const out = []
  const collect = (e) => {
    e = bare(e)
    if (!e) return
    if (e.type === 'ConditionalExpression') { collect(e.consequent); collect(e.alternate) }
    else if (e.type === 'LogicalExpression') { collect(e.right); if (e.operator !== '&&') collect(e.left) }
    else if (e.type === 'ObjectExpression') out.push(e)
  }
  returns(fn).forEach(collect)
  return out
}

function ser(file, node, ctx) {
  const n = bare(node)
  if (!n) return '_'
  if (ctx.depth > 300) return '…'
  ctx.depth++
  try {
    return serNode(file, n, ctx)
  } finally { ctx.depth-- }
}

function serNode(file, n, ctx) {
  const s = (x) => ser(file, x, ctx)
  switch (n.type) {
    case 'Identifier': return ident(file, n, ctx)
    case 'StringLiteral': return JSON.stringify(n.value)
    case 'NumericLiteral': case 'BooleanLiteral': return String(n.value)
    case 'NullLiteral': return 'null'
    case 'RegExpLiteral': return `/${n.pattern}/${n.flags}`
    case 'TemplateLiteral':
      if (!n.expressions.length) return JSON.stringify(n.quasis[0].value.cooked)
      return '`' + n.quasis.map((q, i) => q.value.cooked + (n.expressions[i] ? '${' + s(n.expressions[i]) + '}' : '')).join('') + '`'
    case 'MemberExpression': case 'OptionalMemberExpression':
      return `${s(n.object)}${n.optional ? '?.' : '.'}${n.computed ? `[${s(n.property)}]` : n.property.name ?? s(n.property)}`
    case 'ObjectProperty': return `${n.computed ? `[${s(n.key)}]` : propName(n) ?? s(n.key)}:${s(n.value)}`
    case 'ObjectExpression': {
      if (!ctx.strip?.has(n)) return `{${n.properties.map(s).join(',')}}`
      const keep = n.properties.filter(p => !(p.type === 'SpreadElement' && isFirstParam(file, p.argument, ctx)))
      return `{${keep.map(s).sort().join(',')}}`
    }
    case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': case 'ObjectMethod': case 'ClassMethod':
      return fnForm(file, n, ctx)
    default: {
      const parts = []
      for (const k of Object.keys(n)) {
        if (SKIP.has(k)) continue
        const v = n[k]
        if (v == null || v === false) continue
        if (Array.isArray(v)) parts.push(`${k}=[${v.map(x => x && typeof x.type === 'string' ? s(x) : '_').join(',')}]`)
        else if (typeof v.type === 'string') parts.push(`${k}=${s(v)}`)
        else if (typeof v !== 'object') parts.push(`${k}=${v}`)
        else if (n.type === 'TemplateElement') parts.push(v.cooked)
      }
      return `${n.type}(${parts.join(' ')})`
    }
  }
}

function fnForm(file, n, ctx) {
  const params = n.params.map(p => ser(file, p, ctx)).join(',')
  let body = n.body
  // a block that only returns = an expression body
  if (body.type === 'BlockStatement' && body.body.length === 1 && body.body[0].type === 'ReturnStatement' && body.body[0].argument && !body.directives?.length) body = body.body[0].argument
  // a reducer compared by what it returns: `(s) => ({ ...s, a: 1 })` = `set({ a: 1 })`
  if (ctx.strip && n === ctx.root) return ser(file, body, ctx)
  const key = n.type === 'ObjectMethod' ? `${n.computed ? ser(file, n.key, ctx) : propName(n)}:` : ''
  return `${key}${n.async ? 'async ' : ''}${n.generator ? '* ' : ''}fn(${params})=>${ser(file, body, ctx)}`
}

function isFirstParam(file, e, ctx) {
  const n = bare(e)
  const p = ctx.root?.params?.[0]
  return n?.type === 'Identifier' && p?.type === 'Identifier' && n.name === p.name && findBinding(file, n.name, n)?.node === ctx.root
}

function ident(file, n, ctx) {
  const b = findBinding(file, n.name, n)
  if (!b) { ctx.globals?.add(n.name); return n.name }
  if (ctx.root && b.node === ctx.root && b.kind === 'param') {
    const i = ctx.root.params.findIndex(p => (p.type === 'AssignmentPattern' ? p.left : p).type === 'Identifier' && (p.type === 'AssignmentPattern' ? p.left : p).name === n.name)
    if (i >= 0) return `$${i}`
  }
  if (ctx.root && inside(ctx.root, b.kind === 'import' ? null : b.node)) {
    if (ctx.inline && b.kind === 'var' && b.declKind === 'const' && b.init && !ctx.noInline?.(b) && !ctx.inlining.has(b.node) && ctx.inlining.size < 8) {
      ctx.inlining.add(b.node)
      const out = ser(file, b.init, ctx)
      ctx.inlining.delete(b.node)
      return `(${out})`
    }
    if (ctx.localNames) return n.name
    const k = `${b.kind}:${b.node.start}:${n.name}`
    if (!ctx.locals.has(k)) ctx.locals.set(k, `L${ctx.locals.size}`)
    return ctx.locals.get(k)
  }
  if (b.kind === 'import' && !/^[./]/.test(b.source)) return `${b.source}:${b.imported}`
  ctx.free?.set(n.name, n)
  return n.name
}

const newCtx = (root, opts = {}) => ({ root: isFunction(root) ? root : null, locals: new Map(), free: new Map(), globals: new Set(), depth: 0, inlining: new Set(), ...opts })

export function canonOf(file, node, root, opts = {}) {
  return hash(ser(file, node, newCtx(root, { localNames: true, ...opts })))
}

/** Dotted paths of the non-pure globals a node calls or reads. */
function touchesOf(file, root, out) {
  const path = (m) => {
    const segs = []
    let n = bare(m)
    while (n?.type === 'MemberExpression' || n?.type === 'OptionalMemberExpression') {
      if (n.computed) return null
      segs.unshift(n.property.name)
      n = bare(n.object)
    }
    return n?.type === 'Identifier' ? { root: n, segs } : null
  }
  const used = new Set()
  walk(root, (n, parent) => {
    if (n.type === 'MetaProperty') return false
    if (used.has(n)) return true
    let p = null
    if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') p = path(n)
    else if (n.type === 'Identifier' && !(parent && (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && parent.property === n && !parent.computed) && !(parent?.type === 'ObjectProperty' && parent.key === n && !parent.computed)) p = { root: n, segs: [] }
    if (!p || PURE_GLOBALS.has(p.root.name) || findBinding(file, p.root.name, p.root)) return true
    // the chain is one use: `window.location.href` doesn't also count as `window.location`
    let m = n
    while (m && m !== p.root) { used.add(m); m = m.object }
    used.add(p.root)
    out.add([p.root.name, ...p.segs].join('.'))
    return true
  })
}

export function fingerprint(project, file, node, opts = {}) {
  const root = bare(node)
  const ctx = newCtx(root, opts)
  const own = hash(ser(file, root, ctx))
  const deps = {}, opaque = [], touches = new Set()
  if (root) touchesOf(file, root, touches)
  const seen = new Set()
  const comps = project.reportComponents ??= new Set(project.components.flatMap(c => [c.node, c.view]))
  const follow = (free, f, depth) => {
    for (const [name, id] of free) {
      if (seen.has(name)) continue
      seen.add(name)
      const r = resolveExpr(project, f, id)
      // another component: its own changes are reported on it, not on everything that renders it
      if (r?.node && comps.has(r.node)) continue
      if (!r?.node || r.node === id || r.node.type === 'Identifier') {
        // an import that can't be read, a pattern-bound module name
        opaque.push(name)
        continue
      }
      const c = newCtx(r.node)
      deps[name] = { file: project.relPath(r.file.path), h: hash(ser(r.file, r.node, c)) }
      touchesOf(r.file, r.node, touches)
      if (depth < 5) follow(c.free, r.file, depth + 1)
    }
  }
  follow(ctx.free, file, 0)
  return { own, deps, opaque, touches: [...touches].sort() }
}
