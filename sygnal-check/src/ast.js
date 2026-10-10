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
 * Depth-first pre-order walk. `visit(node, parent)` may return false to skip
 * the node's children. Children are visited in `childNodes` order; type-only
 * declarations (TYPE_ONLY) are never visited, nor is anything under them.
 *
 * A walk from a `Program` (every rule walks every file, G-660) runs over a
 * flat pre-order list of the program's nodes, built on its first walk and kept
 * per Program node (WeakMap: it lives exactly as long as the AST, which the
 * parse cache reuses across builds). This relies on ASTs not changing after
 * parsing, which the frozen-AST parity tests (p7-c3-cache) enforce.
 */
export function walk(node, visit, parent = null) {
  if (!node || TYPE_ONLY.has(node.type)) return
  if (node.type === 'Program') walkFlat(flatOf(node), visit, parent)
  else walkTree(node, visit, parent)
}

// The recursive walk (any root other than a Program), without the
// intermediate children array of `childNodes`, same order.
function walkTree(node, visit, parent) {
  if (visit(node, parent) === false) return
  const keys = Object.keys(node)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (SKIP_KEYS.has(key)) continue
    const v = node[key]
    if (!v || typeof v !== 'object') continue
    if (Array.isArray(v)) {
      for (let j = 0; j < v.length; j++) {
        const c = v[j]
        if (c && typeof c.type === 'string' && !TYPE_ONLY.has(c.type)) walkTree(c, visit, node)
      }
    } else if (typeof v.type === 'string' && !TYPE_ONLY.has(v.type)) {
      walkTree(v, visit, node)
    }
  }
}

/**
 * A Program's walk order, flattened: `nodes[i]` in pre-order, `parents[i]` its
 * parent, `ends[i]` the index after its subtree (where a skip continues).
 */
const flatCache = new WeakMap()

function flatOf(program) {
  let flat = flatCache.get(program)
  if (!flat) {
    flat = { nodes: [], parents: [], ends: [] }
    flatten(program, null, flat)
    flatCache.set(program, flat)
  }
  return flat
}

function flatten(node, parent, flat) {
  const { nodes, parents, ends } = flat
  const at = nodes.length
  nodes.push(node)
  parents.push(parent)
  ends.push(0)
  const keys = Object.keys(node)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (SKIP_KEYS.has(key)) continue
    const v = node[key]
    if (!v || typeof v !== 'object') continue
    if (Array.isArray(v)) {
      for (let j = 0; j < v.length; j++) {
        const c = v[j]
        if (c && typeof c.type === 'string' && !TYPE_ONLY.has(c.type)) flatten(c, node, flat)
      }
    } else if (typeof v.type === 'string' && !TYPE_ONLY.has(v.type)) {
      flatten(v, node, flat)
    }
  }
  ends[at] = nodes.length
}

function walkFlat(flat, visit, parent) {
  const { nodes, parents, ends } = flat
  const n = nodes.length
  if (visit(nodes[0], parent) === false) return
  for (let i = 1; i < n;) {
    if (visit(nodes[i], parents[i]) === false) i = ends[i]
    else i++
  }
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

/**
 * The range end of a node (PLAN-7 C-2, spike 0-S1): 1-based line, 1-based
 * column one past the last character (exclusive), so the underlined text is
 * source line `line`.slice(column - 1) .. line `endLine`.slice(0, endColumn - 1).
 * Without a node location: a one-character range at the start.
 */
export function endLoc(node) {
  const e = node?.loc?.end
  if (e) return { endLine: e.line, endColumn: e.column + 1 }
  const { line, column } = loc(node)
  return { endLine: line, endColumn: column + 1 }
}

/** The FileInfo whose AST contains `node` (`hint` is tried first), or null. */
export function fileOfNode(project, node, hint) {
  if (hint && fileContains(hint, node)) return hint
  for (const f of project.files.values()) if (f && f !== hint && fileContains(f, node)) return f
  return null
}

function fileContains(file, node) {
  let n = node
  while (n) {
    if (n === file.ast.program) return true
    n = file.parents.get(n)
  }
  return false
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
