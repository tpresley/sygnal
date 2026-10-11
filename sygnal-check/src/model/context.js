/**
 * Context consumption (PLAN-7 N-1): which context entries a function reads, with the nodes.
 *
 *   contextReads(fn, index = 0) → Array<{ name, node }> | null
 *     the reads of the context through the function's parameter `index` (0: a view's props,
 *     3: a reducer's `props`): `({ context }) => context.x`, `({ context: { x } })`,
 *     `(props) => props.context.x`, `const { x } = context`. `node`: the property (Identifier or
 *     string literal) of the member expression, or the key of the pattern property. Order: the
 *     parameter's pattern first, then source order. null when `fn` has no parameter list.
 *   contextNames(reads) → string[] | null   the names, once each, in order (the --graph
 *     `contextConsumes`; it was computed in graph.js before N-1 and is byte-identical)
 *   reducerContextReads(project, file, modelNode) → Array<{ name, node, file }>
 *     the reads in a model's handlers (4th parameter), sink functions included
 */
import { walk, unwrap, isFunction, propName, memberName, stringValue } from '../ast.js'
import { resolveExpr } from './resolve.js'

export function contextReads(fn, index = 0) {
  if (!fn || !fn.params) return null
  const out = []
  const locals = new Set()
  let propsName = null
  let first = fn.params[index]
  if (first?.type === 'AssignmentPattern') first = first.left
  const fromPattern = (pat) => {
    for (const p of pat.properties) {
      if (p.type !== 'ObjectProperty') continue
      const k = propName(p)
      if (k) out.push({ name: k, node: p.key })
    }
  }
  if (first?.type === 'ObjectPattern') {
    for (const p of first.properties) {
      if (p.type !== 'ObjectProperty' || propName(p) !== 'context') continue
      let v = p.value
      if (v.type === 'AssignmentPattern') v = v.left
      if (v.type === 'Identifier') locals.add(v.name)
      else if (v.type === 'ObjectPattern') fromPattern(v)
    }
  } else if (first?.type === 'Identifier') {
    propsName = first.name
  }
  const isContextRef = (n) => {
    n = unwrap(n)
    if (!n) return false
    if (n.type === 'Identifier') return locals.has(n.name)
    if (propsName && n.type === 'MemberExpression' && memberName(n) === 'context') {
      const o = unwrap(n.object)
      return o.type === 'Identifier' && o.name === propsName
    }
    return false
  }
  walk(fn.body, (n) => {
    if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && isContextRef(n.object)) {
      const k = memberName(n) ?? (n.computed ? stringValue(n.property) : null)
      if (k) out.push({ name: k, node: n.property })
    } else if (n.type === 'VariableDeclarator' && n.id.type === 'ObjectPattern' && isContextRef(n.init)) {
      fromPattern(n.id)
    }
    return true
  })
  return out
}

export function contextNames(reads) {
  return reads ? [...new Set(reads.map(r => r.name))] : null
}

export function reducerContextReads(project, file, modelNode) {
  const out = []
  const r = resolveExpr(project, file, modelNode)
  let obj = r?.node
  let f = r?.file
  // undoable(model, options)
  if (obj?.type === 'CallExpression' && obj.arguments[0]) {
    const inner = resolveExpr(project, f, obj.arguments[0])
    obj = inner?.node; f = inner?.file
  }
  if (obj?.type !== 'ObjectExpression') return out
  const seen = new Set()
  const handler = (hf, n) => {
    const h = isFunction(n) ? { file: hf, node: n } : resolveExpr(project, hf, n)
    if (!h?.node || !isFunction(h.node) || seen.has(h.node)) return h
    seen.add(h.node)
    for (const x of contextReads(h.node, 3) || []) out.push({ ...x, file: h.file })
    return h
  }
  for (const p of obj.properties) {
    if (p.type === 'SpreadElement') continue
    const v = handler(f, p.type === 'ObjectMethod' ? p : p.value)
    if (v?.node?.type === 'ObjectExpression') {
      for (const q of v.node.properties) if (q.type !== 'SpreadElement') handler(v.file, q.type === 'ObjectMethod' ? q : q.value)
    }
  }
  return out
}
