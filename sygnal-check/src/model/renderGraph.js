/**
 * The render graph of a project (PLAN-10 A-1, A-6; moved here from graph.js for X-1's rules):
 * which scanned component renders which, and the entries that start them.
 *
 *   findEntries(project) → { refs: [{ file, node, via }], unknown }
 *     run(App), defineElement(tag, App) (via 'run' | 'element') and Vike's `+Page` / `+Layout`
 *     default exports (via 'vike'); unknown: an entry call whose component the checker can't
 *     resolve (a parameter picked at run time)
 *   viewUsages(sink) → [{ usage, via, from?, widget? }]
 *     every child usage of a view sink, with the JSX passed INTO children as via 'slot'
 *     (from: a Collection's `from`; widget tags with `widget: true`)
 *   renderGraph(project) → RenderGraph (memoized per project)
 *     units         the components, then view-only units ({ viewOnly: true, name, file, node, view,
 *                   viewInfo }: functions in the scanned files rendered as component tags or
 *                   started as entries, with no statics). Live: unitOf() may still append one
 *     unitOf(ref)   ref { file, node } of a function → its unit, or null (not scanned)
 *     entries       findEntries(project)
 *     entryUnits    Set of the units an entry starts
 *     usagesByUnit  Map unit → viewUsages(unit.viewInfo)
 *     renderedAs    Map unit → how another unit first renders it ('tag' | 'collection' | 'switchable')
 *     parentsOf     Map unit → [{ unit, via, usage }]  every scanned unit whose view renders it
 *                   (via 'slot': JSX the parent passed INTO a child; at run time the child that
 *                   places it is the parent)
 *     hiddenParents(unit) → names of capitalized top-level functions that render it but aren't
 *                   units (plain components nothing scanned renders and no entry starts)
 */
import path from 'node:path'
import { walk, unwrap, isFunction } from '../ast.js'
import { resolveExpr, resolveExport } from './resolve.js'
import { findBinding } from '../scope.js'

const SYGNAL = /^sygnal(\/|$)/
// PLAN-10 A-6: the calls that start an app or register a component, and the argument holding it
const ENTRY_CALLS = { run: 0, defineElement: 1 }
const ENTRY_VIA = { run: 'run', defineElement: 'element' }
const VIKE_PAGE = /(^|[\\/])\+(Page|Layout)\.[cm]?[jt]sx?$/

export function findEntries(project) {
  const refs = []
  let unknown = false
  const add = (r, via) => { if (r?.node && isFunction(r.node)) refs.push({ file: r.file, node: r.node, via }); else unknown = true }
  for (const p of project.scanned) {
    const file = project.files.get(p)
    if (!file) continue
    walk(file.ast.program, (n) => {
      if (n.type !== 'CallExpression') return true
      const callee = unwrap(n.callee)
      if (callee?.type !== 'Identifier') return true
      const b = findBinding(file, callee.name, callee)
      if (b?.kind !== 'import' || !SYGNAL.test(b.source) || !Object.hasOwn(ENTRY_CALLS, b.imported)) return true
      const arg = n.arguments[ENTRY_CALLS[b.imported]]
      if (arg && arg.type !== 'SpreadElement') add(resolveExpr(project, file, arg), ENTRY_VIA[b.imported])
      return true
    })
    if (VIKE_PAGE.test(p)) { const r = resolveExport(project, file, 'default'); if (r) add(r, 'vike') }
  }
  return { refs, unknown }
}

function collectionFrom(sink, usage) {
  const c = sink.collections.find(x => x.node === usage.node)
  return c ? c.from : null
}

export function viewUsages(sink, slot = false, out = [], seen = new Set()) {
  if (!sink || seen.has(sink)) return out
  seen.add(sink)
  for (const u of sink.children) {
    out.push({ usage: u, via: slot ? 'slot' : u.kind, from: u.kind === 'collection' ? collectionFrom(sink, u) : undefined })
    viewUsages(u.injected, true, out, seen)
  }
  for (const w of sink.widgets || []) out.push({ usage: w, via: slot ? 'slot' : 'tag', widget: true })
  return out
}

/** The name a view-only component is declared under (its function, or the const it is assigned to). */
function declaredName(file, fn) {
  if (fn.id?.name) return fn.id.name
  const p = file.parents.get(fn)
  return p?.type === 'VariableDeclarator' && p.id.type === 'Identifier' ? p.id.name : null
}

/** The functions a file declares at the top level (exported or not), with their names. */
function topLevelFunctions(file) {
  const out = []
  const fromDecl = (d) => {
    if (!d) return
    if (d.type === 'FunctionDeclaration' && d.id) out.push({ name: d.id.name, node: d })
    else if (d.type === 'VariableDeclaration') {
      for (const v of d.declarations) if (v.id.type === 'Identifier' && isFunction(unwrap(v.init))) out.push({ name: v.id.name, node: unwrap(v.init) })
    }
  }
  for (const st of file.ast.program.body) {
    if (st.type === 'ExportNamedDeclaration') fromDecl(st.declaration)
    else if (st.type === 'ExportDefaultDeclaration') {
      const d = st.declaration
      if (d.type === 'FunctionDeclaration' && d.id) fromDecl(d)
      else if (isFunction(unwrap(d))) out.push({ name: path.basename(file.path).replace(/\.[^.]+$/, ''), node: unwrap(d) })
    } else fromDecl(st)
  }
  return out
}

const graphs = new WeakMap()

export function renderGraph(project) {
  if (graphs.has(project)) return graphs.get(project)
  const comps = project.components
  const entries = findEntries(project)
  const units = [...comps]
  const viewOnly = new Map() // function node → unit
  const scannedComp = new Set(comps)
  const unitOf = (ref) => {
    if (!ref?.node) return null
    const c = project.componentForFunction(ref.node)
    if (c) return scannedComp.has(c) ? c : null
    if (viewOnly.has(ref.node)) return viewOnly.get(ref.node)
    if (!project.scanned.has(ref.file.path)) return null
    const decl = ref.file.parents.get(ref.node)
    const u = {
      name: declaredName(ref.file, ref.node), file: ref.file, node: decl?.type === 'VariableDeclarator' ? decl : ref.node, view: ref.node,
      viewOnly: true, viewInfo: null, staticProps: {},
    }
    viewOnly.set(ref.node, u)
    units.push(u)
    u.viewInfo = project.viewOf(ref)
    return u
  }
  const entryUnits = new Set(entries.refs.map(unitOf).filter(Boolean))
  const usagesByUnit = new Map()
  for (let i = 0; i < units.length; i++) {
    const c = units[i]
    const usages = viewUsages(c.viewInfo)
    usagesByUnit.set(c, usages)
    for (const { usage } of usages) {
      const u = usage.ref && unitOf(usage.ref)
      if (u?.viewOnly && !u.name) u.name = usage.name
    }
  }
  for (const u of viewOnly.values()) if (!u.name) u.name = path.basename(u.file.path).replace(/\.[^.]+$/, '')

  const renderedAs = new Map()
  const parentsOf = new Map(units.map(u => [u, []]))
  for (const c of units) {
    for (const { usage, via, widget } of usagesByUnit.get(c)) {
      const target = usage.ref && unitOf(usage.ref)
      if (!target || target === c) continue
      if (!renderedAs.has(target)) renderedAs.set(target, via === 'slot' ? usage.kind : via)
      if (widget) continue
      if (!parentsOf.has(target)) parentsOf.set(target, [])
      parentsOf.get(target).push({ unit: c, via, usage })
    }
  }
  // functions named like components (capitalized, top level) that aren't units but render one:
  // a plain component nothing scanned renders, which the units above can't show as a parent
  let hidden = null
  const hiddenParents = (unit) => {
    if (!hidden) {
      hidden = new Map()
      const known = new Set(units.map(u => u.view).filter(Boolean))
      for (const p of project.scanned) {
        const file = project.files.get(p)
        if (!file) continue
        for (const { name, node } of topLevelFunctions(file)) {
          if (!/^[A-Z]/.test(name) || known.has(node)) continue
          for (const { usage, widget } of viewUsages(project.viewOf({ file, node }))) {
            const t = !widget && usage.ref && (project.componentForFunction(usage.ref.node) || viewOnly.get(usage.ref.node))
            if (!t) continue
            if (!hidden.has(t)) hidden.set(t, [])
            if (!hidden.get(t).includes(name)) hidden.get(t).push(name)
          }
        }
      }
    }
    return hidden.get(unit) || []
  }
  const g = { units, unitOf, entries, entryUnits, usagesByUnit, renderedAs, parentsOf, hiddenParents }
  graphs.set(project, g)
  return g
}
