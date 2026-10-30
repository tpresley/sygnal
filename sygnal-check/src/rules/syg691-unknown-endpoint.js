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
 *
 * Function-first: in client code (a file that imports 'sygnal' or has JSX), a named import from
 * a `*.server` module that uses sygnal/api must name one of its query / mutation / stream
 * exports. sygnal/vite's client stub has only those: another export (a constant, a helper) is
 * missing in the client build, and a misspelled one is missing everywhere. Silent when the
 * module's exports can't be listed (`export *`) or an export's value isn't clear (a wrapper call).
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

const SERVER_SPEC = /\.server(\.[cm]?[jt]sx?)?$/
const FN_KINDS = new Set(['query', 'mutation', 'stream'])

/** a *.server module's exports: Map name → 'fn' | 'other' | 'unknown'; null if it doesn't use sygnal/api */
function serverExports(file) {
  const body = file.ast.program.body
  const usesApi = body.some((s) => s.type === 'ImportDeclaration' && s.source.value === 'sygnal/api')
  if (!usesApi) return null
  const out = new Map()
  const kindOf = (init) => {
    const n = init && unwrap(init)
    if (!n) return 'other'
    if (n.type === 'CallExpression') {
      const c = unwrap(n.callee)
      const b = c.type === 'Identifier' && findBinding(file, c.name, c)
      if (b && b.kind === 'import' && b.source === 'sygnal/api' && FN_KINDS.has(b.imported)) return 'fn'
      return 'unknown'
    }
    return n.type === 'Identifier' || n.type === 'MemberExpression' || n.type === 'AwaitExpression' ? 'unknown' : 'other'
  }
  for (const stmt of body) {
    if (stmt.type === 'ExportAllDeclaration') { out[OPEN] = true; continue }
    if (stmt.type !== 'ExportNamedDeclaration' || stmt.exportKind === 'type') continue
    const d = stmt.declaration
    if (d?.type === 'VariableDeclaration') for (const x of d.declarations) { if (x.id.type === 'Identifier') out.set(x.id.name, kindOf(x.init)) }
    else if (d?.type === 'FunctionDeclaration' || d?.type === 'ClassDeclaration') out.set(d.id.name, 'other')
    else if (d) continue      // a type or interface
    for (const sp of stmt.specifiers || []) {
      if (sp.exportKind === 'type') continue
      const name = sp.exported.type === 'Identifier' ? sp.exported.name : sp.exported.value
      if (stmt.source) { out.set(name, 'unknown'); continue }
      const b = findBinding(file, sp.local.name, sp.local)
      out.set(name, b?.kind === 'var' ? kindOf(b.init) : b?.kind === 'function' || b?.kind === 'class' ? 'other' : 'unknown')
    }
  }
  return out
}

/** whether a file is client code: it imports 'sygnal' (or its JSX runtime) or has JSX */
function isClient(file) {
  if (file.ast.program.body.some((s) => s.type === 'ImportDeclaration' && /^sygnal(\/jsx(-dev)?-runtime)?$/.test(s.source.value))) return true
  let jsx = false
  walk(file.ast.program, (n) => { if (n.type === 'JSXElement' || n.type === 'JSXFragment') jsx = true; return !jsx })
  return jsx
}

function checkServerImports(project, file, report) {
  if (SERVER_SPEC.test(file.path)) return
  let client
  for (const stmt of file.ast.program.body) {
    if (stmt.type !== 'ImportDeclaration' || stmt.importKind === 'type' || !SERVER_SPEC.test(stmt.source.value)) continue
    if (client === undefined) client = isClient(file)
    if (!client) return
    const target = project.loadImport(file, stmt.source.value)
    const ex = target?.ast && serverExports(target)
    if (!ex) continue
    const fns = [...ex.keys()].filter((k) => ex.get(k) === 'fn')
    for (const sp of stmt.specifiers) {
      if (sp.type !== 'ImportSpecifier' || sp.importKind === 'type') continue
      const name = sp.imported.type === 'Identifier' ? sp.imported.name : sp.imported.value
      const kind = ex.get(name)
      if (kind === 'fn' || kind === 'unknown' || (!kind && ex[OPEN])) continue
      const near = closestName(name, fns)
      const src = stmt.source.value
      report({
        code: 'SYG691',
        file,
        node: sp.imported,
        message: kind
          ? `'${name}' from '${src}' is not a query, mutation or stream: the client build has only those (sygnal/vite api.functions), so it is undefined there`
          : `'${src}' has no server function '${name}'${near ? ` (did you mean '${near}'?)` : ''}`,
        fix: kind ? `move '${name}' out of the *.server module (a shared module both sides import), or make it a query, mutation or stream`
          : near ? `import '${near}'` : `export '${name}' from ${src} as a query, mutation or stream${fns.length ? `, or use one of: ${fns.join(', ')}` : ''}`,
        data: { name, path: [src], suggestion: near },
      })
    }
  }
}

export default {
  id: 'unknown-endpoint',
  codes: ['SYG691'],
  description: 'An orpcClient member chain that names no procedure of the contract, or a client import from a *.server module that is no server function',
  run(project, report) {
    const trees = new WeakMap()
    const treeFor = (c) => {
      if (!trees.has(c.call)) trees.set(c.call, treeOf(project, c.file, c.call.arguments[0]))
      return trees.get(c.call)
    }
    for (const p of project.scanned) {
      const file = project.files.get(p)
      if (!file?.ast) continue
      checkServerImports(project, file, report)
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
