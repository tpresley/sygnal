/**
 * Cross-file value resolution: follow identifiers to their definitions,
 * through imports and exports.
 */
import { unwrap, isFunction, memberName } from '../ast.js'
import { findBinding, findTopLevel } from '../scope.js'
import { resolveImport } from '../files.js'

const MAX_DEPTH = 8

/**
 * Find what a module exports under `exportName` ('default' or a name).
 * @returns {{ file, node } | null}  node = the exported expression / declaration
 */
export function resolveExport(project, file, exportName, depth = 0) {
  if (!file || depth > MAX_DEPTH) return null
  for (const stmt of file.ast.program.body) {
    if (stmt.type === 'ExportDefaultDeclaration' && exportName === 'default') {
      const d = stmt.declaration
      if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration')) return { file, node: d }
      return resolveExpr(project, file, d, depth + 1)
    }
    if (stmt.type === 'ExportNamedDeclaration') {
      const d = stmt.declaration
      if (d && exportName !== 'default') {
        if (d.type === 'FunctionDeclaration' && d.id?.name === exportName) return { file, node: d }
        if (d.type === 'VariableDeclaration') {
          for (const decl of d.declarations) {
            if (decl.id.type === 'Identifier' && decl.id.name === exportName) {
              return decl.init ? resolveExpr(project, file, decl.init, depth + 1) : null
            }
          }
        }
      }
      for (const s of stmt.specifiers || []) {
        const exported = s.exported.type === 'Identifier' ? s.exported.name : s.exported.value
        if (exported !== exportName) continue
        const local = s.local ? (s.local.type === 'Identifier' ? s.local.name : s.local.value) : 'default'
        if (stmt.source) {
          const target = project.loadImport(file, stmt.source.value)
          return target ? resolveExport(project, target, local, depth + 1) : null
        }
        const b = findTopLevel(file, local)
        return bindingValue(project, file, b, depth + 1)
      }
    }
    if (stmt.type === 'ExportAllDeclaration' && exportName !== 'default') {
      const target = project.loadImport(file, stmt.source.value)
      const r = target && resolveExport(project, target, exportName, depth + 1)
      if (r) return r
    }
  }
  return null
}

export function bindingValue(project, file, b, depth = 0) {
  if (!b) return null
  if (b.kind === 'function' || b.kind === 'class') return { file, node: b.node }
  if (b.kind === 'var') return b.init ? resolveExpr(project, file, b.init, depth) : null
  if (b.kind === 'import') {
    if (b.imported === '*') return null
    const target = project.loadImport(file, b.source)
    return target ? resolveExport(project, target, b.imported, depth) : null
  }
  return null
}

/**
 * Resolve an expression to its definition. Identifiers are followed to
 * their const initializer / function declaration / import. `lazy(() =>
 * import('./X'))` resolves to X's default export.
 * @returns {{ file, node }} — node is the final expression (unwrapped)
 */
export function resolveExpr(project, file, node, depth = 0) {
  node = unwrap(node)
  if (!node || depth > MAX_DEPTH) return node ? { file, node } : null
  if (node.type === 'Identifier') {
    const b = findBinding(file, node.name, node)
    if (!b) return { file, node }
    return bindingValue(project, file, b, depth + 1) || { file, node }
  }
  if (node.type === 'CallExpression') {
    const callee = unwrap(node.callee)
    // lazy(() => import('./X'))
    if (callee.type === 'Identifier' && callee.name === 'lazy' && node.arguments[0]) {
      const fn = unwrap(node.arguments[0])
      let body = isFunction(fn) ? unwrap(fn.body) : null
      if (body && body.type === 'BlockStatement') {
        const ret = body.body.find(s => s.type === 'ReturnStatement')
        body = ret ? unwrap(ret.argument) : null
      }
      // import('./X') or import('./X').then(m => m.Y) (only the default form is followed)
      if (body && body.type === 'ImportExpression' && body.source.type === 'StringLiteral') {
        const target = project.loadImport(file, body.source.value)
        return (target && resolveExport(project, target, 'default', depth + 1)) || { file, node }
      }
      if (body && body.type === 'CallExpression' && body.callee.type === 'Import' && body.arguments[0]?.type === 'StringLiteral') {
        const target = project.loadImport(file, body.arguments[0].value)
        return (target && resolveExport(project, target, 'default', depth + 1)) || { file, node }
      }
    }
  }
  if (node.type === 'MemberExpression' && unwrap(node.object).type === 'Identifier') {
    // Namespace import: NS.Comp
    const b = findBinding(file, unwrap(node.object).name, node)
    const name = memberName(node)
    if (b && b.kind === 'import' && b.imported === '*' && name) {
      const target = project.loadImport(file, b.source)
      return (target && resolveExport(project, target, name, depth + 1)) || { file, node }
    }
  }
  return { file, node }
}

export function resolveSpecifier(file, spec) {
  return resolveImport(file.path, spec)
}
