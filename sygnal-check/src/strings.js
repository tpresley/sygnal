/**
 * Static evaluation of class/id expressions.
 *
 * evalStrings() turns an expression into the list of strings it can produce
 * ("alternatives"). Unknown parts are replaced by the DYN marker, so
 * `'tile-' + id` becomes ['tile-\0']. tokenize() then splits the
 * alternatives into class tokens:
 *   - static tokens        → `names`
 *   - tokens with DYN      → `patterns` (RegExp; a token that is DYN only
 *                            means "any class", i.e. fully dynamic)
 *
 * Only membership matters for the checker (can class X ever appear?), so
 * classes() / clsx() / [..].join(' ') are evaluated as the union of every
 * class they might emit.
 */
import { unwrap, propName, memberName } from './ast.js'
import { findBinding } from './scope.js'

export const DYN = '\u0000'
const MAX_ALTERNATIVES = 64
const MAX_DEPTH = 8

export const CLASS_HELPERS = new Set(['classes', 'classNames', 'classnames', 'clsx', 'cx'])

const uniq = (arr) => [...new Set(arr)]

function product(a, b) {
  if (!a || !b) return [DYN]
  if (a.length * b.length > MAX_ALTERNATIVES) return [DYN]
  const out = []
  for (const x of a) for (const y of b) out.push(x + y)
  return uniq(out)
}

function union(...lists) {
  const out = uniq(lists.flat())
  return out.length > MAX_ALTERNATIVES ? [DYN] : out
}

/**
 * @param node   expression
 * @param ctx    { fileInfo } — used to resolve identifiers to their const initializer
 */
export function evalStrings(node, ctx, depth = 0) {
  node = unwrap(node)
  if (!node || depth > MAX_DEPTH) return [DYN]
  switch (node.type) {
    case 'StringLiteral': return [node.value]
    case 'NumericLiteral': return [String(node.value)]
    case 'BooleanLiteral': case 'NullLiteral': return ['']
    case 'TemplateLiteral': {
      let acc = [node.quasis[0].value.cooked ?? '']
      node.expressions.forEach((e, i) => {
        acc = product(acc, evalStrings(e, ctx, depth + 1))
        acc = product(acc, [node.quasis[i + 1].value.cooked ?? ''])
      })
      return acc
    }
    case 'BinaryExpression':
      if (node.operator === '+') return product(evalStrings(node.left, ctx, depth + 1), evalStrings(node.right, ctx, depth + 1))
      return [DYN]
    case 'ConditionalExpression':
      return union(evalStrings(node.consequent, ctx, depth + 1), evalStrings(node.alternate, ctx, depth + 1))
    case 'LogicalExpression':
      if (node.operator === '&&') return union(evalStrings(node.right, ctx, depth + 1), [''])
      return union(evalStrings(node.left, ctx, depth + 1), evalStrings(node.right, ctx, depth + 1))
    case 'Identifier': {
      if (node.name === 'undefined') return ['']
      const b = ctx?.fileInfo && findBinding(ctx.fileInfo, node.name, node)
      if (b && b.kind === 'var' && b.init) return evalStrings(b.init, ctx, depth + 1)
      return [DYN]
    }
    case 'ArrayExpression':
      return [classTokens(node.elements, ctx, depth + 1).join(' ')]
    case 'ObjectExpression':
      return [objectClassTokens(node, ctx, depth + 1).join(' ')]
    case 'CallExpression': {
      const callee = unwrap(node.callee)
      if (callee.type === 'Identifier' && CLASS_HELPERS.has(callee.name)) {
        return [classTokens(node.arguments, ctx, depth + 1).join(' ')]
      }
      if (callee.type === 'MemberExpression') {
        const m = memberName(callee)
        if (m === 'join') {
          const sep = node.arguments.length ? evalStrings(node.arguments[0], ctx, depth + 1) : [',']
          let arr = unwrap(callee.object)
          // peel [..].filter(Boolean) / .filter(x => x)
          while (arr?.type === 'CallExpression' && unwrap(arr.callee).type === 'MemberExpression' && memberName(unwrap(arr.callee)) === 'filter') {
            arr = unwrap(unwrap(arr.callee).object)
          }
          if (arr?.type === 'ArrayExpression' && sep.length === 1 && /^\s+$/.test(sep[0])) {
            return [classTokens(arr.elements, ctx, depth + 1).join(' ')]
          }
          return [DYN]
        }
        if (m === 'trim' || m === 'toString') return evalStrings(callee.object, ctx, depth + 1).map(s => s.trim())
      }
      return [DYN]
    }
    default:
      return [DYN]
  }
}

function objectClassTokens(obj, ctx, depth) {
  const out = []
  for (const p of obj.properties) {
    if (p.type === 'SpreadElement') { out.push(DYN); continue }
    const name = propName(p)
    if (name != null) out.push(...name.split(/\s+/).filter(Boolean))
    else if (p.computed) out.push(...evalStrings(p.key, ctx, depth))
    else out.push(DYN)
  }
  return out
}

/** Union of class tokens produced by classes()-style arguments. */
export function classTokens(args, ctx, depth = 0) {
  const out = []
  for (let a of args) {
    a = unwrap(a)
    if (!a) continue
    if (a.type === 'SpreadElement') { out.push(DYN); continue }
    if (a.type === 'ObjectExpression') { out.push(...objectClassTokens(a, ctx, depth)); continue }
    if (a.type === 'ArrayExpression') { out.push(...classTokens(a.elements, ctx, depth + 1)); continue }
    if (a.type === 'ConditionalExpression') { out.push(...classTokens([a.consequent, a.alternate], ctx, depth + 1)); continue }
    if (a.type === 'LogicalExpression') {
      out.push(...classTokens(a.operator === '&&' ? [a.right] : [a.left, a.right], ctx, depth + 1))
      continue
    }
    if (a.type === 'Identifier') {
      const b = ctx?.fileInfo && findBinding(ctx.fileInfo, a.name, a)
      const init = b && b.kind === 'var' ? unwrap(b.init) : null
      if (init && (init.type === 'ObjectExpression' || init.type === 'ArrayExpression') && depth < MAX_DEPTH) {
        out.push(...classTokens([init], ctx, depth + 1))
        continue
      }
    }
    out.push(...evalStrings(a, ctx, depth + 1))
  }
  return out
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Split alternatives into tokens.
 * @returns {{ names: Set<string>, patterns: Array<{ source: string, re: RegExp }> }}
 *   pattern.source is a printable form ('tile-*'), '*' alone = fully dynamic.
 */
export function tokenize(alternatives, into = { names: new Set(), patterns: [] }) {
  for (const alt of alternatives) {
    for (const tok of alt.split(/\s+/)) {
      if (!tok) continue
      if (!tok.includes(DYN)) { into.names.add(tok); continue }
      const parts = tok.split(DYN)
      const source = parts.join('*').replace(/\*+/g, '*')
      if (into.patterns.some(p => p.source === source)) continue
      into.patterns.push({ source, re: new RegExp('^' + parts.map(escapeRe).join('.*') + '$') })
    }
  }
  return into
}

/**
 * Where the class/id tokens of an expression are written (PLAN-7 N-1): the whitespace-separated
 * words of every string piece the expression can contribute, walked as evalStrings() /
 * classTokens() walk it: string literals, template quasis, classes() / clsx() arguments and
 * object keys, both branches of ?: and of &&/||, + operands, [..].join(' '), .trim(),
 * identifiers bound to a variable of the file (its initializer).
 *
 *   tokenSites(expr, ctx) → Array<{ name, start, end, node }>
 *     start/end: UTF-16 offsets in the file (end exclusive); node: the literal, quasi or key
 *
 * These are candidates: a word glued to a dynamic part (`'tile-' + id`) or split across pieces
 * (`'a' + 'b'`) isn't a token the expression produces, so callers keep the sites whose name is in
 * the expression's tokenize() names. A literal written with escapes is skipped (its offsets
 * don't map). evalStrings / classTokens / tokenize are unchanged.
 */
export function tokenSites(expr, ctx, depth = 0, out = []) {
  const node = unwrap(expr)
  if (!node || depth > MAX_DEPTH) return out
  const words = (n, text, base) => {
    const re = /\S+/g
    let m
    while ((m = re.exec(text))) out.push({ name: m[0], start: base + m.index, end: base + m.index + m[0].length, node: n })
  }
  const literal = (n) => {
    const raw = n.extra?.raw
    if (raw == null || raw.length < 2 || raw.includes('\\')) return
    words(n, raw.slice(1, -1), n.start + 1)
  }
  const sub = (n) => tokenSites(n, ctx, depth + 1, out)
  switch (node.type) {
    case 'StringLiteral': literal(node); break
    case 'TemplateLiteral':
      for (const q of node.quasis) if (q.value.raw != null && !q.value.raw.includes('\\')) words(q, q.value.raw, q.start)
      for (const e of node.expressions) sub(e)
      break
    case 'BinaryExpression': if (node.operator === '+') { sub(node.left); sub(node.right) } break
    case 'ConditionalExpression': sub(node.consequent); sub(node.alternate); break
    case 'LogicalExpression':
      if (node.operator !== '&&') sub(node.left)
      sub(node.right)
      break
    case 'Identifier': {
      const b = ctx?.fileInfo && findBinding(ctx.fileInfo, node.name, node)
      if (b && b.kind === 'var' && b.init) sub(b.init)
      break
    }
    case 'ArrayExpression': for (const e of node.elements) if (e && e.type !== 'SpreadElement') sub(e); break
    case 'ObjectExpression':
      for (const p of node.properties) {
        if (p.type === 'SpreadElement') continue
        if (p.computed) { sub(p.key); continue }
        if (p.key.type === 'StringLiteral') literal(p.key)
        else if (p.key.type === 'Identifier') out.push({ name: p.key.name, start: p.key.start, end: p.key.end, node: p.key })
      }
      break
    case 'CallExpression': {
      const callee = unwrap(node.callee)
      if (callee.type === 'Identifier' && CLASS_HELPERS.has(callee.name)) {
        for (const a of node.arguments) if (a.type !== 'SpreadElement') sub(a)
      } else if (callee.type === 'MemberExpression') {
        const m = memberName(callee)
        if (m === 'join') {
          let arr = unwrap(callee.object)
          while (arr?.type === 'CallExpression' && unwrap(arr.callee).type === 'MemberExpression' && memberName(unwrap(arr.callee)) === 'filter') {
            arr = unwrap(unwrap(arr.callee).object)
          }
          if (arr?.type === 'ArrayExpression') sub(arr)
        } else if (m === 'trim' || m === 'toString') sub(callee.object)
      }
      break
    }
  }
  return out
}
