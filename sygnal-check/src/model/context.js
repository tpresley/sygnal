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
 *   staticContextReads(project, file, staticProps) → Array<{ name, node, file, legacy? }>
 *     PLAN-13 F-1: the reads in the declaration statics' second parameter: `resources` entries,
 *     `timers`, `connections`, `head`, `browser`, `route`. 7.2: that parameter is the bag (what the
 *     view gets: `{ ...props, state, context, uid }`), so `(s, { context: { x } })` / `b.context.x`
 *     read the context; until 8.0 the context's own fields are on the bag too, so a top-level key
 *     other than state / context / uid (`(s, { x })`, `b.x`) is a `legacy: true` read: a context
 *     field or a prop, which only the declared context keys tell apart (SYG170, SYG458)
 *   staticFunctions(project, file, staticProps) → Array<{ name, path, file, node }>
 *     the declaration statics' functions (the static itself, or each function of an object
 *     value), `path` 'resources.item' / 'timers'
 *   BAG_KEYS   the keys of the bag that are never context fields: state, context, uid
 */
import { walk, unwrap, isFunction, propName, memberName, stringValue } from '../ast.js'
import { resolveExpr } from './resolve.js'

export function contextReads(fn, index = 0, direct = false) {
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
  // `direct`: the parameter is read as the context itself (PLAN-13 F-1; a declaration static's bag
  // until 8.0, whose top-level keys may be context fields: staticContextReads)
  if (direct) {
    if (first?.type === 'ObjectPattern') fromPattern(first)
    else if (first?.type === 'Identifier') locals.add(first.name)
  } else if (first?.type === 'ObjectPattern') {
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

export const DECLARATION_STATICS = ['resources', 'timers', 'connections', 'head', 'browser', 'route']
export const BAG_KEYS = new Set(['state', 'context', 'uid'])

export function staticFunctions(project, file, sp) {
  const out = []
  const seen = new Set()
  const fnOf = (name, path, f, n) => {
    const h = isFunction(n) ? { file: f, node: n } : resolveExpr(project, f, n)
    if (h?.node && isFunction(h.node) && !seen.has(h.node)) {
      seen.add(h.node)
      out.push({ name, path, file: h.file, node: h.node })
    }
    return h
  }
  for (const k of DECLARATION_STATICS) {
    if (!sp[k]) continue
    const v = fnOf(k, k, file, sp[k])
    // an object of functions (resources, or timers / head as objects)
    if (v?.node?.type === 'ObjectExpression') {
      for (const q of v.node.properties) {
        if (q.type === 'SpreadElement') continue
        const key = propName(q)
        fnOf(k, key ? `${k}.${key}` : k, v.file, q.type === 'ObjectMethod' ? q : q.value)
      }
    }
  }
  return out
}

export function staticContextReads(project, file, sp) {
  const out = []
  for (const { file: f, node } of staticFunctions(project, file, sp)) {
    // 7.2: the bag; `context` on it is the context
    for (const x of contextReads(node, 1) || []) out.push({ ...x, file: f })
    // until 8.0: the context's own fields on the bag (or a prop of that name)
    for (const x of contextReads(node, 1, true) || []) if (!BAG_KEYS.has(x.name)) out.push({ ...x, file: f, legacy: true })
  }
  return out
}

/** Every context key a scanned component's `.context` declares (memoized per build). */
export function declaredContextKeys(project) {
  if (project._declaredContextKeys) return project._declaredContextKeys
  const out = new Set()
  for (const c of project.components) for (const k of c.contextKeys || []) out.add(k)
  return (project._declaredContextKeys = out)
}

/** The model/static reads that are context reads: a legacy bag read only names a declared context key. */
export function modelContextReads(project, comp) {
  const reads = comp.contextReadsModel || []
  if (!reads.some(r => r.legacy)) return reads
  const keys = declaredContextKeys(project)
  return reads.filter(r => !r.legacy || keys.has(r.name))
}
