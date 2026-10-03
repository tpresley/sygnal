/**
 * View analysis: which classes / ids a component renders in its OWN DOM
 * scope, and which child components it renders.
 *
 * Ownership rules (mirroring the runtime):
 *   - Every capitalized JSX tag is instantiated as an isolated sub-component
 *     (pragma), so its JSX — and any JSX passed to it as children/slots or
 *     props — lives in the CHILD's scope, not the parent's.
 *   - <Collection>/<Switchable> (either case) render isolated children; their
 *     `className` becomes a wrapper element in the PARENT's scope.
 *   - Fragment, Portal, Transition, Suspense, ClientOnly, Slot are markers:
 *     their JSX children stay in the parent's scope.
 *   - JSX in module-level helper functions that the view references (e.g.
 *     `{items.map(renderItem)}`) is part of the view.
 */
import { walk, unwrap, isFunction, jsxName, jsxAttr, jsxAttrExpr, propName, stringValue, loc } from '../ast.js'
import { evalStrings, tokenize, classTokens, DYN } from '../strings.js'
import { hyperscriptSel } from '../selectors.js'
import { findBinding } from '../scope.js'
import { resolveExpr, bindingValue } from './resolve.js'
import { resolveControlJSX } from './controls.js'

const TRANSPARENT = new Set(['Fragment', 'Portal', 'Transition', 'Suspense', 'ClientOnly', 'Slot', 'React.Fragment'])
const COLLECTION = new Set(['Collection', 'collection'])
const SWITCHABLE = new Set(['Switchable', 'switchable'])

export function newSink() {
  return {
    classes: { names: new Set(), patterns: [] },
    ids: { names: new Set(), patterns: [] },
    // child component usages rendered from this scope
    children: [],
    // <Collection>/<Switchable> usages (also listed in children)
    collections: [],
    // controls rendered in this scope: Map<Control, JSXOpeningElement[]> (PLAN-4 CT-1)
    controls: new Map(),
    // intrinsic elements rendered in this scope: [{ node: JSXElement, file, tag }] (--fix --controls)
    elements: [],
    // class name → number of class attributes / selectors that may produce it (--fix --controls)
    classCounts: new Map(),
  }
}

export const HYPERSCRIPT_TAGS = new Set([
  'a', 'article', 'aside', 'button', 'div', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'i', 'img', 'input', 'label', 'li', 'main', 'nav', 'ol', 'option', 'p', 'section', 'select', 'span',
  'strong', 'table', 'tbody', 'td', 'textarea', 'th', 'thead', 'tr', 'ul',
])

function isHyperscriptImport(file, ident) {
  const b = findBinding(file, ident.name, ident)
  return b?.kind === 'import' && /^(sygnal|@cycle\/dom)(\/|$)/.test(b.source)
}

const isComponentTag =(name) => !!name && (/^[A-Z]/.test(name) || name.includes('.'))

function addDynamic(set) {
  if (!set.patterns.some(p => p.source === '*')) set.patterns.push({ source: '*', re: /^.*$/ })
}

function addClassExpr(project, file, expr, sink) {
  const e = unwrap(expr)
  if (!e) return
  const into = { names: new Set(), patterns: [] }
  if (e.type === 'ObjectExpression' || e.type === 'ArrayExpression') {
    tokenize([classTokens([e], { fileInfo: file }).join(' ')], into)
  } else {
    tokenize(evalStrings(e, { fileInfo: file }), into)
  }
  mergeClasses(sink, into.names, into.patterns)
}

function mergeClasses(sink, names, patterns = []) {
  for (const n of names) {
    sink.classes.names.add(n)
    sink.classCounts.set(n, (sink.classCounts.get(n) || 0) + 1)
  }
  for (const p of patterns) if (!sink.classes.patterns.some(x => x.source === p.source)) sink.classes.patterns.push(p)
}

function addIdExpr(file, expr, sink) {
  const e = unwrap(expr)
  if (!e) return
  tokenize(evalStrings(e, { fileInfo: file }), sink.ids)
}

function handleHtmlAttrs(project, file, opening, sink) {
  for (const a of opening.attributes) {
    if (a.type === 'JSXSpreadAttribute') {
      // {...props} may carry className/id
      addDynamic(sink.classes)
      addDynamic(sink.ids)
      continue
    }
    const name = jsxName(a.name)
    const value = jsxAttrExpr(a)
    if (name === 'className' || name === 'class') addClassExpr(project, file, value, sink)
    else if (name === 'id') addIdExpr(file, value, sink)
    else if (name === 'innerHTML') { addDynamic(sink.classes); addDynamic(sink.ids) }
    else if ((name === 'attrs' || name === 'props') && unwrap(value)?.type === 'ObjectExpression') {
      for (const p of unwrap(value).properties) {
        if (p.type === 'SpreadElement') { addDynamic(sink.classes); addDynamic(sink.ids); continue }
        const k = propName(p)
        if (k === 'class' || k === 'className') addClassExpr(project, file, p.value, sink)
        else if (k === 'id') addIdExpr(file, p.value, sink)
        else if (k === 'innerHTML') { addDynamic(sink.classes); addDynamic(sink.ids) }
      }
    }
  }
}

/**
 * Collect the view of `fnNode` (in `file`) into `sink`.
 * `visited` guards against helper-function recursion.
 */
export function collectView(project, file, fnNode, sink = newSink(), visited = new Set()) {
  if (!fnNode || visited.has(fnNode)) return sink
  visited.add(fnNode)
  const body = isFunction(fnNode) ? fnNode.body : fnNode
  visitInto(project, file, body, sink, visited)
  return sink
}

function visitInto(project, file, root, sink, visited) {
  walk(root, (node) => {
    if (node.type === 'JSXElement') {
      handleElement(project, file, node, sink, visited)
      return false
    }
    if (node.type === 'CallExpression') {
      const callee = unwrap(node.callee)
      // snabbdom hyperscript: h('div.a#b', ...)
      if (callee.type === 'Identifier' && callee.name === 'h') {
        const sel = stringValue(node.arguments[0])
        if (sel) {
          const { classes, ids } = hyperscriptSel(sel)
          mergeClasses(sink, classes)
          ids.forEach(i => sink.ids.names.add(i))
        }
      } else if (callee.type === 'Identifier' && HYPERSCRIPT_TAGS.has(callee.name) && isHyperscriptImport(file, callee)) {
        // hyperscript helpers: div('.a#b', …)
        const sel = stringValue(node.arguments[0])
        if (sel) {
          const { classes, ids } = hyperscriptSel(sel)
          mergeClasses(sink, classes)
          ids.forEach(i => sink.ids.names.add(i))
        }
      }
    }
    if (node.type === 'Identifier') followHelper(project, file, node, sink, visited)
    return true
  })
}

/** If `ident` names a module-level helper function that renders JSX, walk it as part of this view. */
function followHelper(project, file, ident, sink, visited) {
  const b = findBinding(file, ident.name, ident)
  if (!b || !['function', 'var', 'import'].includes(b.kind)) return
  // Only module-level (or imported) helpers; locals inside the view are walked already.
  if (b.kind !== 'import' && !isTopLevel(file, b.kind === 'var' ? file.parents.get(b.node) : b.node)) return
  const r = b.kind === 'function' ? { file, node: b.node } : resolveExpr(project, file, ident)
  if (!r || !isFunction(r.node) || visited.has(r.node)) return
  if (project.isComponentFunction(r.file, r.node)) return
  if (!containsJSX(r.node)) return
  collectView(project, r.file, r.node, sink, visited)
}

function isTopLevel(file, decl) {
  let p = decl && file.parents.get(decl)
  if (p && (p.type === 'ExportNamedDeclaration' || p.type === 'ExportDefaultDeclaration')) p = file.parents.get(p)
  return p?.type === 'Program'
}

const jsxCache = new WeakMap()
function containsJSX(fn) {
  if (jsxCache.has(fn)) return jsxCache.get(fn)
  let found = false
  walk(fn.body, (n) => {
    if (found) return false
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') { found = true; return false }
    if (n.type === 'CallExpression' && unwrap(n.callee).type === 'Identifier' && unwrap(n.callee).name === 'h') { found = true; return false }
    return true
  })
  jsxCache.set(fn, found)
  return found
}

function refFor(project, file, expr) {
  const e = unwrap(expr)
  if (!e) return null
  const r = resolveExpr(project, file, e)
  if (r && isFunction(r.node)) return { file: r.file, node: r.node }
  return null
}

function exprName(expr) {
  const e = unwrap(expr)
  if (!e) return null
  if (e.type === 'Identifier') return e.name
  if (e.type === 'MemberExpression') return (exprName(e.object) || '?') + '.' + (e.property.name || '?')
  return null
}

function handleElement(project, file, el, sink, visited) {
  const opening = el.openingElement
  const name = jsxName(opening.name)

  if (COLLECTION.has(name) || SWITCHABLE.has(name)) {
    const kind = COLLECTION.has(name) ? 'collection' : 'switchable'
    const cls = jsxAttr(opening, 'className')
    if (cls) addClassExpr(project, file, jsxAttrExpr(cls), sink)
    const ofAttr = jsxAttr(opening, 'of')
    const ofExpr = unwrap(jsxAttrExpr(ofAttr))
    const targets = []
    if (kind === 'switchable' && ofExpr?.type === 'ObjectExpression') {
      for (const p of ofExpr.properties) if (p.type === 'ObjectProperty') targets.push(p.value)
    } else if (ofExpr) {
      targets.push(ofExpr)
    }
    const fromAttr = jsxAttr(opening, 'from')
    const fromExpr = jsxAttrExpr(fromAttr)
    const usage = {
      kind,
      tag: name,
      node: opening,
      from: fromExpr ? stringValue(fromExpr) : null,
      fromNode: fromAttr || null,
      targets: targets.map(t => ({ name: exprName(t) || (stringValue(t) ?? '?'), ref: refFor(project, file, t), node: t })),
    }
    sink.collections.push(usage)
    for (const t of usage.targets) {
      sink.children.push({ kind, name: t.name, ref: t.ref, node: opening, injected: newSink() })
    }
    return
  }

  // A control is an element, not a component: it renders in this scope.
  const control = isComponentTag(name) && !TRANSPARENT.has(name) ? resolveControlJSX(project, file, opening) : null
  if (control) {
    if (!sink.controls.has(control)) sink.controls.set(control, [])
    sink.controls.get(control).push(opening)
  }

  if (!control && isComponentTag(name) && !TRANSPARENT.has(name)) {
    // Child component: everything passed to it (children, JSX props) renders in its scope.
    const injected = newSink()
    for (const a of opening.attributes) visitInto(project, file, a, injected, visited)
    for (const c of el.children) visitInto(project, file, c, injected, visited)
    let ref = null
    if (opening.name.type === 'JSXIdentifier') {
      const r = bindingValue(project, file, findBinding(file, name, opening))
      if (r && isFunction(r.node)) ref = { file: r.file, node: r.node }
    } else {
      const r = resolveExpr(project, file, jsxToExpr(opening.name))
      if (r && isFunction(r.node)) ref = { file: r.file, node: r.node }
    }
    sink.children.push({ kind: 'tag', name, ref, node: opening, injected })
    return
  }

  // HTML element, control or transparent marker
  if (!isComponentTag(name) || control) handleHtmlAttrs(project, file, opening, sink)
  if (!isComponentTag(name)) sink.elements.push({ node: el, file, tag: name })
  for (const a of opening.attributes) {
    if (a.type === 'JSXAttribute') {
      const v = jsxAttrExpr(a)
      if (v && v.type !== 'StringLiteral') visitInto(project, file, v, sink, visited)
    } else {
      visitInto(project, file, a.argument, sink, visited)
    }
  }
  for (const c of el.children) visitInto(project, file, c, sink, visited)
}

// <NS.Comp> → NS.Comp member expression (namespace imports)
function jsxToExpr(n) {
  if (n.type === 'JSXIdentifier') return { type: 'Identifier', name: n.name, loc: n.loc }
  if (n.type === 'JSXMemberExpression') return { type: 'MemberExpression', object: jsxToExpr(n.object), property: { type: 'Identifier', name: n.property.name }, computed: false, loc: n.loc }
  return null
}

export { DYN, loc }
