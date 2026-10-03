/**
 * Intent analysis: action names, DOM selectors, and the source aliases.
 */
import { walk, unwrap, isFunction, propName, memberName, stringValue } from '../ast.js'
import { findBinding } from '../scope.js'
import { evalStrings, DYN } from '../strings.js'
import { GLOBAL_SELECTORS } from '../selectors.js'

// Real methods of MainDOMSource; any other property is the `DOM.click('.x')`
// style shorthand for select(x).events(prop).
export const DOM_SOURCE_METHODS = new Set([
  'select', 'events', 'elements', 'element', 'isolateSource', 'isolateSink', 'dispose',
  'namespace', '_namespace', 'then', 'toString', 'constructor', 'map', 'filter',
])

/**
 * Source-name aliases visible inside `fn`:
 *   ({ DOM, EVENTS: ev }) => …           → DOM → {'DOM'}, EVENTS → {'ev'}
 *   (sources) => sources.DOM.select(…)    → sourcesParam = 'sources'
 *   const { DOM } = sources               → DOM → {'DOM'}
 */
export function sourceAliases(fn) {
  const aliases = new Map()
  let sourcesParam = null
  const add = (src, local) => {
    if (!aliases.has(src)) aliases.set(src, new Set())
    aliases.get(src).add(local)
  }
  const fromPattern = (pat) => {
    for (const p of pat.properties) {
      if (p.type !== 'ObjectProperty') continue
      const key = propName(p)
      let v = p.value
      if (v.type === 'AssignmentPattern') v = v.left
      if (key && v.type === 'Identifier') add(key, v.name)
    }
  }
  let first = fn.params?.[0]
  if (first?.type === 'AssignmentPattern') first = first.left
  if (first?.type === 'ObjectPattern') fromPattern(first)
  else if (first?.type === 'Identifier') sourcesParam = first.name
  if (sourcesParam) {
    walk(fn.body, (n) => {
      if (n.type === 'VariableDeclarator' && n.id.type === 'ObjectPattern' &&
          unwrap(n.init)?.type === 'Identifier' && unwrap(n.init).name === sourcesParam) {
        fromPattern(n.id)
      }
      return true
    })
  }
  return { aliases, sourcesParam }
}

/** Is `node` a reference to source `name` (e.g. DOM) given the aliases? */
export function isSourceRef(node, name, { aliases, sourcesParam }) {
  node = unwrap(node)
  if (!node) return false
  if (node.type === 'Identifier') return !!aliases.get(name)?.has(node.name)
  if (node.type === 'MemberExpression' && sourcesParam) {
    const o = unwrap(node.object)
    return o.type === 'Identifier' && o.name === sourcesParam && memberName(node) === name
  }
  return false
}

/**
 * Describe a DOM select chain: DOM, DOM.select(a), DOM.select(a).select(b) …
 * @returns {{ global: boolean } | null}   null when `node` is not a DOM chain
 */
function domChain(node, sa) {
  node = unwrap(node)
  if (isSourceRef(node, 'DOM', sa)) return { global: false, root: true }
  if (node?.type === 'CallExpression') {
    const callee = unwrap(node.callee)
    if (callee.type === 'MemberExpression' && memberName(callee) === 'select') {
      const inner = domChain(callee.object, sa)
      if (inner) {
        const s = stringValue(node.arguments[0])
        return { global: inner.global || (s != null && GLOBAL_SELECTORS.has(s.trim())), root: false }
      }
    }
  }
  return null
}

export function selectorValue(arg, file) {
  const s = stringValue(arg)
  if (s != null) return { selector: s, dynamic: false }
  const alts = evalStrings(arg, { fileInfo: file })
  if (alts.length === 1 && !alts[0].includes(DYN)) return { selector: alts[0], dynamic: false }
  return { selector: null, dynamic: true }
}

/** Return-value expressions of `fn` (arrow expression body or its own `return`s). */
export function returnedExpressions(fn) {
  if (fn.body.type !== 'BlockStatement') return [fn.body]
  const out = []
  walk(fn.body, (n) => {
    if (n !== fn.body && isFunction(n)) return false
    if (n.type === 'ReturnStatement' && n.argument) out.push(n.argument)
    return true
  })
  return out
}

/**
 * @returns {{
 *   fn, file,
 *   known: boolean,               // every action name is statically known
 *   actions: Array<{ name, node }>,
 *   selectors: Array<{ selector: string|null, node, method, dynamic, global,
 *                      control?, controls? }>,   // set by resolveSelectorControls (controls.js)
 * }}
 */
export function analyzeIntent(file, fn) {
  const result = { fn, file, known: true, actions: [], selectors: [] }
  if (!fn || !isFunction(fn)) { result.known = false; return result }
  const sa = sourceAliases(fn)

  // --- actions ---
  const seen = new Set()
  const addObject = (obj, depth = 0) => {
    obj = unwrap(obj)
    if (!obj || depth > 4) { result.known = false; return }
    if (obj.type === 'ObjectExpression') {
      for (const p of obj.properties) {
        if (p.type === 'SpreadElement') { result.known = false; continue }
        const name = propName(p)
        if (name == null) { result.known = false; continue }
        if (!seen.has(name)) { seen.add(name); result.actions.push({ name, node: p.key }) }
      }
    } else if (obj.type === 'Identifier') {
      const b = findBinding(file, obj.name, obj)
      if (b && b.kind === 'var' && b.init) addObject(b.init, depth + 1)
      else result.known = false
    } else if (obj.type === 'ConditionalExpression') {
      addObject(obj.consequent, depth + 1); addObject(obj.alternate, depth + 1)
    } else {
      // single-stream intent or something we can't see through
      result.known = false
    }
  }
  const rets = returnedExpressions(fn)
  if (rets.length === 0) result.known = false
  rets.forEach(r => addObject(r))

  // --- DOM selectors ---
  walk(fn.body, (n) => {
    if (n.type !== 'CallExpression') return true
    const callee = unwrap(n.callee)
    if (callee.type !== 'MemberExpression') return true
    const method = memberName(callee)
    if (!method) return true
    const chain = domChain(callee.object, sa)
    if (!chain) return true
    let takesSelector
    if (chain.root) takesSelector = method === 'select' || !DOM_SOURCE_METHODS.has(method)
    else takesSelector = method === 'select'
    if (!takesSelector || !n.arguments[0]) return true
    const arg = n.arguments[0]
    const v = selectorValue(arg, file)
    const global = chain.global || (v.selector != null && GLOBAL_SELECTORS.has(v.selector.trim()))
    result.selectors.push({ ...v, node: arg, method, global })
    return true
  })
  return result
}
