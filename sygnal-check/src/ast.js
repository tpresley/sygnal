/**
 * Parsing and a small hand-written AST walker (no @babel/traverse).
 */
import { parse as babelParse } from '@babel/parser'

// Keys that never contain runtime code we care about.
const SKIP_KEYS = new Set([
  'loc', 'start', 'end', 'extra', 'range',
  'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens',
  'typeAnnotation', 'returnType', 'typeParameters', 'superTypeParameters', 'typeArguments',
  'predicate', 'implements',
])

const TYPE_ONLY = new Set([
  'TSTypeAliasDeclaration', 'TSInterfaceDeclaration', 'TSDeclareFunction', 'TSModuleDeclaration',
  'TSEnumDeclaration', 'TypeAlias', 'InterfaceDeclaration', 'OpaqueType', 'DeclareModule',
])

export function parseSource(code, file) {
  const isTS = /\.(c|m)?tsx?$/.test(file)
  const isTSX = /\.tsx$/.test(file)
  const plugins = isTS
    ? (isTSX ? ['typescript', 'jsx'] : ['typescript'])
    : ['jsx']
  plugins.push('decorators-legacy', 'importAttributes')
  return babelParse(code, {
    sourceType: 'module',
    sourceFilename: file,
    plugins,
    errorRecovery: true,
    allowReturnOutsideFunction: true,
    allowImportExportEverywhere: true,
    allowAwaitOutsideFunction: true,
    allowUndeclaredExports: true,
  })
}

export function childNodes(node) {
  const out = []
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue
    const v = node[key]
    if (!v || typeof v !== 'object') continue
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') out.push(c)
    } else if (typeof v.type === 'string') {
      out.push(v)
    }
  }
  return out
}

/**
 * Depth-first walk. `visit(node, parent)` may return false to skip the
 * node's children.
 */
export function walk(node, visit, parent = null) {
  if (!node || TYPE_ONLY.has(node.type)) return
  if (visit(node, parent) === false) return
  for (const c of childNodes(node)) walk(c, visit, node)
}

/** Records parent pointers for every node under `root` into `parents`. */
export function indexParents(root, parents) {
  walk(root, (node, parent) => { if (parent) parents.set(node, parent) })
}

export const isFunction = (n) => !!n && (
  n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' ||
  n.type === 'ArrowFunctionExpression' || n.type === 'ObjectMethod' || n.type === 'ClassMethod'
)

/** Strip TS-only expression wrappers (`x as T`, `x!`, `<T>x`, `x satisfies T`) and parens. */
export function unwrap(node) {
  while (node && (
    node.type === 'TSAsExpression' || node.type === 'TSNonNullExpression' ||
    node.type === 'TSTypeAssertion' || node.type === 'TSSatisfiesExpression' ||
    node.type === 'ParenthesizedExpression' || node.type === 'TypeCastExpression' ||
    node.type === 'TSInstantiationExpression'
  )) node = node.expression
  return node
}

export function propName(prop) {
  if (!prop) return null
  const key = prop.key
  if (!prop.computed) {
    if (key.type === 'Identifier') return key.name
    if (key.type === 'StringLiteral' || key.type === 'NumericLiteral') return String(key.value)
  } else if (key.type === 'StringLiteral') {
    return key.value
  } else if (key.type === 'TemplateLiteral' && key.expressions.length === 0) {
    return key.quasis[0].value.cooked
  }
  return null
}

export function memberName(member) {
  if (!member) return null
  const p = member.property
  if (!member.computed && p.type === 'Identifier') return p.name
  if (p.type === 'StringLiteral') return p.value
  return null
}

export function stringValue(node) {
  node = unwrap(node)
  if (!node) return null
  if (node.type === 'StringLiteral') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
  return null
}

export function loc(node) {
  const s = node?.loc?.start
  return s ? { line: s.line, column: s.column + 1 } : { line: 1, column: 1 }
}

export function jsxName(nameNode) {
  if (!nameNode) return null
  if (nameNode.type === 'JSXIdentifier') return nameNode.name
  if (nameNode.type === 'JSXMemberExpression') return jsxName(nameNode.object) + '.' + nameNode.property.name
  if (nameNode.type === 'JSXNamespacedName') return nameNode.namespace.name + ':' + nameNode.name.name
  return null
}

export function jsxAttr(openingElement, name) {
  for (const a of openingElement.attributes) {
    if (a.type === 'JSXAttribute' && jsxName(a.name) === name) return a
  }
  return null
}

/** The expression of a JSX attribute value (string literal or {expr}); null for bare attributes. */
export function jsxAttrExpr(attr) {
  if (!attr || !attr.value) return null
  if (attr.value.type === 'JSXExpressionContainer') {
    return attr.value.expression.type === 'JSXEmptyExpression' ? null : attr.value.expression
  }
  return attr.value
}
