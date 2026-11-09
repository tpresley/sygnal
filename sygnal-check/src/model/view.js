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
 *     `{items.map(renderItem)}`) is part of the view. A helper the view calls is walked with its
 *     parameters bound to the call's arguments (`row({ className: 'pick' })`: the helper's
 *     `className={className}` renders .pick), once per call.
 */
import { walk, unwrap, isFunction, jsxName, jsxAttr, jsxAttrExpr, propName, stringValue, loc, fileOfNode } from '../ast.js'
import { evalStrings, tokenize, classTokens, tokenSites, cssModuleClasses, DYN, UNDEFINED } from '../strings.js'
import { hyperscriptSel, selectorTokens } from '../selectors.js'
import { findBinding } from '../scope.js'
import { resolveExpr, bindingValue } from './resolve.js'
import { resolveControlJSX } from './controls.js'
import { resolveWidgetJSX } from './widgets.js'

const TRANSPARENT = new Set(['Fragment', 'Portal', 'Transition', 'Suspense', 'ClientOnly', 'Slot', 'React.Fragment'])
// PLAN-5 V-1: a VirtualCollection is a Collection here (its rows are isolated items, its className the container's)
const COLLECTION = new Set(['Collection', 'collection', 'VirtualCollection'])
// wizard spike: an <Outlet of={{ name: Page }}> renders one of its pages, as a Switchable does
const SWITCHABLE = new Set(['Switchable', 'switchable', 'Outlet'])

export function newSink() {
  return {
    // classes: `patterns` entries with `module: true` come only from CSS Module reads; `modules`
    // the members read (name → { node, file }), for SYG110
    classes: { names: new Set(), patterns: [], modules: new Map() },
    ids: { names: new Set(), patterns: [] },
    // child component usages rendered from this scope: { kind, name, ref, node, file, injected,
    // state? (a literal `state` lens), external? (the package specifier of a tag imported from one) }
    children: [],
    // PLAN-10 A-2: widget tags rendered from this scope (not children: their host renders here):
    // [{ name, widget, node, file, external? }]
    widgets: [],
    // <Collection>/<Switchable> usages (also listed in children)
    collections: [],
    // controls rendered in this scope: Map<Control, JSXOpeningElement[]> (PLAN-4 CT-1)
    controls: new Map(),
    // intrinsic elements rendered in this scope: [{ node: JSXElement, file, tag }] (--fix --controls)
    elements: [],
    // class name → number of class attributes / selectors that may produce it (--fix --controls)
    classCounts: new Map(),
    // PLAN-7 N-1: where each static class / id token is written: [{ kind, name, file, start, end }]
    // (kind 'control': a control's tag, with `control`)
    // (UTF-16 offsets; a token the view renders but that can't be located, e.g. `'a' + 'b'`, has
    // none; a dynamic value is in classes/ids.patterns)
    tokens: [],
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

// 'sygnal/primitives' tags render an HTML element where they're written (not a child component)
const PRIMITIVE_TAGS = { View: 'div', Text: 'span', Pressable: 'button', TextInput: 'input', Switch: 'input', Image: 'img', ScrollView: 'div', List: 'div' }
/** the HTML tag of a 'sygnal/primitives' JSX tag (`<View>` → 'div'), or null */
function primitiveTag(file, nameNode) {
  if (nameNode?.type !== 'JSXIdentifier') return null
  const b = findBinding(file, nameNode.name, nameNode)
  return b?.kind === 'import' && /^sygnal\/primitives$/.test(b.source) ? PRIMITIVE_TAGS[b.imported] || null : null
}

function addDynamic(set) {
  const hit = set.patterns.find(p => p.source === '*')
  if (hit) hit.module = false
  else set.patterns.push({ source: '*', re: /^.*$/ })
}

function addClassExpr(project, file, expr, sink, bind = null) {
  const e = unwrap(expr)
  if (!e) return
  const into = { names: new Set(), patterns: [] }
  if (e.type === 'ObjectExpression' || e.type === 'ArrayExpression') {
    tokenize([classTokens([e], { fileInfo: file, bind }).join(' ')], into)
  } else {
    tokenize(evalStrings(e, { fileInfo: file, bind }), into)
  }
  const mods = cssModuleClasses(e, { fileInfo: file, bind })
  if (mods?.moduleOnly) for (const p of into.patterns) p.module = true
  if (mods) for (const [m, at] of mods.members) if (!sink.classes.modules.has(m)) sink.classes.modules.set(m, at)
  mergeClasses(sink, into.names, into.patterns)
  addSites(file, e, 'class', into.names, sink, bind)
}

/** PLAN-7 N-1: the sites of the tokens an expression produces (tokenSites() filtered by its names). */
function addSites(file, expr, kind, names, sink, bind = null) {
  if (!names.size) return
  for (const s of tokenSites(expr, { fileInfo: file, bind })) {
    const f = s.file || file
    // (a helper called more than once writes its own literals once)
    if (names.has(s.name) && !sink.tokens.some(t => t.file === f && t.start === s.start && t.kind === kind)) {
      sink.tokens.push({ kind, name: s.name, file: f, start: s.start, end: s.end })
    }
  }
}

/** A hyperscript selector literal's class / id tokens (h('div.a#b'), div('.a')). */
function addHyperscript(file, arg, sel, sink) {
  const { classes, ids } = hyperscriptSel(sel)
  mergeClasses(sink, classes)
  ids.forEach(i => sink.ids.names.add(i))
  const raw = arg.extra?.raw
  if (arg.type !== 'StringLiteral' || raw == null || raw.slice(1, -1) !== sel) return
  for (const t of selectorTokens(sel, { hyperscript: true })) {
    sink.tokens.push({ kind: t.kind, name: t.name, file, start: arg.start + 1 + t.index, end: arg.start + 1 + t.index + t.length })
  }
}

function mergeClasses(sink, names, patterns = []) {
  for (const n of names) {
    sink.classes.names.add(n)
    sink.classCounts.set(n, (sink.classCounts.get(n) || 0) + 1)
  }
  for (const p of patterns) {
    const hit = sink.classes.patterns.find(x => x.source === p.source)
    if (hit) hit.module = !!(hit.module && p.module)
    else sink.classes.patterns.push(p)
  }
}

function addIdExpr(file, expr, sink, bind = null) {
  const e = unwrap(expr)
  if (!e) return
  const alts = evalStrings(e, { fileInfo: file, bind })
  tokenize(alts, sink.ids)
  addSites(file, e, 'id', tokenize(alts).names, sink, bind)
}

function handleHtmlAttrs(project, file, opening, sink, bind = null) {
  for (const a of opening.attributes) {
    if (a.type === 'JSXSpreadAttribute') {
      // {...props} may carry className/id
      addDynamic(sink.classes)
      addDynamic(sink.ids)
      continue
    }
    const name = jsxName(a.name)
    const value = jsxAttrExpr(a)
    if (name === 'className' || name === 'class') addClassExpr(project, file, value, sink, bind)
    else if (name === 'id') addIdExpr(file, value, sink, bind)
    else if (name === 'innerHTML') { addDynamic(sink.classes); addDynamic(sink.ids) }
    else if ((name === 'attrs' || name === 'props') && unwrap(value)?.type === 'ObjectExpression') {
      for (const p of unwrap(value).properties) {
        if (p.type === 'SpreadElement') { addDynamic(sink.classes); addDynamic(sink.ids); continue }
        const k = propName(p)
        if (k === 'class' || k === 'className') addClassExpr(project, file, p.value, sink, bind)
        else if (k === 'id') addIdExpr(file, p.value, sink, bind)
        else if (k === 'innerHTML') { addDynamic(sink.classes); addDynamic(sink.ids) }
      }
    }
  }
}

/**
 * Where `sink` renders a class / id / control (PLAN-7 C-2's `related` locations):
 * { node, file } of the className / id attribute (or the tag name) of the first
 * JSX element that renders it, or null (hyperscript, or not found).
 */
export function renderedAt(project, sink, kind, name) {
  if (kind === 'control') {
    const opening = sink.controls.get(name)?.[0]
    const file = opening && fileOfNode(project, opening)
    return file ? { node: opening.name, file } : null
  }
  for (const { node, file } of sink.elements) {
    const opening = node.openingElement
    const own = newSink()
    handleHtmlAttrs(project, file, opening, own)
    if (!(kind === 'class' ? own.classes : own.ids).names.has(name)) continue
    const attr = kind === 'class' ? jsxAttr(opening, 'className') || jsxAttr(opening, 'class') : jsxAttr(opening, 'id')
    return { node: attr || opening.name, file }
  }
  return null
}

/**
 * Collect the view of `fnNode` (in `file`) into `sink`.
 * `visited` guards against helper-function recursion.
 */
export function collectView(project, file, fnNode, sink = newSink(), visited = new Set(), bind = null) {
  if (!fnNode || visited.has(fnNode)) return sink
  visited.add(fnNode)
  const body = isFunction(fnNode) ? fnNode.body : fnNode
  visitInto(project, file, body, sink, visited, bind)
  return sink
}

const MAX_BIND_DEPTH = 4
// per walk (its `visited` set): the helpers walked unbound (referenced, not called: `items.map(row)`)
const unboundWalks = new WeakMap()

/**
 * A view helper's parameters bound to a call's arguments: a plain parameter to its argument, a
 * destructured one (`({ className = 'row' })`) to the argument object literal's property (its
 * default, or undefined, when the object has no such key and no spread). Parameters it can't
 * bind stay unbound (dynamic, as before).
 */
export function bindViewParams(project, fn, fnFile, call, file, outer) {
  const params = new Map()
  const set = (name, node, f, b) => params.set(name, { node, file: f, bind: b })
  for (let i = 0; i < fn.params.length; i++) {
    const a = call.arguments[i]
    if (a?.type === 'SpreadElement') break
    let p = fn.params[i]
    let dflt = null
    if (p.type === 'AssignmentPattern') { dflt = p.right; p = p.left }
    if (p.type === 'Identifier') {
      if (a) set(p.name, a, file, outer)
      else if (dflt) set(p.name, dflt, fnFile, null)
      continue
    }
    if (p.type !== 'ObjectPattern') continue
    let obj = a ? unwrap(a) : null
    if (obj?.type === 'Identifier') {
      const r = resolveExpr(project, file, obj)
      obj = r?.file === file && r.node.type === 'ObjectExpression' ? r.node : null
    }
    if (obj?.type !== 'ObjectExpression') continue
    const open = obj.properties.some(x => x.type !== 'ObjectProperty')
    for (const prop of p.properties) {
      if (prop.type !== 'ObjectProperty') continue
      const key = propName(prop)
      let v = prop.value, d = null
      if (v.type === 'AssignmentPattern') { d = v.right; v = v.left }
      if (key == null || v.type !== 'Identifier') continue
      const hit = obj.properties.find(x => x.type === 'ObjectProperty' && propName(x) === key)
      if (hit) set(v.name, hit.value, file, outer)
      else if (!open) set(v.name, d || UNDEFINED, fnFile, null)
    }
  }
  return params.size ? { fn, params, outer, depth: (outer?.depth || 0) + 1 } : null
}

/** The module-level (or imported) helper function `ident` names, when it renders JSX: { file, node } or null. */
function helperOf(project, file, ident) {
  const b = findBinding(file, ident.name, ident)
  if (!b || !['function', 'var', 'import'].includes(b.kind)) return null
  // Only module-level (or imported) helpers; locals inside the view are walked already.
  if (b.kind !== 'import' && !isTopLevel(file, b.kind === 'var' ? file.parents.get(b.node) : b.node)) return null
  const r = b.kind === 'function' ? { file, node: b.node } : resolveExpr(project, file, ident)
  if (!r || !isFunction(r.node)) return null
  if (project.isComponentFunction(r.file, r.node)) return null
  if (!containsJSX(r.node)) return null
  return r
}

/** Classes and ids of a helper walked again (another call, or unbound after a call): into `sink`, nothing else. */
function mergeNames(sink, extra) {
  mergeClasses(sink, [], extra.classes.patterns)
  for (const [n, c] of extra.classCounts) {
    sink.classes.names.add(n)
    sink.classCounts.set(n, (sink.classCounts.get(n) || 0) + c)
  }
  for (const n of extra.classes.names) sink.classes.names.add(n)
  for (const [m, at] of extra.classes.modules) if (!sink.classes.modules.has(m)) sink.classes.modules.set(m, at)
  for (const n of extra.ids.names) sink.ids.names.add(n)
  for (const p of extra.ids.patterns) if (!sink.ids.patterns.some(x => x.source === p.source)) sink.ids.patterns.push(p)
  for (const t of extra.tokens) {
    if (t.kind !== 'control' && !sink.tokens.some(x => x.file === t.file && x.start === t.start && x.kind === t.kind)) sink.tokens.push(t)
  }
}

/** Walk helper `r` into `sink` (bound to a call's arguments or not); a helper walked before adds only its classes / ids. */
function walkHelper(project, r, sink, visited, bind) {
  let unbound = unboundWalks.get(visited)
  if (!unbound) unboundWalks.set(visited, unbound = new Set())
  if (!bind) {
    if (unbound.has(r.node)) return
    unbound.add(r.node)
  }
  if (!visited.has(r.node)) { collectView(project, r.file, r.node, sink, visited, bind); return }
  // the structure (children, elements, controls) was collected by the first walk
  const extra = newSink()
  visitInto(project, r.file, r.node.body, extra, visited, bind)
  mergeNames(sink, extra)
}

function visitInto(project, file, root, sink, visited, bind = null) {
  walk(root, (node) => {
    if (node.type === 'JSXElement') {
      handleElement(project, file, node, sink, visited, bind)
      return false
    }
    if (node.type === 'CallExpression') {
      const callee = unwrap(node.callee)
      // a helper called from the view: walked with its parameters bound to this call's arguments
      const h = callee.type === 'Identifier' && node.arguments.length && (bind?.depth || 0) < MAX_BIND_DEPTH ? helperOf(project, file, callee) : null
      if (h && !onStack(bind, h.node)) {
        walkHelper(project, h, sink, visited, bindViewParams(project, h.node, h.file, node, file, bind))
        for (const a of node.arguments) visitInto(project, file, a, sink, visited, bind)
        return false
      }
      // snabbdom hyperscript: h('div.a#b', ...)
      if (callee.type === 'Identifier' && callee.name === 'h') {
        const sel = stringValue(node.arguments[0])
        if (sel) addHyperscript(file, unwrap(node.arguments[0]), sel, sink)
      } else if (callee.type === 'Identifier' && HYPERSCRIPT_TAGS.has(callee.name) && isHyperscriptImport(file, callee)) {
        // hyperscript helpers: div('.a#b', …)
        const sel = stringValue(node.arguments[0])
        if (sel) addHyperscript(file, unwrap(node.arguments[0]), sel, sink)
      }
    }
    if (node.type === 'Identifier') {
      // a helper referenced, not called (`items.map(renderItem)`): its parameters are dynamic
      const h = helperOf(project, file, node)
      if (h && !onStack(bind, h.node)) walkHelper(project, h, sink, visited, null)
    }
    return true
  })
}

const onStack = (bind, fn) => { for (let b = bind; b; b = b.outer) if (b.fn === fn) return true; return false }

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

function handleElement(project, file, el, sink, visited, bind) {
  const opening = el.openingElement
  const name = jsxName(opening.name)

  if (COLLECTION.has(name) || SWITCHABLE.has(name)) {
    const kind = COLLECTION.has(name) ? 'collection' : 'switchable'
    const cls = jsxAttr(opening, 'className')
    if (cls) addClassExpr(project, file, jsxAttrExpr(cls), sink, bind)
    const ofAttr = jsxAttr(opening, 'of')
    const ofExpr = unwrap(jsxAttrExpr(ofAttr))
    const targets = []
    if (kind === 'switchable' && ofExpr?.type === 'ObjectExpression') {
      for (const p of ofExpr.properties) if (p.type === 'ObjectProperty') targets.push(p.value)
    } else if (ofExpr) {
      targets.push(ofExpr)
    }
    // `of={PAGES}`: the targets of a const (or imported) object, kept apart from `targets` (rules/syg637-refresh-shared-read.js)
    const ofConst = kind === 'switchable' && ofExpr?.type === 'Identifier' ? resolveExpr(project, file, ofExpr) : null
    const ofObject = unwrap(ofConst?.node)
    const constTargets = ofObject?.type === 'ObjectExpression'
      ? ofObject.properties.filter(p => p.type === 'ObjectProperty').map(p => ({ name: exprName(p.value), ref: refFor(project, ofConst.file, p.value) }))
      : null
    const fromAttr = jsxAttr(opening, 'from')
    const fromExpr = jsxAttrExpr(fromAttr)
    // PLAN-13 F-3: a Switchable's per-page `state={{ page: … }}` (an object literal with no `get`)
    const outlet = name === 'Outlet'
    const stExpr = kind === 'switchable' && !outlet ? unwrap(jsxAttrExpr(jsxAttr(opening, 'state'))) : null
    const stateMap = stExpr?.type === 'ObjectExpression' && !stExpr.properties.some(p => p.type !== 'SpreadElement' && propName(p) === 'get')
      ? stExpr.properties.filter(p => p.type === 'ObjectProperty' && propName(p) != null).map(p => ({ key: propName(p), node: p.key }))
      : null
    const usage = {
      kind,
      tag: name,
      node: opening,
      file,
      stateMap,
      ofKeys: kind === 'switchable' && !outlet && ofExpr?.type === 'ObjectExpression' && ofExpr.properties.every(p => p.type === 'ObjectProperty' && propName(p) != null)
        ? ofExpr.properties.map(p => propName(p)) : null,
      // (an Outlet's `from` names a wizard behavior, not a state key)
      from: fromExpr && !outlet ? stringValue(fromExpr) : null,
      fromNode: fromAttr || null,
      targets: targets.map(t => ({ name: exprName(t) || (stringValue(t) ?? '?'), ref: refFor(project, file, t), node: t })),
      constTargets,
      // wizard spike (rules/syg455-outlet.js): an <Outlet from="key">'s wizard key and its `of` keys
      // (null when `of` isn't an object literal of named keys)
      outlet: outlet ? {
        from: fromExpr ? stringValue(fromExpr) : null,
        fromNode: fromAttr || null,
        of: ofExpr?.type === 'ObjectExpression' && ofExpr.properties.every(p => p.type === 'ObjectProperty' && propName(p) != null)
          ? ofExpr.properties.map(p => ({ key: propName(p), node: p.key })) : null,
        ofNode: ofAttr || opening,
        // (`of` as written: a const the rule follows, `of={STEPS}`)
        ofExpr: ofExpr || null,
        fallback: !!jsxAttr(opening, 'fallback'),
      } : null,
    }
    sink.collections.push(usage)
    for (const t of usage.targets) {
      sink.children.push({ kind, name: t.name, ref: t.ref, node: opening, file, injected: newSink() })
    }
    return
  }

  // A control is an element, not a component: it renders in this scope.
  const control = isComponentTag(name) && !TRANSPARENT.has(name) ? resolveControlJSX(project, file, opening) : null
  // so is a primitive (<View> from 'sygnal/primitives'): checked as the HTML element it renders
  const prim = !control && isComponentTag(name) ? primitiveTag(file, opening.name) : null
  if (prim) {
    handleHtmlAttrs(project, file, opening, sink, bind)
    sink.elements.push({ node: el, file, tag: prim })
    for (const a of opening.attributes) {
      const v = a.type === 'JSXAttribute' ? jsxAttrExpr(a) : a.argument
      if (v && v.type !== 'StringLiteral') visitInto(project, file, v, sink, visited, bind)
    }
    for (const c of el.children) visitInto(project, file, c, sink, visited, bind)
    return
  }
  if (control) {
    if (!sink.controls.has(control)) sink.controls.set(control, [])
    sink.controls.get(control).push(opening)
    sink.tokens.push({ kind: 'control', control, name: control.key, file, start: opening.name.start, end: opening.name.end })
  }

  // PLAN-5 W-1: a widget tag renders its host element here. canvas-three: a widget with `children`
  // (an island: <Scene>'s meshes) renders its JSX children here too, as elements of this view
  // (a widget without it ignores them at run time; walking them costs nothing)
  const widget = !control && isComponentTag(name) && !TRANSPARENT.has(name) ? resolveWidgetJSX(project, file, opening) : null
  if (widget) {
    sink.widgets.push({ name, widget, node: opening, file, external: packageOf(file, opening.name) })
    handleHtmlAttrs(project, file, opening, sink, bind)
    if (widget.element) sink.elements.push({ node: el, file, tag: widget.element, widget })
    for (const a of opening.attributes) {
      const v = a.type === 'JSXAttribute' ? jsxAttrExpr(a) : a.argument
      if (v && v.type !== 'StringLiteral') visitInto(project, file, v, sink, visited, bind)
    }
    for (const c of el.children) visitInto(project, file, c, sink, visited, bind)
    return
  }

  if (!control && isComponentTag(name) && !TRANSPARENT.has(name)) {
    // Child component: everything passed to it (children, JSX props) renders in its scope.
    const injected = newSink()
    for (const a of opening.attributes) visitInto(project, file, a, injected, visited, bind)
    for (const c of el.children) visitInto(project, file, c, injected, visited, bind)
    let ref = null
    if (opening.name.type === 'JSXIdentifier') {
      const r = bindingValue(project, file, findBinding(file, name, opening))
      if (r && isFunction(r.node)) ref = { file: r.file, node: r.node }
    } else {
      const r = resolveExpr(project, file, jsxToExpr(opening.name))
      if (r && isFunction(r.node)) ref = { file: r.file, node: r.node }
    }
    const usage = { kind: 'tag', name, ref, node: opening, file, injected }
    const lens = stringValue(jsxAttrExpr(jsxAttr(opening, 'state')))
    if (lens != null) usage.state = lens
    const pkg = !ref && packageOf(file, opening.name)
    if (pkg) usage.external = pkg
    sink.children.push(usage)
    return
  }

  // HTML element, control or transparent marker
  if (!isComponentTag(name) || control) handleHtmlAttrs(project, file, opening, sink, bind)
  if (!isComponentTag(name)) sink.elements.push({ node: el, file, tag: name })
  for (const a of opening.attributes) {
    if (a.type === 'JSXAttribute') {
      const v = jsxAttrExpr(a)
      if (v && v.type !== 'StringLiteral') visitInto(project, file, v, sink, visited, bind)
    } else {
      visitInto(project, file, a.argument, sink, visited, bind)
    }
  }
  for (const c of el.children) visitInto(project, file, c, sink, visited, bind)
}

/** PLAN-10 A-2: the package a tag's (root) identifier is imported from ('sygnal/ui'), or null. */
function packageOf(file, nameNode) {
  let n = nameNode
  while (n?.type === 'JSXMemberExpression') n = n.object
  if (n?.type !== 'JSXIdentifier') return null
  const b = findBinding(file, n.name, n)
  return b?.kind === 'import' && /^(?![./~]|@\/)/.test(b.source) ? b.source : null
}

// <NS.Comp> → NS.Comp member expression (namespace imports)
function jsxToExpr(n) {
  if (n.type === 'JSXIdentifier') return { type: 'Identifier', name: n.name, loc: n.loc }
  if (n.type === 'JSXMemberExpression') return { type: 'MemberExpression', object: jsxToExpr(n.object), property: { type: 'Identifier', name: n.property.name }, computed: false, loc: n.loc }
  return null
}

export { DYN, loc }
