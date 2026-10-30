/**
 * Minimal lexical binding lookup over the parent index of one file.
 *
 * findBinding(fileInfo, name, fromNode) walks outward from `fromNode` and
 * returns the first declaration of `name`:
 *   { kind: 'var',      node: VariableDeclarator, init, declKind }
 *   { kind: 'pattern',  node }        destructured variable (value unknown)
 *   { kind: 'function', node: FunctionDeclaration }
 *   { kind: 'class',    node }
 *   { kind: 'param',    node: function }
 *   { kind: 'import',   node: ImportDeclaration, specifier, imported, source }
 * or null when the name is not declared in this file (a global).
 */
import { isFunction } from './ast.js'

export function patternNames(p, out = []) {
  if (!p) return out
  switch (p.type) {
    case 'Identifier': out.push(p.name); break
    case 'ObjectPattern':
      for (const prop of p.properties) {
        if (prop.type === 'RestElement') patternNames(prop.argument, out)
        else patternNames(prop.value, out)
      }
      break
    case 'ArrayPattern': for (const e of p.elements) patternNames(e, out); break
    case 'AssignmentPattern': patternNames(p.left, out); break
    case 'RestElement': patternNames(p.argument, out); break
    case 'TSParameterProperty': patternNames(p.parameter, out); break
  }
  return out
}

function declInStatement(stmt, name) {
  if (!stmt) return null
  if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
    return stmt.declaration ? declInStatement(stmt.declaration, name) : null
  }
  if (stmt.type === 'VariableDeclaration') {
    for (const d of stmt.declarations) {
      if (d.id.type === 'Identifier') {
        if (d.id.name === name) return { kind: 'var', node: d, init: d.init, declKind: stmt.kind }
      } else if (patternNames(d.id).includes(name)) {
        return { kind: 'pattern', node: d }
      }
    }
  }
  if ((stmt.type === 'FunctionDeclaration') && stmt.id?.name === name) return { kind: 'function', node: stmt }
  if (stmt.type === 'ClassDeclaration' && stmt.id?.name === name) return { kind: 'class', node: stmt }
  if (stmt.type === 'ImportDeclaration' && stmt.importKind !== 'type') {
    for (const s of stmt.specifiers) {
      if (s.local.name !== name || s.importKind === 'type') continue
      const imported = s.type === 'ImportDefaultSpecifier' ? 'default'
        : s.type === 'ImportNamespaceSpecifier' ? '*'
          : (s.imported.type === 'Identifier' ? s.imported.name : s.imported.value)
      return { kind: 'import', node: stmt, specifier: s, imported, source: stmt.source.value }
    }
  }
  return null
}

// Per-scope-node table of the declarations a statement list holds: name → the first decl
// (declInStatement's answer). ASTs never change after parsing (the parse cache relies on it), so
// the table lives as long as the node. native-tooling experiment E-2.
const BODY_TABLES = new WeakMap()
const NONE = new Map()

function bodyTable(scope, body) {
  let t = BODY_TABLES.get(scope)
  if (t) return t
  t = new Map()
  for (const stmt of body) {
    for (const n of stmtNames(stmt)) if (!t.has(n)) { const d = declInStatement(stmt, n); if (d) t.set(n, d) }
  }
  BODY_TABLES.set(scope, t.size ? t : NONE)
  return t
}

// Every name declInStatement could match for this statement.
function stmtNames(stmt) {
  if (!stmt) return []
  if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') return stmt.declaration ? stmtNames(stmt.declaration) : []
  if (stmt.type === 'VariableDeclaration') return stmt.declarations.flatMap(d => patternNames(d.id))
  if ((stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') && stmt.id?.name) return [stmt.id.name]
  if (stmt.type === 'ImportDeclaration') return stmt.specifiers.map(s => s.local.name)
  return []
}

function declInScope(scope, name) {
  if (isFunction(scope)) {
    for (const p of scope.params) {
      if (patternNames(p).includes(name)) return { kind: 'param', node: scope }
    }
    if (scope.type === 'FunctionExpression' && scope.id?.name === name) return { kind: 'function', node: scope }
    return null
  }
  if (scope.type === 'CatchClause') {
    return scope.param && patternNames(scope.param).includes(name) ? { kind: 'param', node: scope } : null
  }
  if (scope.type === 'ForStatement' || scope.type === 'ForInStatement' || scope.type === 'ForOfStatement') {
    const init = scope.init || scope.left
    if (init && init.type === 'VariableDeclaration') return declInStatement(init, name)
    return null
  }
  const body = scope.type === 'Program' || scope.type === 'BlockStatement' || scope.type === 'StaticBlock'
    ? scope.body
    : scope.type === 'SwitchCase' ? scope.consequent : null
  if (!body) return null
  return bodyTable(scope, body).get(name) || null
}

export function findBinding(fileInfo, name, fromNode) {
  let node = fromNode
  let last = null
  while (node) {
    const d = declInScope(node, name)
    if (d) return d
    last = node
    node = fileInfo.parents.get(node)
  }
  // Synthetic nodes (no parent chain) fall back to module scope.
  return last?.type === 'Program' ? null : declInScope(fileInfo.ast.program, name)
}

/** Top-level binding lookup (module scope only). */
export function findTopLevel(fileInfo, name) {
  return declInScope(fileInfo.ast.program, name)
}
