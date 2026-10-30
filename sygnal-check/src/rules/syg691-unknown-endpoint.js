/**
 * SYG691 (static): a member chain on an `orpcClient(contract)` client (sygnal/api) that names a
 * procedure the contract router doesn't have: `api.quotes.lst(...)`. TypeScript reports it in a
 * typed project; this is for JavaScript, where the call would throw `api.quotes.lst is not a
 * function` only when it runs.
 *
 * The client is found by resolving the chain's root (through imports: `api` exported from
 * `api.js`) to an `orpcClient(...)` call imported from 'sygnal/api'; its first argument is
 * resolved to the contract's object literal (nested routers through identifiers and imports
 * too). A namespace is an object literal; anything else is a procedure, whose own properties
 * (`id`, `kind`, `match`, ...) are not checked. Silent when a level can't be listed (a spread, a
 * computed key, a router built by a call).
 */
import { walk, unwrap, propName } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from '../model/resolve.js'
import { closestName } from '../names.js'

const OPEN = Symbol('open')

/** the contract tree: Map name → subtree | 'procedure'; OPEN set when a level can't be listed */
function treeOf(project, file, node, depth = 0) {
  const r = resolveExpr(project, file, node)
  const n = r && unwrap(r.node)
  if (!n || n.type !== 'ObjectExpression' || depth > 8) return null
  const out = new Map()
  for (const p of n.properties) {
    const key = p.type === 'ObjectProperty' && !p.computed ? propName(p) : null
    if (key == null) { out[OPEN] = true; continue }
    const v = unwrap(p.value)
    const sub = v.type === 'ObjectExpression' || v.type === 'Identifier' || v.type === 'MemberExpression' ? treeOf(project, r.file, v, depth + 1) : null
    out.set(key, sub || 'procedure')
  }
  return out
}

/** the orpcClient(...) call an identifier resolves to, with its file */
function clientCall(project, file, id) {
  const r = resolveExpr(project, file, id)
  const n = r && unwrap(r.node)
  if (!n || n.type !== 'CallExpression') return null
  const callee = unwrap(n.callee)
  if (callee.type !== 'Identifier') return null
  const b = findBinding(r.file, callee.name, callee)
  if (!b || b.kind !== 'import' || b.source !== 'sygnal/api' || b.imported !== 'orpcClient') return null
  return n.arguments[0] ? { file: r.file, call: n } : null
}

/** a.b.c → { root: a, parts: [{ name: 'b', node }, { name: 'c', node }] } (non-computed only) */
function chainOf(member) {
  const parts = []
  let n = member
  while (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
    if (n.computed) return null
    parts.unshift({ name: n.property.name, node: n.property })
    n = unwrap(n.object)
  }
  return n.type === 'Identifier' ? { root: n, parts } : null
}

export default {
  id: 'unknown-endpoint',
  codes: ['SYG691'],
  description: 'An orpcClient member chain that names no procedure of the contract',
  run(project, report) {
    const trees = new WeakMap()
    const treeFor = (c) => {
      if (!trees.has(c.call)) trees.set(c.call, treeOf(project, c.file, c.call.arguments[0]))
      return trees.get(c.call)
    }
    for (const p of project.scanned) {
      const file = project.files.get(p)
      if (!file?.ast) continue
      const roots = new Map()
      walk(file.ast.program, (n) => {
        if (n.type !== 'MemberExpression' && n.type !== 'OptionalMemberExpression') return true
        const ch = chainOf(n)
        if (!ch) return true
        if (!roots.has(ch.root.name)) roots.set(ch.root.name, clientCall(project, file, ch.root))
        const c = roots.get(ch.root.name)
        if (!c) return false
        let level = treeFor(c)
        const seen = []
        for (const part of ch.parts) {
          if (!level || level === 'procedure' || level[OPEN]) break
          if (!level.has(part.name)) {
            const near = closestName(part.name, [...level.keys()])
            const where = seen.length ? `under '${seen.join('.')}'` : 'at the top'
            report({
              code: 'SYG691',
              file,
              node: part.node,
              message: `${ch.root.name}.${[...seen, part.name].join('.')}: the oRPC contract has no procedure or router '${part.name}' ${where}${near ? ` (did you mean '${near}'?)` : ''}, so this is undefined when it runs`,
              fix: near ? `use ${ch.root.name}.${[...seen, near].join('.')}` : `add '${part.name}' to the contract, or use one of: ${[...level.keys()].join(', ')}`,
              data: { name: part.name, path: seen, suggestion: near },
            })
            break
          }
          seen.push(part.name)
          level = level.get(part.name)
        }
        return false
      })
    }
  },
}
