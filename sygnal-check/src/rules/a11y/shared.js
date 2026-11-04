/**
 * Shared helpers for the 7xx "a11y" lane (PLAN-4 GS-3).
 *
 * The markup rules (SYG702, 703, 705-708) look at every JSX element in the
 * scanned files; SYG701 and SYG704 cross the intent with the component's view.
 * Precision comes first: whenever an element's attributes or content can't be
 * seen statically (spread props, `attrs`/`props` objects that aren't literals,
 * dynamic values, child components that might render a label or a button),
 * the rules say nothing.
 *
 *   elementsOf(project)       → Element[] (every JSX element in the scanned files, cached)
 *   Element = { file, el, opening, name, tag, kind, control, attrs, spread, component }
 *     tag      the HTML tag ('div'; a control's element) or null
 *     kind     'html' | 'control' | 'component' | 'transparent'
 *     attrs    Map<name, { node, value }>  (JSX attributes plus static `attrs={{…}}` keys;
 *              value is the expression, a StringLiteral, or null for a bare attribute)
 *     spread   true when other attributes may be set that we can't see
 *   labelState(project, file, node) → 'label' | 'unknown' | 'none'
 *   idIndex(project)          → which ids (literal, uid() keys) are rendered
 */
import { walk, unwrap, isFunction, jsxName, jsxAttrExpr, propName, stringValue, memberName } from '../../ast.js'
import { resolveControlJSX } from '../../model/controls.js'
import { resolveWidgetJSX } from '../../model/widgets.js'
import { evalStrings, tokenize, DYN } from '../../strings.js'
import { hyperscriptSel } from '../../selectors.js'
import { findBinding } from '../../scope.js'
import { HYPERSCRIPT_TAGS } from '../../model/view.js'
import { resolveExpr } from '../../model/resolve.js'

export const TRANSPARENT = new Set(['Fragment', 'Portal', 'Transition', 'Suspense', 'ClientOnly', 'Slot', 'React.Fragment'])

const cache = new WeakMap() // project → Element[]

const isIntrinsic = (name) => !!name && /^[a-z]/.test(name) && !name.includes('.')

function collectAttrs(opening) {
  const attrs = new Map()
  let spread = false
  for (const a of opening.attributes) {
    if (a.type === 'JSXSpreadAttribute') { spread = true; continue }
    const name = jsxName(a.name)
    if (!name) continue
    const value = jsxAttrExpr(a)
    if (name === 'attrs' || name === 'props') {
      const obj = unwrap(value)
      if (obj?.type !== 'ObjectExpression') { spread = true; continue }
      for (const p of obj.properties) {
        const k = p.type === 'ObjectProperty' ? propName(p) : null
        if (k == null) { spread = true; continue }
        attrs.set(k, { node: p, value: unwrap(p.value) })
      }
      continue
    }
    if (name === 'innerHTML' || name === 'textContent') spread = true
    attrs.set(name, { node: a, value })
  }
  return { attrs, spread }
}

// FileInfo → its Elements: a file's elements (tags, attributes, controls resolved through its
// imports) depend only on the file and what it imports, so an incremental build's reused FileInfo
// keeps them (Project `previous`)
const fileElements = new WeakMap()

export function elementsOf(project) {
  if (cache.has(project)) return cache.get(project)
  const out = []
  for (const p of project.scanned) {
    const file = project.files.get(p)
    if (!file) continue
    if (!fileElements.has(file)) {
      const list = []
      walk(file.ast.program, (n) => {
        if (n.type !== 'JSXElement') return true
        list.push(describe(project, file, n))
        return true
      })
      fileElements.set(file, list)
    }
    out.push(...fileElements.get(file))
  }
  cache.set(project, out)
  return out
}

// FileInfo → (JSXElement → Element): per FileInfo, so per build (the AST can be shared across
// builds through a ParseCache, while the Element holds this build's FileInfo and control
// resolution); an incremental build's reused FileInfo keeps its Elements (Project `previous`)
const described = new WeakMap()

export function describe(project, file, el) {
  let byEl = described.get(file)
  if (!byEl) described.set(file, byEl = new WeakMap())
  if (byEl.has(el)) return byEl.get(el)
  const opening = el.openingElement
  const name = jsxName(opening.name)
  let tag = null
  let kind
  let control = null
  if (isIntrinsic(name)) { tag = name; kind = 'html' } else if (TRANSPARENT.has(name)) kind = 'transparent'
  else {
    control = resolveControlJSX(project, file, opening) || resolveWidgetJSX(project, file, opening)
    if (control?.element) { tag = control.element; kind = 'control' } else kind = 'component'
  }
  const { attrs, spread } = collectAttrs(opening)
  const info = { file, el, opening, name, tag, kind, control, attrs, spread }
  byEl.set(el, info)
  return info
}

/** Attribute lookup by any of `names` (HTML attributes are case-insensitive: tabIndex/tabindex). */
export function attr(info, ...names) {
  for (const n of names) if (info.attrs.has(n)) return info.attrs.get(n)
  return null
}

/** Static string value of an attribute: string, '' for a bare attribute, null when dynamic. */
export function attrString(a) {
  if (!a) return null
  if (a.value == null) return ''
  const v = unwrap(a.value)
  const s = stringValue(v)
  if (s != null) return s
  if (v.type === 'NumericLiteral') return String(v.value)
  if (v.type === 'BooleanLiteral') return String(v.value)
  return null
}

export const componentName = (project, file, node) => project.componentAt(file, node)?.name

// ---------------------------------------------------------------------------
// uid('x') (GS-9): the view prop that returns a per-instance id. A uid() call
// matches another call with the same literal argument (or none).

/** 'uid:<key>' for `uid('x')` / `uid()` / `props.uid('x')`; null for anything else or a dynamic argument. */
export function uidKey(node) {
  const n = unwrap(node)
  if (n?.type !== 'CallExpression') return null
  const c = unwrap(n.callee)
  const isUid = (c.type === 'Identifier' && c.name === 'uid') ||
    (c.type === 'MemberExpression' && !c.computed && c.property.name === 'uid')
  if (!isUid) return null
  if (n.arguments.length === 0) return 'uid:'
  const s = stringValue(n.arguments[0])
  return s == null ? null : 'uid:' + s
}

const isUidCall = (node) => {
  const n = unwrap(node)
  if (n?.type !== 'CallExpression') return false
  const c = unwrap(n.callee)
  return (c.type === 'Identifier' && c.name === 'uid') || (c.type === 'MemberExpression' && !c.computed && c.property.name === 'uid')
}

/**
 * The ids an id-reference attribute names: { ids: string[], uids: string[] }
 * or null when any part is dynamic. Handles 'a b', uid('x'), and
 * `${uid('a')} ${uid('b')}`.
 */
export function idRefs(a, file) {
  if (!a || a.value == null) return null
  const v = unwrap(a.value)
  const k = uidKey(v)
  if (k) return { ids: [], uids: [k] }
  if (v.type === 'TemplateLiteral' && v.expressions.length) {
    const uids = []
    const ids = []
    for (const e of v.expressions) {
      const key = uidKey(e)
      if (!key) return null
      uids.push(key)
    }
    for (const q of v.quasis) ids.push(...(q.value.cooked ?? '').split(/\s+/).filter(Boolean))
    return { ids, uids }
  }
  const alts = evalStrings(v, { fileInfo: file })
  if (alts.length !== 1 || alts[0].includes(DYN)) return null
  return { ids: alts[0].split(/\s+/).filter(Boolean), uids: [] }
}

/**
 * Ids rendered in the project:
 *   names     Set<string>   literal ids in any scanned file (JSX and hyperscript)
 *   patterns  [{ re }]      ids that are partly or fully dynamic (any file)
 *   uids      Map<file, Set<uidKey>>   uid() ids per file
 *   dynamicUid Set<file>    files with a uid(<dynamic>) id
 *   spreadFiles Set<file>   files where an intrinsic element spreads props (it may set an id)
 *   labelFors / labelUids / dynamicFor   the same for <label for>
 */
const idCache = new WeakMap()
export function idIndex(project) {
  if (idCache.has(project)) return idCache.get(project)
  const ix = {
    names: new Set(), patterns: [], uids: new Map(), dynamicUid: new Set(), spreadFiles: new Set(),
    labelFors: new Set(), labelUids: new Map(), dynamicFor: new Set(),
  }
  const addUid = (map, file, key) => {
    if (!map.has(file)) map.set(file, new Set())
    map.get(file).add(key)
  }
  for (const info of elementsOf(project)) {
    if (info.kind !== 'html' && info.kind !== 'control') continue
    if (info.spread) ix.spreadFiles.add(info.file)
    const id = attr(info, 'id')
    if (id) {
      const key = uidKey(id.value)
      if (key) addUid(ix.uids, info.file, key)
      else if (isUidCall(id.value)) ix.dynamicUid.add(info.file)
      else if (id.value != null) tokenize(evalStrings(id.value, { fileInfo: info.file }), ix)
    }
    if (info.tag === 'label') {
      const f = attr(info, 'htmlFor', 'for')
      if (f) {
        const key = uidKey(f.value)
        const s = attrString(f)
        if (key) addUid(ix.labelUids, info.file, key)
        else if (s != null) ix.labelFors.add(s)
        else ix.dynamicFor.add(info.file)
      }
    }
  }
  // hyperscript ids: h('div#x') / div('#x')
  for (const p of project.scanned) {
    const file = project.files.get(p)
    if (!file) continue
    walk(file.ast.program, (n) => {
      if (n.type === 'CallExpression' && n.arguments.length) {
        const c = unwrap(n.callee)
        if (c.type === 'Identifier' && (c.name === 'h' || HYPERSCRIPT_TAGS.has(c.name))) {
          const sel = stringValue(n.arguments[0])
          if (sel && sel.includes('#')) hyperscriptSel(sel).ids.forEach(i => ix.names.add(i))
        }
      }
      return true
    })
  }
  idCache.set(project, ix)
  return ix
}

export const idRendered = (ix, id) => ix.names.has(id) || ix.patterns.some(p => p.re.test(id))
export const uidRendered = (ix, file, key) => ix.dynamicUid.has(file) || !!ix.uids.get(file)?.has(key)

// ---------------------------------------------------------------------------
// Label context (SYG702): is a node rendered inside a <label>?

const MAX_LABEL_DEPTH = 4

/** JSX ancestors of `node` (innermost first), through inline callbacks up to the Program. */
function jsxAncestors(file, node) {
  const out = []
  let n = file.parents.get(node)
  while (n) {
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') out.push(n)
    n = file.parents.get(n)
  }
  return out
}

const PASS_THROUGH = new Set([
  'ConditionalExpression', 'LogicalExpression', 'ParenthesizedExpression', 'ArrayExpression',
  'SequenceExpression', 'TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression',
])

/** The function `top` is returned from (arrow body or a return statement), or null. */
function returnedFrom(file, top) {
  let n = top
  let p = file.parents.get(n)
  while (p && PASS_THROUGH.has(p.type)) { n = p; p = file.parents.get(p) }
  if (p && isFunction(p) && p.body === n) return p
  if (p?.type !== 'ReturnStatement') return null
  while (p && !isFunction(p)) {
    if (!['ReturnStatement', 'BlockStatement', 'IfStatement', 'SwitchCase', 'SwitchStatement', 'TryStatement'].includes(p.type)) return null
    p = file.parents.get(p)
  }
  return p || null
}

function functionName(file, fn) {
  if (fn.id?.name) return fn.id.name
  const p = file.parents.get(fn)
  if (p?.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name
  return null
}

// what JSX passed to a call goes through to be an argument's value (`field('Name', <input />)`)
const ARG_PATH = new Set([...PASS_THROUGH, 'JSXElement', 'JSXFragment', 'JSXExpressionContainer'])

/**
 * The call `node` is passed to as (part of) an argument's value: `field(<input />)`, or one key
 * of an object literal argument (`field({ input: <input /> })`): { call, index, key } or null
 * (a callback, a JSX attribute, a deeper object: not an argument's value).
 */
function argumentOf(file, node) {
  let n = node, key = null
  for (let p = file.parents.get(n); p; n = p, p = file.parents.get(p)) {
    if (p.type === 'CallExpression') {
      const index = p.arguments.indexOf(n)
      return index >= 0 && (key == null || n.type === 'ObjectExpression') ? { call: p, index, key } : null
    }
    if (key != null && p.type !== 'ObjectExpression') return null
    if (p.type === 'ObjectProperty') {
      if (p.value !== n || key != null) return null
      key = propName(p)
      if (key == null) return null
      continue
    }
    if (p.type === 'ObjectExpression') { if (key == null) return null; continue }
    if (!ARG_PATH.has(p.type)) return null
  }
  return null
}

/** Where a helper function renders its parameter `name` (Identifier uses), or null when it does more with it. */
function paramUses(file, fn, name, key) {
  const uses = []
  let opaque = false
  walk(fn.body, (n) => {
    if (opaque) return false
    if (n.type !== 'Identifier' || n.name !== name) return true
    const p = file.parents.get(n)
    if ((p?.type === 'MemberExpression' || p?.type === 'OptionalMemberExpression') && p.property === n && !p.computed) return true
    if (p?.type === 'ObjectProperty' && p.key === n && !p.computed && p.value !== n) return true
    if (findBinding(file, name, n)?.node !== fn) return true // shadowed
    if (key == null) { uses.push(n); return true }
    // `props.input`: the use is the member; `props.label` isn't this argument; `props` passed on may be
    if ((p?.type === 'MemberExpression' || p?.type === 'OptionalMemberExpression') && p.object === n) {
      if (memberName(p) === key) uses.push(p)
      else if (memberName(p) == null) opaque = true
      return true
    }
    opaque = true
    return false
  })
  return opaque ? null : uses
}

/**
 * Is JSX passed to a view helper (`field('Name', <input />)`) wrapped in a <label> where the
 * helper renders that parameter? 'label' / 'unknown' (a helper or parameter we can't follow) /
 * 'none' (the helper renders it outside a label).
 */
function helperArgState(project, file, arg, depth) {
  const callee = unwrap(arg.call.callee)
  if (callee?.type !== 'Identifier') return 'unknown'
  const h = resolveExpr(project, file, callee)
  const fn = h?.node
  if (!fn || !isFunction(fn) || project.componentForFunction(fn)) return 'unknown'
  if (fn.params.slice(0, arg.index + 1).some(p => p.type === 'RestElement')) return 'unknown'
  let p = fn.params[arg.index]
  if (p?.type === 'AssignmentPattern') p = p.left
  let name = null, key = null
  if (p?.type === 'Identifier') { name = p.name; key = arg.key }
  else if (p?.type === 'ObjectPattern' && arg.key != null) {
    if (p.properties.some(x => x.type === 'RestElement')) return 'unknown'
    const prop = p.properties.find(x => propName(x) === arg.key)
    let v = prop?.value
    if (v?.type === 'AssignmentPattern') v = v.left
    if (v?.type !== 'Identifier') return 'unknown'
    name = v.name
  }
  if (!name) return 'unknown'
  const uses = paramUses(h.file, fn, name, key)
  if (!uses?.length) return 'unknown'
  let state = 'none'
  for (const u of uses) {
    const s = labelState(project, h.file, u, depth + 1)
    if (s === 'label') return 'label'
    if (s === 'unknown') state = 'unknown'
  }
  return state
}

/**
 * 'label'   a <label> (element or control) wraps the node
 * 'unknown' a child component, an unresolvable helper, or JSX kept in a variable
 *           might wrap it
 * 'none'    nothing wraps it in a label
 *
 * JSX passed to a view helper (`field('Name', <input />)`) is followed to where the helper
 * renders that parameter (helperArgState), then to the call's own place.
 */
export function labelState(project, file, node, depth = 0) {
  if (depth > MAX_LABEL_DEPTH) return 'unknown'
  const arg = argumentOf(file, node)
  const ancestors = jsxAncestors(file, node)
  for (const a of ancestors) {
    if (a.type !== 'JSXElement') continue
    // (outside the helper call: judged from the call's place below)
    if (arg && !(a.start >= arg.call.start && a.end <= arg.call.end)) break
    const info = describe(project, file, a)
    if (info.tag === 'label') return 'label'
    if (info.kind === 'component') return 'unknown'
  }
  if (arg) {
    const s = helperArgState(project, file, arg, depth)
    return s === 'none' ? labelState(project, file, arg.call, depth + 1) : s
  }
  const top = ancestors.length ? ancestors[ancestors.length - 1] : node
  if (top.type !== 'JSXElement' && top.type !== 'JSXFragment' && !(top === node && node.type === 'CallExpression')) return 'unknown'
  const fn = returnedFrom(file, top)
  if (!fn) return 'unknown'
  const comp = project.componentForFunction(fn)
  if (comp) return componentInLabel(project, comp.name, depth)
  const name = functionName(file, fn)
  if (!name) return 'unknown'
  const refs = []
  walk(file.ast.program, (n) => {
    if (n.type === 'Identifier' && n.name === name && n !== fn.id) {
      const p = file.parents.get(n)
      if (!(p?.type === 'VariableDeclarator' && p.id === n)) refs.push(n)
    }
    return true
  })
  if (refs.length === 0) return 'unknown'
  let state = 'none'
  for (const r of refs) {
    const s = labelState(project, file, r, depth + 1)
    if (s === 'label') return 'label'
    if (s === 'unknown') state = 'unknown'
  }
  return state
}

/** Is the component `name` rendered (<Name>) inside a <label>, or in an unknown context? */
// native-tooling experiment E-3: <Name> usages indexed by name, and the answer memoized per
// (name, depth), per build (it was a scan of every element per field and per level: quadratic)
const usagesByName = new WeakMap() // project → { byName: Map<name, Element[]>, memo: Map }
function componentInLabel(project, name, depth) {
  let u = usagesByName.get(project)
  if (!u) {
    u = { byName: new Map(), memo: new Map() }
    for (const info of elementsOf(project)) {
      if (info.kind !== 'component') continue
      if (!u.byName.has(info.name)) u.byName.set(info.name, [])
      u.byName.get(info.name).push(info)
    }
    usagesByName.set(project, u)
  }
  const key = `${name}|${depth}`
  if (u.memo.has(key)) return u.memo.get(key)
  let state = 'none'
  for (const info of u.byName.get(name) || []) {
    const s = labelState(project, info.file, info.el, depth + 1)
    if (s === 'label') { state = 'label'; break }
    // a usage we can't place is fine: the component's own markup is what we judge
  }
  u.memo.set(key, state)
  return state
}

// ---------------------------------------------------------------------------
// Element content (SYG701 interactive descendants, SYG705 accessible name)

export const INTERACTIVE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'summary', 'details', 'option', 'label', 'video', 'audio', 'iframe', 'embed', 'object'])

const CHILDREN_NAMES = /^(children|slots?|content)$/i

/** Can an expression inside JSX hold elements we can't see (props.children, helper calls, JSX variables)? */
export function opaqueExpr(file, expr) {
  let opaque = false
  walk(expr, (n) => {
    if (opaque) return false
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') return false // walked separately
    if (n.type === 'CallExpression') {
      const c = unwrap(n.callee)
      // items.map(i => <li/>) is fine (the JSX inside is walked); helper() is not
      if (c.type !== 'MemberExpression') { opaque = true; return false }
    }
    if (n.type === 'Identifier' && CHILDREN_NAMES.test(n.name)) { opaque = true; return false }
    if (n.type === 'MemberExpression' && !n.computed && CHILDREN_NAMES.test(n.property.name || '')) { opaque = true; return false }
    if (n.type === 'Identifier') {
      // a local variable holding JSX
      const b = file && lookupVar(file, n)
      if (b && b.init && containsJSX(b.init)) { opaque = true; return false }
    }
    return true
  })
  return opaque
}

function lookupVar(file, ident) {
  const b = findBinding(file, ident.name, ident)
  return b?.kind === 'var' ? b : null
}

function containsJSX(node) {
  let found = false
  walk(node, (n) => {
    if (found) return false
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') { found = true; return false }
    return true
  })
  return found
}

/**
 * Does the element contain something keyboard users can reach (a button, a
 * link with href, a form field, an element with tabIndex), or something we
 * can't see (a child component, props.children, a helper call)?
 */
export function hasInteractiveOrUnknownContent(project, file, el) {
  let found = false
  const visit = (node) => {
    walk(node, (n) => {
      if (found) return false
      if (n.type === 'JSXElement') {
        if (n === el) return true
        const info = describe(project, file, n)
        if (info.kind === 'component') { found = true; return false }
        if (info.kind === 'control' && !info.tag) { found = true; return false }
        if (info.spread) { found = true; return false }
        if (info.tag && INTERACTIVE_TAGS.has(info.tag)) {
          if (!(info.tag === 'input' && attrString(attr(info, 'type')) === 'hidden')) { found = true; return false }
        }
        if (info.tag === 'a' && attr(info, 'href')) { found = true; return false }
        if (attr(info, 'tabIndex', 'tabindex') || attr(info, 'contentEditable', 'contenteditable')) { found = true; return false }
        return true
      }
      if (n.type === 'JSXExpressionContainer' && n.expression.type !== 'JSXEmptyExpression') {
        if (opaqueExpr(file, n.expression)) { found = true; return false }
      }
      return true
    })
  }
  for (const c of el.children) visit(c)
  return found
}
