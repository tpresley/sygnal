/**
 * Static app graph (`sygnal-check --graph`): the project model serialized
 * into the InspectGraph shape that runtime inspect() also produces
 * (schema/inspect.schema.json; TypeScript: InspectGraph in sygnal/diagnostics).
 *
 *   graph(inputs, options) → InspectGraph
 *     inputs   file paths, directories, or globs (string or string[])
 *     options  { cwd?, strict?, includeTests?, ignore?, rules? }  (as check())
 *
 *   buildGraph(project, diagnostics) → InspectGraph   (already built project)
 *
 * What the static side knows (runtime-only fields are null / omitted):
 *   id           'file:line' of the component definition; parentId is null
 *                (a component can be rendered by several parents: see the
 *                parents' `children`)
 *   kind         'root' when no scanned component renders it, else how it is
 *                first rendered (tag → child, Collection → collection-item,
 *                Switchable → switchable)
 *   actions      intent actions + model entries; trigger: builtin
 *                (BOOTSTRAP/INITIALIZE/DISPOSE/READY), intent, reply (an
 *                ok/error literal in a request, or a `connections` name),
 *                next (a next('NAME') literal in the model), else unknown
 *   stateKeys    initialState keys (when statically known)
 *   contextConsumes  context fields the view reads (context.x / { context: { x } })
 *   events       EVENTS sinks returning { type: 'X' }, emit()/event() calls,
 *                EVENTS.select('X') in the component's intent / static props
 *   children     tag / Collection / Switchable usages in the view, and
 *                components passed into a child as children or slots ('slot')
 *   selectors    intent DOM selectors; matched / isolationHit from the
 *                SYG110 / SYG104 findings (null for document/body/dynamic)
 *   diagnostics  the normal rules (+ strict ones with `strict: true`),
 *                attached to their component, the rest app-wide
 */
import path from 'node:path'
import { expandInputs } from './files.js'
import { buildProject } from './model/project.js'
import { selectRules } from './rules/index.js'
import { runRules, sortDiagnostics } from './run.js'
import { walk, unwrap, propName, memberName, stringValue, loc } from './ast.js'
import { resolveExpr } from './model/resolve.js'
import { BUILTIN_ACTIONS } from './model/modelEntries.js'

const VIA_KIND = { tag: 'child', collection: 'collection-item', switchable: 'switchable' }

export function graph(inputs = ['src'], options = {}) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const list = Array.isArray(inputs) ? inputs : [inputs]
  const { files } = expandInputs(list, { cwd, includeTests: options.includeTests })
  return graphFiles(files, { ...options, cwd })
}

/** graph() for an already expanded list of absolute file paths (see expandInputs). */
export function graphFiles(files, options = {}) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const project = buildProject(files, { cwd })
  const rules = options.rules || selectRules({ strict: options.strict })
  let diags = runRules(project, rules)
  if (options.ignore?.length) diags = diags.filter(d => !options.ignore.includes(d.code))
  return buildGraph(project, sortDiagnostics(diags))
}

const contains = (outer, inner) => !!outer && !!inner && inner.start >= outer.start && inner.end <= outer.end

/** Every child usage of a view sink, with the ones passed INTO children as 'slot'. */
function usagesOf(sink, slot = false, out = [], seen = new Set()) {
  if (!sink || seen.has(sink)) return out
  seen.add(sink)
  for (const u of sink.children) {
    out.push({ usage: u, via: slot ? 'slot' : u.kind, from: u.kind === 'collection' ? collectionFrom(sink, u) : undefined })
    usagesOf(u.injected, true, out, seen)
  }
  return out
}

function collectionFrom(sink, usage) {
  const c = sink.collections.find(x => x.node === usage.node)
  return c ? c.from : null
}

/** Context fields a view function reads: ({ context }) => context.x, ({ context: { x } }), (props) => props.context.x */
function contextConsumes(comp) {
  const fn = comp.view
  if (!fn || !fn.params) return null
  const out = new Set()
  const locals = new Set()
  let propsName = null
  let first = fn.params[0]
  if (first?.type === 'AssignmentPattern') first = first.left
  const fromPattern = (pat) => {
    for (const p of pat.properties) {
      if (p.type !== 'ObjectProperty') continue
      const k = propName(p)
      if (k) out.add(k)
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
      if (k) out.add(k)
    } else if (n.type === 'VariableDeclarator' && n.id.type === 'ObjectPattern' && isContextRef(n.init)) {
      fromPattern(n.id)
    }
    return true
  })
  return [...out]
}

function slimDiagnostic(d) {
  const out = { code: d.code, severity: d.severity, message: d.message }
  if (d.component) out.component = d.component
  if (d.fix) out.fix = d.fix
  if (d.docsUrl) out.docsUrl = d.docsUrl
  if (d.data !== undefined) out.data = d.data
  if (d.file) { out.file = d.file; out.line = d.line; out.column = d.column }
  return out
}

export function buildGraph(project, diagnostics = []) {
  const comps = project.components
  const rel = (file) => project.relPath(file.path)
  const idOf = (c) => `${rel(c.file)}:${loc(c.node).line}`

  // kind: how each component is rendered by the other scanned components
  const renderedAs = new Map()
  const usagesByComp = new Map()
  for (const c of comps) {
    const usages = usagesOf(c.viewInfo)
    usagesByComp.set(c, usages)
    for (const { usage, via } of usages) {
      const target = usage.ref && project.componentForFunction(usage.ref.node)
      if (target && target !== c && !renderedAs.has(target)) renderedAs.set(target, via === 'slot' ? usage.kind : via)
    }
  }

  // EVENTS: attribute each select / emit to the component whose intent, model or definition contains it
  const ownerOf = (e, part) => {
    for (const c of comps) {
      if (part === 'select' && c.intent?.fn && c.intent.file === e.file && contains(c.intent.fn, e.node)) return c
      if (part === 'emit' && c.staticProps.model) {
        const r = resolveExpr(project, c.file, c.staticProps.model)
        if (r?.file === e.file && contains(r.node, e.node)) return c
      }
    }
    return e.component ? null : project.componentAt(e.file, e.node)
  }
  const selected = new Map(comps.map(c => [c, new Set()]))
  const emitted = new Map(comps.map(c => [c, new Set()]))
  const events = {}
  const ev = (type) => events[type] || (events[type] = { emitters: [], selectors: [] })
  const add = (list, name) => { if (!list.includes(name)) list.push(name) }
  for (const s of project.events.selected) {
    const owner = ownerOf(s, 'select')
    ev(s.type)
    if (owner) { selected.get(owner).add(s.type); add(events[s.type].selectors, owner.name) }
  }
  for (const e of project.events.emitted) {
    const owner = e.component ? comps.find(c => c.name === e.component && c.model?.eventsEmitted.some(x => x.node === e.node)) : ownerOf(e, 'emit')
    ev(e.type)
    if (owner) { emitted.get(owner).add(e.type); add(events[e.type].emitters, owner.name) }
  }

  // diagnostics: attach to the component (by name, disambiguated by file), the rest app-wide
  const byComp = new Map(comps.map(c => [c, []]))
  const appWide = []
  for (const d of diagnostics) {
    const named = d.component ? comps.filter(c => c.name === d.component) : []
    const owner = named.length === 1 ? named[0]
      : named.find(c => [c.file, c.intent?.file].some(f => f && rel(f) === d.file)) || null
    if (owner) byComp.get(owner).push(d)
    else appWide.push(d)
  }

  const components = comps.map(c => {
    const intentActions = (c.intent?.actions || []).map(a => a.name)
    const entries = c.model?.entries || []
    const next = new Set((c.model?.nextTargets || []).map(t => t.name))
    const replies = new Set([...(c.model?.replyTargets || []), ...(c.connections?.targets || [])].map(t => t.name))
    const sinks = new Map()
    for (const a of intentActions) sinks.set(a, sinks.get(a) || [])
    for (const e of entries) {
      const list = sinks.get(e.action) || []
      for (const s of e.sinks) if (!list.includes(s)) list.push(s)
      sinks.set(e.action, list)
    }
    const actions = [...sinks].map(([name, s]) => ({
      name,
      trigger: BUILTIN_ACTIONS.has(name) ? 'builtin' : intentActions.includes(name) ? 'intent' : replies.has(name) ? 'reply' : next.has(name) ? 'next' : 'unknown',
      sinks: s,
    }))

    const own = byComp.get(c)
    const selectors = (c.intent?.selectors || []).map(sel => {
      const where = loc(sel.node)
      const file = rel(c.intent.file)
      const text = sel.selector ?? c.intent.file.source.slice(sel.node.start, sel.node.end)
      const found = own.filter(d => d.file === file && d.line === where.line && d.column === where.column)
      const crossed = found.find(d => d.code === 'SYG104')
      const missing = found.find(d => d.code === 'SYG110' && d.severity !== 'info')
      const unsure = sel.global || sel.dynamic || found.some(d => d.code === 'SYG110' && d.severity === 'info')
      return {
        selector: text,
        events: sel.method === 'select' ? selectEvents(c.intent.file, sel.node) : [sel.method],
        matched: crossed || missing ? false : unsure ? null : true,
        isolationHit: crossed ? crossed.data?.child ?? null : null,
      }
    })

    const children = []
    for (const { usage, via, from } of usagesByComp.get(c)) {
      if (children.some(x => x.name === usage.name && x.via === via)) continue
      const child = { name: usage.name, via }
      if (via === 'collection') child.from = from ?? null
      children.push(child)
    }

    return {
      name: c.name,
      id: idOf(c),
      parentId: null,
      file: rel(c.file),
      kind: VIA_KIND[renderedAs.get(c)] || 'root',
      actions,
      stateKeys: c.initialState ? [...c.initialState.keys.keys()] : [],
      calculated: [...c.calculatedKeys],
      contextProvides: [...c.contextKeys],
      contextConsumes: contextConsumes(c),
      eventsEmitted: [...emitted.get(c)],
      eventsSelected: [...selected.get(c)],
      children,
      selectors,
      diagnostics: own.map(slimDiagnostic),
    }
  })

  return { version: 1, source: 'static', components, events, diagnostics: appWide.map(slimDiagnostic) }
}

/** Event types of DOM.select(x).events('click') / .events('a').… chains (one level). */
function selectEvents(file, argNode) {
  const call = file.parents.get(argNode)
  const member = call && file.parents.get(call)
  if (!member || member.type !== 'MemberExpression' || member.object !== call) return []
  const name = memberName(member)
  const outer = file.parents.get(member)
  if (!outer || outer.type !== 'CallExpression' || outer.callee !== member) return []
  if (name === 'events') {
    const s = stringValue(outer.arguments[0])
    return s != null ? [s] : []
  }
  return []
}
