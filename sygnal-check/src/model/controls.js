/**
 * Controls (PLAN-4 CT-1): `controls({ Key: 'tag' | spec })` declarations and
 * the identifiers that refer to them.
 *
 *   const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })   // destructured
 *   const C = controls({ Add: 'button' })  …  <C.Add>  DOM.click(C.Add)  // namespace
 *   import { Add } from './controls'                                     // relative import,
 *   export { Add } from './controls' / export * from './controls'        // re-exports
 *
 * A control renders its element with data-control="<Key>", and anywhere a
 * selector is accepted it resolves to [data-control="<Key>"].
 *
 *   controlsOf(project, file) → {
 *     calls:      [{ call, controls: Control[] }]   every controls() call in the file
 *     duplicates: [{ control, first }]               a key declared again in the file (SYG128)
 *   }
 *   Control = { key, file, call, keyNode, element: string | null, kind: string | null, selector }
 *     element  the intrinsic tag for a tag-string spec; null for a spec object
 *     kind     a spec object's `kind` when it is a string literal
 *
 *   resolveControl(project, file, node, from?) → Control | null
 *     node is an expression (Identifier / MemberExpression); `from` is the node
 *     whose scope the lookup starts in (needed for synthetic nodes)
 *   resolveControlJSX(project, file, opening) → Control | null    <Add> / <C.Add>
 *   resolveSelectorControls(project, file, sel)                   intent selector post-pass
 *                     (also sets sel.component for a component argument: SYG124)
 */
import { walk, unwrap, propName, memberName, stringValue } from '../ast.js'
import { findBinding, findTopLevel } from '../scope.js'
import { resolveExpr } from './resolve.js'

const MAX_DEPTH = 8
const SYGNAL_MODULE = /^sygnal(\/|$)/

export const controlSelector = (key) => `[data-control="${key}"]`

/** Is `node` a `controls(...)` call (the import from 'sygnal', under any local name)? */
export function isControlsCall(file, node) {
  node = unwrap(node)
  if (node?.type !== 'CallExpression') return false
  const callee = unwrap(node.callee)
  if (callee.type !== 'Identifier') return false
  const b = findBinding(file, callee.name, callee)
  return !!b && b.kind === 'import' && b.imported === 'controls' && SYGNAL_MODULE.test(b.source)
}

function specOf(value) {
  const v = unwrap(value)
  const tag = stringValue(v)
  if (tag != null) return { element: tag, kind: null }
  if (v?.type === 'ObjectExpression') {
    const k = v.properties.find(p => p.type === 'ObjectProperty' && propName(p) === 'kind')
    return { element: null, kind: k ? stringValue(k.value) : null }
  }
  return { element: null, kind: null }
}

const cache = new WeakMap() // file → info

export function controlsOf(project, file) {
  if (!file) return { calls: [], duplicates: [], byDeclarator: new Map(), byCall: new Map() }
  if (cache.has(file)) return cache.get(file)
  const info = { calls: [], duplicates: [], byDeclarator: new Map(), byCall: new Map() }
  cache.set(file, info)
  const seen = new Map() // key → first Control
  walk(file.ast.program, (n) => {
    if (n.type !== 'CallExpression' || !isControlsCall(file, n)) return true
    const arg = unwrap(n.arguments[0])
    const controls = []
    if (arg?.type === 'ObjectExpression') {
      for (const p of arg.properties) {
        if (p.type !== 'ObjectProperty') continue
        const key = propName(p)
        if (key == null) continue
        const c = { key, file, call: n, keyNode: p.key, ...specOf(p.value), selector: controlSelector(key) }
        controls.push(c)
        if (seen.has(key)) info.duplicates.push({ control: c, first: seen.get(key) })
        else seen.set(key, c)
      }
    }
    const entry = { call: n, controls }
    info.calls.push(entry)
    info.byCall.set(n, entry)
    return true
  })
  // declarators: const { A, B: Local } = controls(...)  /  const C = controls(...)
  for (const entry of info.calls) {
    const decl = file.parents.get(entry.call)
    if (decl?.type !== 'VariableDeclarator' || unwrap(decl.init) !== entry.call) continue
    const byKey = new Map()
    for (const c of entry.controls) if (!byKey.has(c.key)) byKey.set(c.key, c)
    if (decl.id.type === 'ObjectPattern') {
      const locals = new Map()
      for (const p of decl.id.properties) {
        if (p.type !== 'ObjectProperty') continue
        const key = propName(p)
        let v = p.value
        if (v.type === 'AssignmentPattern') v = v.left
        if (key != null && v.type === 'Identifier' && byKey.has(key)) locals.set(v.name, byKey.get(key))
      }
      info.byDeclarator.set(decl, { kind: 'pattern', locals })
    } else if (decl.id.type === 'Identifier') {
      info.byDeclarator.set(decl, { kind: 'namespace', keys: byKey })
    }
  }
  return info
}

/**
 * What a binding refers to: { control } | { namespace: Map<key, Control> } | null
 */
function bindingTarget(project, file, b, name, depth) {
  if (!b || depth > MAX_DEPTH) return null
  if (b.kind === 'pattern' || b.kind === 'var') {
    const d = controlsOf(project, file).byDeclarator.get(b.node)
    if (d?.kind === 'pattern') return d.locals.has(name) ? { control: d.locals.get(name) } : null
    if (d?.kind === 'namespace') return { namespace: d.keys }
    // const Add = C.Add
    if (b.kind === 'var' && b.init) {
      const t = exprTarget(project, file, b.init, b.init, depth + 1)
      return t
    }
    return null
  }
  if (b.kind === 'import') {
    if (b.imported === '*') return { module: project.loadImport(file, b.source) }
    const target = project.loadImport(file, b.source)
    return target ? exportTarget(project, target, b.imported, depth + 1) : null
  }
  return null
}

function exportTarget(project, file, exportName, depth) {
  if (!file || depth > MAX_DEPTH) return null
  for (const stmt of file.ast.program.body) {
    if (stmt.type === 'ExportNamedDeclaration') {
      const d = stmt.declaration
      if (d?.type === 'VariableDeclaration') {
        for (const decl of d.declarations) {
          const info = controlsOf(project, file).byDeclarator.get(decl)
          if (!info) continue
          if (info.kind === 'pattern' && info.locals.has(exportName)) return { control: info.locals.get(exportName) }
          if (info.kind === 'namespace' && decl.id.name === exportName) return { namespace: info.keys }
        }
      }
      for (const s of stmt.specifiers || []) {
        const exported = s.exported.type === 'Identifier' ? s.exported.name : s.exported.value
        if (exported !== exportName) continue
        const local = s.local ? (s.local.type === 'Identifier' ? s.local.name : s.local.value) : null
        if (stmt.source) {
          const target = project.loadImport(file, stmt.source.value)
          if (s.type === 'ExportNamespaceSpecifier') return target ? { module: target } : null
          return target && local ? exportTarget(project, target, local, depth + 1) : null
        }
        return local ? bindingTarget(project, file, findTopLevel(file, local), local, depth + 1) : null
      }
    }
    if (stmt.type === 'ExportAllDeclaration' && !stmt.exported) {
      const target = project.loadImport(file, stmt.source.value)
      const r = target && exportTarget(project, target, exportName, depth + 1)
      if (r) return r
    }
  }
  return null
}

function exprTarget(project, file, node, from, depth = 0) {
  node = unwrap(node)
  if (!node || depth > MAX_DEPTH) return null
  if (node.type === 'Identifier') {
    return bindingTarget(project, file, findBinding(file, node.name, from || node), node.name, depth)
  }
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const name = memberName(node)
    if (name == null) return null
    const obj = exprTarget(project, file, node.object, from === node ? node.object : from, depth + 1)
    if (obj?.namespace) return obj.namespace.has(name) ? { control: obj.namespace.get(name) } : null
    if (obj?.module) return exportTarget(project, obj.module, name, depth + 1)
  }
  return null
}

/** The control an expression refers to, or null. */
export function resolveControl(project, file, node, from) {
  return exprTarget(project, file, node, from || node)?.control || null
}

// <NS.Comp> → NS.Comp (synthetic, scope looked up from the opening element)
function jsxToExpr(n) {
  if (n.type === 'JSXIdentifier') return { type: 'Identifier', name: n.name }
  if (n.type === 'JSXMemberExpression') {
    const object = jsxToExpr(n.object)
    return object && { type: 'MemberExpression', object, property: { type: 'Identifier', name: n.property.name }, computed: false }
  }
  return null
}

/** The control a JSX tag (<Add>, <C.Add>) renders, or null. */
export function resolveControlJSX(project, file, opening) {
  const n = opening.name
  if (n.type === 'JSXIdentifier' && !/^[A-Z]/.test(n.name)) return null
  const expr = jsxToExpr(n)
  return expr ? resolveControl(project, file, expr, opening) : null
}

/**
 * Intent post-pass: a selector argument that is a control (or a template
 * string built from controls) gets `controls` / `control` and its selector
 * text; it is no longer "dynamic".
 */
export function resolveSelectorControls(project, file, sel) {
  if (!sel.dynamic) return
  const arg = unwrap(sel.node)
  const c = resolveControl(project, file, arg)
  if (c) {
    Object.assign(sel, { control: c, controls: [c], selector: c.selector, dynamic: false })
    return
  }
  if (arg?.type === 'TemplateLiteral' && arg.expressions.length) {
    const controls = []
    let text = arg.quasis[0].value.cooked ?? ''
    for (let i = 0; i < arg.expressions.length; i++) {
      const e = arg.expressions[i]
      const ec = resolveControl(project, file, e)
      const s = ec ? null : stringValue(e)
      if (!ec && s == null) return
      if (ec) controls.push(ec)
      text += (ec ? ec.selector : s) + (arg.quasis[i + 1].value.cooked ?? '')
    }
    if (controls.length) Object.assign(sel, { controls, selector: text, dynamic: false })
    return
  }
  const component = componentArg(project, file, arg)
  if (component) sel.component = component
}

const CLASS_TYPES = new Set(['ClassDeclaration', 'ClassExpression'])

function exprName(e) {
  e = unwrap(e)
  if (e?.type === 'Identifier') return e.name
  if (e?.type === 'MemberExpression' && !e.computed) {
    const o = exprName(e.object)
    return o && `${o}.${e.property.name}`
  }
  return null
}

/**
 * A component passed where a control or selector is expected (SYG124): an
 * identifier / member that resolves to a function or class that is a
 * component (has statics), or whose name is capitalised (JSX treats every
 * capitalised tag as a component).
 * @returns {{ name, file, node } | null}
 */
export function componentArg(project, file, arg) {
  const name = exprName(arg)
  if (!name) return null
  const r = resolveExpr(project, file, arg)
  const fn = r?.node
  if (!fn || !(isFunctionNode(fn) || CLASS_TYPES.has(fn.type))) return null
  const comp = project.componentForFunction(fn)
  const last = name.split('.').pop()
  if (!comp && !/^[A-Z]/.test(last)) return null
  return { name, file: r.file, node: fn }
}

const isFunctionNode = (n) => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type)
