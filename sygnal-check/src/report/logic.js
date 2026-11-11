/**
 * Conditions as boolean formulas, for the behaviour report (compare.js): two conditions are the same
 * when they agree on every combination of their atoms, so a re-parenthesised guard, `!` moved inward
 * (De Morgan), an if / return chain written as one expression, or a boolean helper rewritten are not
 * changes, and a slip in any of them is.
 *
 *   formulaOf(project, file, node, root, args?) → F    the condition `node` in function `root`
 *     (args: the canonical text of root's parameters, as in canon.js). A call to a function of the app
 *     whose returns can be followed (if / return chains, consts) is written out with its arguments;
 *     any other call is an atom that names the function's hash, so a change inside it is a change.
 *   F: { t: 'and' | 'or', a: [F] } | { t: 'not', a: F } | { t: 'atom', h, text } | { t: 'const', v }
 *   Atoms: a comparison (`===` / `!==` one atom, operands sorted; `a > b` = `b < a`), anything else
 *   that isn't &&, ||, !, ?: or a literal. `x.length > 0`, `!== 0`, `>= 1` and `x.length` are
 *   "not `x.length === 0`": a length is assumed to be a whole number ≥ 0.
 *
 *   helperLogic(project, file, fn) → { kind: 'paths', paths: [{ f, v }], text } | { kind: 'unsupported', why, text }
 *     what a function returns, case by case (v: { f } a boolean, { h } another value's hash)
 *   relate(a, b) → { rel: 'same' | 'narrower' | 'wider' | 'different', witness } | null (too many atoms)
 *     narrower: b holds in fewer cases than a; witness: { env, a, b } a case where they differ.
 *     sameAtoms: both use the same atoms. Only then is a direction meaningful: atoms aren't independent
 *     (`n > 3` and `n > 5`), so a case built from atoms only one side has may not be possible
 *   sameValues(a, b) → { same: boolean, witness } | null   two helperLogic results, case by case
 *   witnessText(witness) → 'when `x` is true and `y` is false'
 */
import { unwrap, isFunction } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from '../model/resolve.js'
import { canonText, hash, textOf, singleExpression } from './canon.js'

const bare = (n) => { n = unwrap(n); while (n?.type === 'ChainExpression') n = unwrap(n.expression); return n }
const T = { t: 'const', v: true }, F = { t: 'const', v: false }
export const not = (a) => a.t === 'const' ? { t: 'const', v: !a.v } : a.t === 'not' ? a.a : { t: 'not', a }
export const and = (...xs) => xs.length === 1 ? xs[0] : { t: 'and', a: xs }
export const or = (...xs) => xs.length === 1 ? xs[0] : { t: 'or', a: xs }
const MAX_ATOMS = 12
const MAX_DEPTH = 3
const FLIP = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' }
const COMPARISONS = new Set(['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'in', 'instanceof'])

/** The app's function a call runs (not a package's, not a parameter), or null. */
function calledFunction(project, file, call) {
  const callee = bare(call.callee)
  if (callee?.type !== 'Identifier' || call.arguments.some(a => a.type === 'SpreadElement')) return null
  const b = findBinding(file, callee.name, callee)
  if (!b || b.kind === 'param' || b.kind === 'pattern' || (b.kind === 'import' && !/^[./]/.test(b.source))) return null
  const r = resolveExpr(project, file, callee)
  return r?.node && isFunction(r.node) && !r.node.async && !r.node.generator ? { fn: r.node, file: r.file, name: callee.name } : null
}

export function formulaOf(project, file, node, root, args = null, depth = 0) {
  const canon = (n) => canonText(file, n, root, { args, inline: true, calls: project, hashCalls: true })
  const text = (n) => textOf(file, n)
  const atom = (key, t) => ({ t: 'atom', h: hash(key), text: t })
  const len0 = (x) => atom(`len0:${canon(x)}`, `${text(x)}.length === 0`)
  const lengthOf = (x) => { x = bare(x); return x?.type === 'MemberExpression' && !x.computed && x.property.name === 'length' ? x.object : null }
  const num = (x) => { x = bare(x); return x?.type === 'NumericLiteral' ? x.value : null }
  const compare = (n) => {
    let op = n.operator, l = n.left, r = n.right
    if (num(l) != null && num(r) == null && FLIP[op]) { [l, r] = [r, l]; op = FLIP[op] }
    const lo = lengthOf(l), k = num(r)
    if (lo && k != null) {
      if ((op === '>' && k === 0) || (op === '>=' && k === 1) || ((op === '!==' || op === '!=') && k === 0)) return not(len0(lo))
      if (((op === '===' || op === '==') && k === 0) || (op === '<' && k === 1) || (op === '<=' && k === 0)) return len0(lo)
    }
    const eq = (o) => { const [x, y] = [canon(l), canon(r)].sort(); return atom(`${x} ${o} ${y}`, `${text(l)} ${o} ${text(r)}`) }
    if (op === '!==' || op === '!=') return not(eq(op === '!==' ? '===' : '=='))
    if (op === '===' || op === '==') return eq(op)
    if (op === '>' || op === '>=') return atom(`${canon(r)} ${FLIP[op]} ${canon(l)}`, `${text(l)} ${op} ${text(r)}`)
    return atom(canon(n), text(n))
  }
  const go = (n) => {
    n = bare(n)
    if (!n) return atom('_', '?')
    switch (n.type) {
      case 'BooleanLiteral': return { t: 'const', v: n.value }
      case 'NullLiteral': return F
      case 'NumericLiteral': return { t: 'const', v: n.value !== 0 && !Number.isNaN(n.value) }
      case 'StringLiteral': return { t: 'const', v: n.value !== '' }
      case 'UnaryExpression': if (n.operator === '!') return not(go(n.argument)); break
      case 'LogicalExpression':
        if (n.operator === '&&') return and(go(n.left), go(n.right))
        if (n.operator === '||') return or(go(n.left), go(n.right))
        break
      case 'ConditionalExpression': { const c = go(n.test); return or(and(c, go(n.consequent)), and(not(c), go(n.alternate))) }
      case 'BinaryExpression': return compare(n)
      case 'MemberExpression': if (!n.computed && n.property.name === 'length') return not(len0(n.object)); break
      case 'Identifier': {
        const b = findBinding(file, n.name, n)
        if (!b && n.name === 'undefined') return F
        // a local const holding a condition
        if (b?.kind === 'var' && b.declKind === 'const' && b.init && root && b.init.start >= root.start && b.init.end <= root.end && depth < 8) return formulaOf(project, file, b.init, root, args, depth + 1)
        break
      }
      case 'CallExpression': {
        if (depth >= MAX_DEPTH) break
        const h = calledFunction(project, file, n)
        if (!h) break
        const p = pathsOf(project, h.file, h.fn, n.arguments.map(canon), depth + 1)
        if (p) return or(...p.map(x => and(x.f, x.v ? formulaOf(project, h.file, x.v, h.fn, n.arguments.map(canon), depth + 1) : F)))
        break
      }
    }
    return atom(canon(n), text(n))
  }
  return go(node)
}

const UNSUPPORTED = Symbol('unsupported')

/** [{ f: the case, v: the returned node (null: undefined) }] of a function, or null when its body isn't if / return / const. */
function pathsOf(project, file, fn, args, depth) {
  const body = singleExpression(fn)
  if (body) return [{ f: T, v: body }]
  const fo = (n) => formulaOf(project, file, n, fn, args, depth)
  const out = []
  const block = (s) => s.type === 'BlockStatement' ? s.body : [s]
  // → the case that reaches the end of `list`, or null when every path returns
  const seq = (list, path) => {
    for (const s of list) {
      if (s.type === 'ReturnStatement') { out.push({ f: path, v: s.argument }); return null }
      if (s.type === 'EmptyStatement') continue
      if (s.type === 'VariableDeclaration' && s.kind === 'const' && s.declarations.every(d => d.id.type === 'Identifier' && d.init && !isFunction(d.init))) continue
      if (s.type === 'BlockStatement') { path = seq(s.body, path); if (!path) return null; continue }
      if (s.type === 'IfStatement') {
        const c = fo(s.test)
        const a = seq(block(s.consequent), and(path, c))
        const b = s.alternate ? seq(block(s.alternate), and(path, not(c))) : and(path, not(c))
        if (!a && !b) return null
        // both fall through: the two cases join again, which this doesn't follow
        if (a && b) { if (s.alternate || block(s.consequent).length) throw UNSUPPORTED; continue }
        path = a || b
        continue
      }
      throw UNSUPPORTED
    }
    return path
  }
  try {
    const end = seq(fn.body.body, T)
    if (end) out.push({ f: end, v: null })
    return out
  } catch (e) {
    if (e === UNSUPPORTED) return null
    throw e
  }
}

const strictlyBoolean = (n) => {
  n = bare(n)
  if (!n) return false
  if (n.type === 'BooleanLiteral') return true
  if (n.type === 'UnaryExpression') return n.operator === '!'
  if (n.type === 'BinaryExpression') return COMPARISONS.has(n.operator)
  if (n.type === 'LogicalExpression') return n.operator !== '??' && strictlyBoolean(n.left) && strictlyBoolean(n.right)
  if (n.type === 'ConditionalExpression') return strictlyBoolean(n.consequent) && strictlyBoolean(n.alternate)
  return false
}

export function helperLogic(project, file, fn) {
  const memo = project.reportHelperLogic ??= new WeakMap()
  if (memo.has(fn)) return memo.get(fn)
  // (statements on their own lines read as one line with `;` between them)
  const stmts = (b) => b.type === 'BlockStatement' ? b.body.map(x => textOf(file, x).replace(/;$/, '')).join('; ') : textOf(file, b)
  const text = stmts(fn.body).slice(0, 240)
  let out
  const paths = pathsOf(project, file, fn, null, 0)
  if (!paths) out = { kind: 'unsupported', why: 'its body has statements other than if, return and const', text }
  else {
    out = {
      kind: 'paths', text,
      paths: paths.map(p => ({
        f: p.f,
        v: !p.v ? { h: 'undefined' } : strictlyBoolean(p.v) ? { f: formulaOf(project, file, p.v, fn, null, 0) } : { h: hash(canonText(file, p.v, fn, { inline: true, calls: project, hashCalls: true })) },
      })),
    }
  }
  memo.set(fn, out)
  return out
}

function atomsOf(f, out) {
  if (f.t === 'atom') { if (!out.has(f.h)) out.set(f.h, f.text) }
  else if (f.t === 'not') atomsOf(f.a, out)
  else if (f.t === 'and' || f.t === 'or') f.a.forEach(x => atomsOf(x, out))
  return out
}

function evalF(f, env) {
  switch (f.t) {
    case 'const': return f.v
    case 'atom': return env.get(f.h)
    case 'not': return !evalF(f.a, env)
    case 'and': return f.a.every(x => evalF(x, env))
    case 'or': return f.a.some(x => evalF(x, env))
  }
  return false
}

/** Every assignment of the atoms (null when there are too many to try). */
function* envs(atoms) {
  const keys = [...atoms.keys()]
  for (let i = 0; i < 2 ** keys.length; i++) yield new Map(keys.map((k, j) => [k, !!(i & (1 << j))]))
}

/** The case as shown: only the atoms that matter (flipping one of them makes the two agree). */
function caseOf(env, atoms, differ) {
  const shown = [...env].filter(([h]) => { const e = new Map(env); e.set(h, !env.get(h)); return !differ(e) })
  return shown.map(([h, v]) => ({ text: atoms.get(h), v }))
}

export function relate(a, b) {
  const atoms = atomsOf(b, atomsOf(a, new Map()))
  if (atoms.size > MAX_ATOMS) return null
  let onlyA = null, onlyB = null
  for (const env of envs(atoms)) {
    const x = evalF(a, env), y = evalF(b, env)
    if (x && !y && !onlyA) onlyA = env
    if (y && !x && !onlyB) onlyB = env
    if (onlyA && onlyB) break
  }
  const w = (env) => env && { env: caseOf(env, atoms, (e) => evalF(a, e) !== evalF(b, e)), a: evalF(a, env), b: evalF(b, env) }
  const A = atomsOf(a, new Map()), B = atomsOf(b, new Map())
  const sameAtoms = A.size === B.size && [...A.keys()].every(h => B.has(h))
  if (!onlyA && !onlyB) return { rel: 'same', sameAtoms }
  if (onlyA && !onlyB) return { rel: 'narrower', witness: w(onlyA), sameAtoms }
  if (onlyB && !onlyA) return { rel: 'wider', witness: w(onlyB), sameAtoms }
  return { rel: 'different', witness: w(onlyA), other: w(onlyB), sameAtoms }
}

export function sameValues(a, b) {
  if (a?.kind !== 'paths' || b?.kind !== 'paths') return null
  const atoms = new Map()
  for (const p of [...a.paths, ...b.paths]) { atomsOf(p.f, atoms); if (p.v.f) atomsOf(p.v.f, atoms) }
  if (atoms.size > MAX_ATOMS) return null
  const value = (paths, env) => {
    const p = paths.find(x => evalF(x.f, env))
    return !p ? 'none' : p.v.f ? String(evalF(p.v.f, env)) : p.v.h
  }
  for (const env of envs(atoms)) {
    const x = value(a.paths, env), y = value(b.paths, env)
    if (x !== y) {
      const shown = (v) => v === 'true' || v === 'false' ? v : 'another value'
      return { same: false, witness: { env: caseOf(env, atoms, (e) => value(a.paths, e) !== value(b.paths, e)), a: shown(x), b: shown(y) } }
    }
  }
  return { same: true }
}

export function witnessText(w) {
  if (!w?.env.length) return 'always'
  const shown = w.env.slice(0, 4).map(x => `\`${x.text}\` is ${x.v}`)
  return `when ${shown.join(' and ')}${w.env.length > 4 ? ' (and …)' : ''}`
}
