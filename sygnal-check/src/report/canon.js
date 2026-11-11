/**
 * Canonical forms of code, for the behaviour report (`sygnal-check --report`; research:
 * dev-plans/research/behaviour-report): two pieces of code get the same fingerprint when they differ
 * only in formatting, comments, types, the names of their parameters and locals, or the spelling of
 * a function (arrow with a one-return block = arrow with an expression body).
 *
 *   fingerprint(project, file, node, opts?) → { own, deps: { name: { file, h } }, opaque: [name], touches: [path] }
 *     own      hash of the node's canonical form
 *     deps     the module-level functions / consts it uses (this file or imported, transitively,
 *              5 levels; of an object used only as `api.x`, each key used: 'api.x'): a change
 *              there is a change here even when `own` is equal
 *              (a function's also has logic: logic.js helperLogic, when facts.js asked for it)
 *     opaque   names it uses that can't be followed (a relative import the checker can't load)
 *     touches  the globals it calls or uses that aren't plain computation ('localStorage.setItem')
 *     opts     strip: object literals whose `...<first param>` spread is dropped and keys sorted
 *              (a reducer's `{ ...state, a }` = `set({ a })`); inline: local consts written out
 *   canonOf(file, node, root, opts?) → the hash with the root's parameters by position and other names
 *              as written (conditions: stable when unrelated locals come and go); opts.args: the
 *              canonical text of each parameter's argument, so a condition in a helper hashes as
 *              it would written in its caller
 *              opts.calls (the project): a call to a function of the app with a one-expression body is
 *              written out with its arguments (`ticketUrl(id)` = its template); another is `name(args)`,
 *              or `name#<hash of it and what it uses>(args)` with opts.hashCalls, so a change in it shows
 *              opts.bound: { param name → text }, a helper's parameters as its call wrote them
 *   A template literal inside another is one template (`${`/a/${x}`}/b` = `/a/${x}/b`).
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
    case 'TemplateLiteral': {
      if (!n.expressions.length) return JSON.stringify(n.quasis[0].value.cooked)
      // a string or template in a template is spliced in: `${ticketUrl(id)}/close` written out = `/api/t/${id}/close`
      const part = (e) => {
        const x = s(e).replace(/^\((.*)\)$/s, (m, inner) => /^(`[^`]*`|"(?:[^"\\]|\\.)*")$/.test(inner) ? inner : m)
        return /^`[^`]*`$/.test(x) ? x.slice(1, -1) : /^"(?:[^"\\]|\\.)*"$/.test(x) ? JSON.parse(x) : '${' + x + '}'
      }
      const out = n.quasis.map((q, i) => q.value.cooked + (n.expressions[i] ? part(n.expressions[i]) : '')).join('')
      return out.includes('${') ? '`' + out + '`' : JSON.stringify(out)
    }
    case 'CallExpression': {
      const x = ctx.calls ? inlineCall(file, n, ctx) : null
      return x ?? generic(file, n, ctx)
    }
    case 'MemberExpression': case 'OptionalMemberExpression':
      if (!n.computed && bare(n.object)?.type === 'Identifier') ctx.viaMember?.set(bare(n.object), n.property.name)
      return `${s(n.object)}${n.optional ? '?.' : '.'}${n.computed ? `[${s(n.property)}]` : n.property.name ?? s(n.property)}`
    case 'ObjectProperty': return `${n.computed ? `[${s(n.key)}]` : propName(n) ?? s(n.key)}:${s(n.value)}`
    case 'ObjectExpression': {
      if (!ctx.strip?.has(n)) return `{${n.properties.map(s).join(',')}}`
      const keep = n.properties.filter(p => !(p.type === 'SpreadElement' && isFirstParam(file, p.argument, ctx)))
      return `{${keep.map(s).sort().join(',')}}`
    }
    case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': case 'ObjectMethod': case 'ClassMethod':
      return fnForm(file, n, ctx)
    default: return generic(file, n, ctx)
  }
}

function generic(file, n, ctx) {
  const s = (x) => ser(file, x, ctx)
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

/** The one expression a function returns, or null. */
export function singleExpression(fn) {
  const body = fn.body
  if (body.type !== 'BlockStatement') return body
  return body.body.length === 1 && body.body[0].type === 'ReturnStatement' && body.body[0].argument && !body.directives?.length ? body.body[0].argument : null
}

/** A call written out (opts.calls): null when it isn't a call of a function the checker can read. */
function inlineCall(file, n, ctx) {
  const callee = bare(n.callee)
  if (callee?.type !== 'Identifier') return null
  const b = findBinding(file, callee.name, callee)
  if (!b || b.kind === 'param' || b.kind === 'pattern' || (b.kind === 'import' && !/^[./]/.test(b.source))) return null
  const r = resolveExpr(ctx.calls, file, callee)
  const fn = r?.node && isFunction(r.node) ? r.node : null
  if (!fn || n.arguments.some(a => a.type === 'SpreadElement')) return null
  const args = n.arguments.map(a => ser(file, a, ctx))
  const body = singleExpression(fn)
  if (body && (ctx.callDepth ?? 0) < 3 && !fn.async && !fn.generator && fn.params.every(p => p.type === 'Identifier')) {
    return ser(r.file, body, newCtx(fn, { localNames: true, inline: true, args, calls: ctx.calls, hashCalls: ctx.hashCalls, callDepth: (ctx.callDepth ?? 0) + 1 }))
  }
  return `${callee.name}${ctx.hashCalls ? '#' + deepHash(ctx.calls, r.file, fn) : ''}(${args.join(',')})`
}

/** A hash of a function and everything it uses: changes when any of them does. */
export function deepHash(project, file, fn) {
  const memo = project.reportDeepHash ??= new WeakMap()
  if (!memo.has(fn)) {
    memo.set(fn, 'cycle')
    const fp = fingerprint(project, file, fn)
    memo.set(fn, hash(fp.own + Object.entries(fp.deps).map(([k, v]) => `${k}=${v.h}`).sort().join(',')))
  }
  return memo.get(fn)
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
  if (ctx.bound && b.kind === 'param' && ctx.bound.has(n.name) && !(ctx.root && b.node === ctx.root)) return ctx.bound.get(n.name)
  if (ctx.root && b.node === ctx.root && b.kind === 'param') {
    const i = ctx.root.params.findIndex(p => (p.type === 'AssignmentPattern' ? p.left : p).type === 'Identifier' && (p.type === 'AssignmentPattern' ? p.left : p).name === n.name)
    if (i >= 0) return ctx.args?.[i] ?? `$${i}`
  }
  if (ctx.scope && inside(ctx.scope, b.kind === 'import' ? null : b.node)) {
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
  // what of it is used: `api.get_run` depends on that entry, not on all of `api`
  if (ctx.viaMember?.has(n)) (ctx.members[n.name] ||= new Set()).add(ctx.viaMember.get(n))
  else ctx.whole.add(n.name)
  return n.name
}

const newCtx = (root, opts = {}) => ({ root: isFunction(root) ? root : null, scope: opts.root ?? root ?? null, locals: new Map(), free: new Map(), viaMember: new Map(), members: {}, whole: new Set(), globals: new Set(), depth: 0, inlining: new Set(), ...opts })

export function canonOf(file, node, root, opts = {}) {
  return hash(canonText(file, node, root, opts))
}

/** canonOf before the hash: what a helper's parameter is, written the caller's way (opts.args). */
export function canonText(file, node, root, opts = {}) {
  return ser(file, node, newCtx(root, { localNames: true, ...opts }))
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
  const follow = (c0, f, depth) => {
    for (const [name, id] of c0.free) {
      if (seen.has(name)) continue
      seen.add(name)
      const r = resolveExpr(project, f, id)
      // another component: its own changes are reported on it, not on everything that renders it
      if (r?.node && comps.has(r.node)) continue
      const b = findBinding(f, name, id)
      // `const { Add, Save } = controls(...)`: the declaration is what can change
      if (b?.kind === 'pattern') { deps[name] = { file: project.relPath(f.path), h: hash(ser(f, b.node, newCtx(null))) }; continue }
      if (!r?.node || r.node === id || r.node.type === 'Identifier') {
        // an import that can't be read
        opaque.push(name)
        continue
      }
      // an object used only as `name.key`: one dependency per key used
      const obj = r.node.type === 'ObjectExpression' && !c0.whole.has(name) && c0.members[name] && !r.node.properties.some(p => p.type === 'SpreadElement')
        ? [...c0.members[name]].map(k => [k, r.node.properties.find(p => propName(p) === k)]) : null
      if (obj && obj.every(([, p]) => p)) {
        for (const [k, p] of obj) {
          const v = p.type === 'ObjectMethod' ? p : p.value
          const c = newCtx(v)
          deps[`${name}.${k}`] = { file: project.relPath(r.file.path), h: hash(ser(r.file, v, c)) }
          touchesOf(r.file, v, touches)
          if (depth < 5) follow(c, r.file, depth + 1)
        }
        seen.delete(name) // another reader may use other keys
        continue
      }
      const c = newCtx(r.node)
      deps[name] = { file: project.relPath(r.file.path), h: hash(ser(r.file, r.node, c)) }
      // what a function returns, case by case (logic.js, set by facts.js): compared when it changes
      if (project.reportLogic && isFunction(r.node)) deps[name].logic = project.reportLogic(r.file, r.node)
      touchesOf(r.file, r.node, touches)
      if (depth < 5) follow(c, r.file, depth + 1)
    }
  }
  follow(ctx, file, 0)
  return { own, deps, opaque, touches: [...touches].sort() }
}
