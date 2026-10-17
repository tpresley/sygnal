/**
 * Static app graph (`sygnal-check --graph`): the project model serialized
 * into the InspectGraph shape that runtime inspect() also produces
 * (schema/inspect.schema.json; TypeScript: InspectGraph in sygnal/diagnostics).
 *
 *   graph(inputs, options) → InspectGraph
 *     inputs   file paths, directories, or globs (string or string[])
 *     options  { cwd?, strict?, a11y?, includeTests?, ignore?, rules?, sources?, config?, defaults? }
 *              (as check(): the config file applies; its findings are app-wide diagnostics)
 *   graphFiles(files, options) → InspectGraph   (expanded files; reads no config file;
 *     options.extraDiagnostics: findings to add, e.g. resolveOptions().config.diagnostics)
 *
 *   buildGraph(project, diagnostics) → InspectGraph   (already built project)
 *
 * What the static side knows (runtime-only fields are null / omitted):
 *   id           'file:line' of the component definition; parentId is null
 *                (a component can be rendered by several parents: see the
 *                parents' `children`)
 *   key          'file#name' (PLAN-10 D521): stable across edits that move the definition's
 *                line, for hosts to key selection, positions and UI state by. Every node has
 *                one, view-only ones too (their name: the declared one, else the tag's, else
 *                the file's base name). When several in one file share a name, the first in
 *                source order keeps 'file#name' and the others get '#2', '#3', ...
 *   viewOnly     true for a function in the scanned files that is rendered as a
 *                component (or started as an entry) but has no statics (PLAN-10
 *                A-1); listed after the others, with empty actions/state/selectors
 *   kind         'root' when no scanned component renders it, else how it is
 *                first rendered (tag → child, Collection → collection-item,
 *                Switchable → switchable)
 *   entry        true when run(), defineElement() or a Vike +Page / +Layout default
 *                export starts it; 'unknown' on the other roots when an entry call's
 *                component can't be resolved (picked at run time); omitted otherwise (A-6)
 *   actions      intent actions + model entries; trigger: builtin
 *                (BOOTSTRAP/INITIALIZE/DISPOSE/READY), intent, reply (an
 *                ok/error literal in a request, or a `connections` name),
 *                next (a next('NAME') literal in the model), behavior (a `uses`
 *                entry's action nothing else triggers that the behavior may dispatch
 *                itself where the checker can't list it: a package behavior, an open
 *                model like form's, an unreadable intent or dynamic names), else unknown.
 *                line/column (+ file): the intent property, else the model entry;
 *                modelAt: the model entry (A-4)
 *
 *   Locations (PLAN-10 A-4) are { line, column } (1-based), with `file` only when it
 *   isn't the component's file; actions, selectors, children, controls, commands,
 *   timers, agent actions / queries and childSelects carry them inline.
 *   stateKeys    initialState keys (when statically known)
 *   contextConsumes  context fields the view reads (context.x / { context: { x } })
 *   events       EVENTS sinks returning { type: 'X' }, emit()/event() calls,
 *                EVENTS.select('X') in the component's intent / static props.
 *                The graph's `events[type]` lists each name once in emitters / selectors,
 *                and every component's id in emitterIds / selectorIds (A-3, D528: not
 *                parallel; two same-named components are one name and two ids);
 *                eventSites: [{ type, role: 'emit' | 'select', line, column }]
 *                per component (omitted when none)
 *   contextEntries  [{ name, line, column }] of the `context` static (omitted when none)
 *   children     tag / Collection / Switchable usages in the view, and
 *                components passed into a child as children or slots ('slot'),
 *                and widget tags (`widget: true`); id: the rendered node's id,
 *                resolved through the import (null: not in the graph: a package,
 *                a widget, a file not scanned, a dynamic value); state: a literal
 *                `state` lens; external: the package a tag is imported from
 *                ('sygnal/ui'; package components are not nodes, A-2)
 *   childSelects CHILD.select(Child) in the intent: { child, id, actions (the intent
 *                actions whose stream contains it: the receivers of the child's
 *                PARENT sink), line, column } (omitted when none; A-5)
 *   selectors    intent DOM selectors; matched / isolationHit from the
 *                SYG110 / SYG104 findings (null for document/body/dynamic);
 *                `control` names the control a selector is ([data-control="Add"])
 *   controls     controls the view renders: { name, element, kind?, listened }
 *                (omitted when there are none; PLAN-4 CT-1)
 *   uses         the `uses` static's entries: { key, behavior, status } (omitted when
 *                none; PLAN-4 GS-1). Behavior-owned actions ('pager.NEXT') are in
 *                `actions` with `behavior: key`; what a behavior listens to through
 *                a control option is in `selectors` with `behavior: key`
 *   commands     the ELEMENT commands the model sends: { action, method, target, control?,
 *                triggers? } (target: the control's key or the selector; null when dynamic;
 *                triggers: the intent actions listening on the target for a native event the
 *                command causes, e.g. close → DOM.close(Dialog); omitted when none; PLAN-4 GS-2)
 *   timers       the `timers` static's literal specs: { name, every?, after?, frame?, action?,
 *                background? } (omitted when none; PLAN-4 GS-7). Timer actions are in `actions`
 *                with trigger 'reply' (the timer driver dispatches them as reply actions)
 *   agent        the `agent` static (sygnal/ai, PLAN-6 K-1): { name (the literal agent.name, null
 *                when absent or dynamic), tools (the tool-name prefix: name, else the component's,
 *                snake_case; null when dynamic), description, read (has a read projection),
 *                actions: [{ name, consequential, input }], queries?: [{ name, input }] (the read-only
 *                agent.queries tools; omitted when none), partial? (spreads: incomplete) }
 *                (omitted when none). Actions only an agent dispatches have trigger 'agent'
 *   diagnostics  the normal rules (+ strict ones with `strict: true`),
 *                attached to their component (with its `componentId`), the rest app-wide
 */
import path from 'node:path'
import { expandInputs } from './files.js'
import { buildProject } from './model/project.js'
import { selectRules } from './rules/index.js'
import { runRules, sortDiagnostics } from './run.js'
import { resolveOptions } from './config.js'
import { memberName, stringValue, loc, walk, fileOfNode, unwrap, isFunction } from './ast.js'
import { resolveExpr, resolveExport } from './model/resolve.js'
import { BUILTIN_ACTIONS } from './model/modelEntries.js'
import { listenedControls } from './rules/syg124-controls.js'
import { behaviorActions } from './model/behaviors.js'
import { specFields } from './model/timers.js'
import { CAUSED_EVENTS } from './model/elementCommands.js'
import { agentName } from './model/agent.js'
import { contextNames, contextReads } from './model/context.js'
import { findBinding } from './scope.js'

const VIA_KIND = { tag: 'child', collection: 'collection-item', switchable: 'switchable' }

export function graph(inputs, options = {}) {
  const { options: opts, config } = resolveOptions(options)
  const list = inputs == null ? opts.paths : Array.isArray(inputs) ? inputs : [inputs]
  const { files } = expandInputs(list, { cwd: opts.cwd, includeTests: opts.includeTests, sources: opts.sources })
  return graphFiles(files, { ...opts, extraDiagnostics: config.diagnostics })
}

/** graph() for an already expanded list of absolute file paths (see expandInputs). */
export function graphFiles(files, options = {}) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const project = buildProject(files, { cwd, sources: options.sources, cache: options.cache })
  const rules = options.rules || selectRules({ strict: options.strict, a11y: options.a11y })
  let diags = runRules(project, rules)
  if (options.extraDiagnostics?.length) diags = [...options.extraDiagnostics, ...diags]
  if (options.ignore?.length) diags = diags.filter(d => !options.ignore.includes(d.code))
  return buildGraph(project, sortDiagnostics(diags))
}

const contains = (outer, inner) => !!outer && !!inner && inner.start >= outer.start && inner.end <= outer.end

/** Every child usage of a view sink, with the ones passed INTO children as 'slot' (widgets: `widget`). */
function usagesOf(sink, slot = false, out = [], seen = new Set()) {
  if (!sink || seen.has(sink)) return out
  seen.add(sink)
  for (const u of sink.children) {
    out.push({ usage: u, via: slot ? 'slot' : u.kind, from: u.kind === 'collection' ? collectionFrom(sink, u) : undefined })
    usagesOf(u.injected, true, out, seen)
  }
  for (const w of sink.widgets || []) out.push({ usage: w, via: slot ? 'slot' : 'tag', widget: true })
  return out
}

/** The location fields of a node: { line, column }, plus `file` when it isn't the component's file. */
function where(rel, node, file, base) {
  const p = loc(node)
  const out = { line: p.line, column: p.column }
  if (file && file !== base) out.file = rel(file)
  return out
}

/** The name a view-only component is declared under (its function, or the const it is assigned to). */
function declaredName(file, fn) {
  if (fn.id?.name) return fn.id.name
  const p = file.parents.get(fn)
  return p?.type === 'VariableDeclarator' && p.id.type === 'Identifier' ? p.id.name : null
}

const SYGNAL = /^sygnal(\/|$)/
// PLAN-10 A-6: the calls that start an app or register a component, and the argument holding it
const ENTRY_CALLS = { run: 0, defineElement: 1 }
const VIKE_PAGE = /(^|[\\/])\+(Page|Layout)\.[cm]?[jt]sx?$/

/**
 * The components the scanned files start: run(App), defineElement(tag, App), and Vike's
 * `+Page` / `+Layout` default exports. → { refs: [{ file, node }], unknown } (unknown: a call whose
 * component the checker can't resolve, e.g. a parameter picked at run time)
 */
function findEntries(project) {
  const refs = []
  let unknown = false
  const add = (r) => { if (r?.node && isFunction(r.node)) refs.push({ file: r.file, node: r.node }); else unknown = true }
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
      if (arg && arg.type !== 'SpreadElement') add(resolveExpr(project, file, arg))
      return true
    })
    if (VIKE_PAGE.test(p)) { const r = resolveExport(project, file, 'default'); if (r) add(r) }
  }
  return { refs, unknown }
}

function collectionFrom(sink, usage) {
  const c = sink.collections.find(x => x.node === usage.node)
  return c ? c.from : null
}

function slimDiagnostic(d, componentId) {
  const out = { code: d.code, severity: d.severity, message: d.message }
  if (d.component) out.component = d.component
  if (componentId) out.componentId = componentId
  if (d.fix) out.fix = d.fix
  if (d.docsUrl) out.docsUrl = d.docsUrl
  if (d.data !== undefined) out.data = d.data
  if (d.file) {
    out.file = d.file; out.line = d.line; out.column = d.column
    // PLAN-7 C-2: the range end and the related locations
    if (d.endLine !== undefined) { out.endLine = d.endLine; out.endColumn = d.endColumn }
  }
  if (d.related?.length) out.related = d.related
  // PLAN-7 C-4: the fixes as edits (the same objects, no copy)
  if (d.fixes?.length) out.fixes = d.fixes
  return out
}

export function buildGraph(project, diagnostics = []) {
  const comps = project.components
  const rel = (file) => project.relPath(file.path)
  const idOf = (c) => `${rel(c.file)}:${loc(c.node).line}`
  const at = (node, file, base) => where(rel, node, file, base)

  // PLAN-10 A-6: the entries (run(), defineElement(), Vike pages)
  const entries = findEntries(project)

  // PLAN-10 A-1: view-only components, functions in the scanned files rendered as component tags
  // (or started as entries) that have no statics; they render children too
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
  const usagesByComp = new Map()
  for (let i = 0; i < units.length; i++) {
    const c = units[i]
    const usages = usagesOf(c.viewInfo)
    usagesByComp.set(c, usages)
    for (const { usage } of usages) {
      const u = usage.ref && unitOf(usage.ref)
      if (u?.viewOnly && !u.name) u.name = usage.name
    }
  }
  for (const u of viewOnly.values()) if (!u.name) u.name = path.basename(u.file.path).replace(/\.[^.]+$/, '')
  const idFor = (ref) => { const u = ref && unitOf(ref); return u ? idOf(u) : null }

  // kind: how each component is rendered by the other scanned components
  const renderedAs = new Map()
  for (const c of units) {
    for (const { usage, via } of usagesByComp.get(c)) {
      const target = usage.ref && unitOf(usage.ref)
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
  const sites = new Map(comps.map(c => [c, []]))
  const events = {}
  // names once each; PLAN-10 A-3 / D528: emitterIds / selectorIds list every component's id (not
  // parallel to the names: two same-named components are one name and two ids)
  const ev = (type) => events[type] || (events[type] = { emitters: [], selectors: [], emitterIds: [], selectorIds: [] })
  const add = (e, key, owner) => {
    const id = idOf(owner), ids = e[key === 'emitters' ? 'emitterIds' : 'selectorIds']
    if (!e[key].includes(owner.name)) e[key].push(owner.name)
    if (!ids.includes(id)) ids.push(id)
  }
  const site = (owner, type, role, e) => {
    const file = e.file || fileOfNode(project, e.node, owner.file)
    sites.get(owner).push({ type, role, ...at(e.node, file, owner.file) })
  }
  for (const s of project.events.selected) {
    const owner = ownerOf(s, 'select')
    ev(s.type)
    if (owner) { selected.get(owner).add(s.type); add(events[s.type], 'selectors', owner); if (!s.implicit) site(owner, s.type, 'select', s) }
  }
  for (const e of project.events.emitted) {
    const owner = e.component ? comps.find(c => c.name === e.component && c.model?.eventsEmitted.some(x => x.node === e.node)) : ownerOf(e, 'emit')
    ev(e.type)
    if (owner) { emitted.get(owner).add(e.type); add(events[e.type], 'emitters', owner); site(owner, e.type, 'emit', e) }
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

  const childrenOf = (c) => {
    const children = []
    for (const { usage, via, from, widget } of usagesByComp.get(c)) {
      const id = widget ? null : idFor(usage.ref)
      if (children.some(x => x.name === usage.name && x.via === via && x.id === id)) continue
      const child = { name: usage.name, via }
      if (via === 'collection') child.from = from ?? null
      child.id = id
      if (usage.state != null) child.state = usage.state
      if (usage.external) child.external = usage.external
      if (widget) child.widget = true
      Object.assign(child, at(usage.node, usage.file, c.file))
      children.push(child)
    }
    return children
  }
  const entryOf = (c) => entryUnits.has(c) ? true : entries.unknown && !renderedAs.has(c) ? 'unknown' : undefined

  const components = comps.map(c => {
    const intentActions = (c.intent?.actions || []).map(a => a.name)
    const modelEntries = c.model?.entries || []
    const next = new Set((c.model?.nextTargets || []).map(t => t.name))
    const replies = new Set([...(c.model?.replyTargets || []), ...(c.connections?.targets || [])].map(t => t.name))
    const sinks = new Map()
    for (const a of intentActions) sinks.set(a, sinks.get(a) || [])
    for (const e of modelEntries) {
      const list = sinks.get(e.action) || []
      for (const s of e.sinks) if (!list.includes(s)) list.push(s)
      sinks.set(e.action, list)
    }
    // PLAN-4 GS-1: behavior-owned actions ('pager.NEXT'), with the uses key that owns them
    const owned = behaviorActions(c.uses)
    const usesByKey = new Map()
    for (const e of c.uses?.entries || []) {
      if (e.status !== 'invalid') usesByKey.set(e.key, e)
      if (!e.def) continue
      for (const t of e.def.nextTargets) next.add(e.def.model?.has(t) ? `${e.key}.${t}` : t)
      // PLAN-10 A-8: a reply the behavior's own request names goes to its own (namespaced) action
      for (const t of e.def.replyTargets) replies.add(e.def.model?.has(t) ? `${e.key}.${t}` : t)
    }
    for (const [name, b] of owned) {
      const list = sinks.get(name) || []
      for (const s of b.sinks) if (!list.includes(s)) list.push(s)
      sinks.set(name, list)
    }
    // PLAN-10 A-8: the uses entry a namespaced action belongs to, and whether that behavior may
    // dispatch it itself in a way the checker can't list (a package behavior, an open model, an
    // intent or next()/reply names it can't read)
    const usesOf = (name) => { const i = name.indexOf('.'); return i > 0 ? usesByKey.get(name.slice(0, i)) || null : null }
    const selfDispatched = (e) => e.status === 'opaque' || (!!e.def && (!e.def.model || !e.def.intentActions || e.def.dynamic))
    // PLAN-6 K-1: actions only an agent dispatches (the `agent` static's actions)
    const agentActions = new Set((c.agent?.actions || []).map(a => a.name))
    const intentAt = new Map((c.intent?.actions || []).map(a => [a.name, a]))
    const modelAt = new Map()
    for (const e of modelEntries) if (!modelAt.has(e.action)) modelAt.set(e.action, e)
    const actions = [...sinks].map(([name, s]) => {
      const b = owned.get(name)
      let trigger = BUILTIN_ACTIONS.has(name) ? 'builtin' : intentActions.includes(name) || b?.intent ? 'intent' : replies.has(name) ? 'reply' : next.has(name) ? 'next' : agentActions.has(name) ? 'agent' : 'unknown'
      const u = !b && usesOf(name)
      if (trigger === 'unknown' && (b ? selfDispatched(b.entry) : u && selfDispatched(u))) trigger = 'behavior'
      const action = { name, trigger, sinks: s }
      if (b) action.behavior = b.entry.key
      else if (u) action.behavior = u.key
      // PLAN-10 A-4: the intent property (else the model entry), and the model entry
      const i = intentAt.get(name), m = modelAt.get(name)
      if (i || m) Object.assign(action, i ? at(i.node, c.intent.file, c.file) : at(m.node, m.file, c.file))
      if (m) action.modelAt = at(m.node, m.file, c.file)
      return action
    })

    const own = byComp.get(c)
    const selectors = [...(c.intent?.selectors || []), ...(c.behaviorSelectors || [])].map(sel => {
      const pos = loc(sel.node)
      const srcFile = sel.file || c.intent.file
      const file = rel(srcFile)
      const text = sel.selector ?? srcFile.source.slice(sel.node.start, sel.node.end)
      const found = own.filter(d => d.file === file && d.line === pos.line && d.column === pos.column)
      const crossed = found.find(d => d.code === 'SYG104')
      const missing = found.find(d => d.code === 'SYG110' && d.severity !== 'info')
      const unsure = sel.global || sel.dynamic || found.some(d => d.code === 'SYG110' && d.severity === 'info')
      const out = {
        selector: text,
        events: sel.method === 'select' ? (sel.behavior ? null : selectEvents(srcFile, sel.node)) : [sel.method],
        matched: crossed || missing ? false : unsure ? null : true,
        isolationHit: crossed ? crossed.data?.child ?? null : null,
      }
      if (sel.control) out.control = sel.control.key
      if (sel.behavior) out.behavior = sel.behavior
      Object.assign(out, at(sel.node, srcFile, c.file))
      return out
    })

    // controls the view renders (PLAN-4 CT-1), next to the selectors
    const listened = listenedControls(project, c)
    const unknownIntent = !!c.staticProps.intent && !c.intent?.fn
    const controls = []
    for (const sink of c.viewInfo ? [c.viewInfo, ...project.injectedInto(c.view)] : []) {
      for (const [ctrl, openings] of sink.controls) {
        if (controls.some(x => x.ctrl === ctrl)) continue
        controls.push({ ctrl, name: ctrl.key, element: ctrl.element, kind: ctrl.kind, listened: unknownIntent ? null : listened.has(ctrl), opening: openings[0] })
      }
    }

    const node = {
      name: c.name,
      id: idOf(c),
      key: null, // PLAN-10 D521: set below, once every unit is known
      parentId: null,
      file: rel(c.file),
      kind: VIA_KIND[renderedAs.get(c)] || 'root',
      actions,
      stateKeys: [...new Set([...(c.initialState ? c.initialState.keys.keys() : []), ...(c.uses?.entries || []).filter(e => e.status !== 'invalid').map(e => e.key)])],
      calculated: [...c.calculatedKeys],
      contextProvides: [...c.contextKeys],
      contextConsumes: contextNames(c.contextConsumed),
      eventsEmitted: [...emitted.get(c)],
      eventsSelected: [...selected.get(c)],
      children: childrenOf(c),
      selectors,
      diagnostics: own.map(d => slimDiagnostic(d, idOf(c))),
    }
    const entry = entryOf(c)
    if (entry !== undefined) node.entry = entry
    // PLAN-10 A-4: where the context entries and the EVENTS emit / select sites are
    if (c.contextEntries?.size) node.contextEntries = [...c.contextEntries].map(([name, e]) => ({ name, ...at(e.keyNode, e.file, c.file) }))
    if (sites.get(c).length) node.eventSites = sites.get(c)
    // PLAN-10 A-5: CHILD.select(Child) in the intent, with the intent actions it feeds
    const childSelects = (c.intent?.childSelects || []).map(cs => ({
      child: cs.arg?.type === 'StringLiteral' ? cs.arg.value : cs.arg?.type === 'Identifier' ? cs.arg.name : cs.arg ? c.intent.file.source.slice(cs.arg.start, cs.arg.end) : null,
      id: idFor(cs.ref),
      actions: actionsAround(c.intent, cs.node),
      ...at(cs.node, c.intent.file, c.file),
    }))
    if (childSelects.length) node.childSelects = childSelects
    if (c.uses?.entries.length) {
      node.uses = c.uses.entries.map(e => ({ key: e.key, behavior: e.def?.name ?? null, status: e.status }))
    }
    // PLAN-4 GS-2: the ELEMENT commands its model sends (literal command objects)
    if (c.commands?.length) {
      node.commands = c.commands.map(cmd => {
        const out = { action: cmd.action, method: cmd.method, target: cmd.control ? cmd.control.key : cmd.selector ?? null }
        if (cmd.control) out.control = cmd.control.key
        const triggers = commandTriggers(c, cmd)
        if (triggers.length) out.triggers = triggers
        return Object.assign(out, at(cmd.node, cmd.file, c.file))
      })
    }
    // PLAN-4 GS-7: the `timers` static's literal specs
    if (c.timers?.specs.length) {
      node.timers = c.timers.specs.filter(s => s.node.type === 'ObjectExpression').map(s => ({ name: s.name, ...specFields(s.node), ...at(s.nameNode || s.node, s.file, c.file) }))
      if (!node.timers.length) delete node.timers
    }
    // PLAN-6 K-1: the `agent` declaration (sygnal/ai)
    if (c.agent) {
      const a = c.agent
      node.agent = {
        name: a.known && !a.nameDynamic ? (a.name ?? null) : null,
        tools: agentName(c),
        description: a.description,
        read: a.read,
        actions: a.actions.map(x => ({ name: x.name, consequential: x.consequential, input: !!x.input, ...at(x.node, x.file, c.file) })),
      }
      if (a.queries.length) node.agent.queries = a.queries.map(x => ({ name: x.name, input: !!x.input, ...at(x.node, x.file, c.file) }))
      if (!a.known || !a.actionsKnown || (a.queries.length && !a.queriesKnown)) node.agent.partial = true
    }
    if (controls.length) {
      node.controls = controls.map(({ name, element, kind, listened, opening }) => {
        const entry = { name, element: element ?? null, listened }
        if (kind) entry.kind = kind
        const file = opening && fileOfNode(project, opening, c.file)
        if (file) Object.assign(entry, at(opening, file, c.file))
        return entry
      })
    }
    return node
  })

  // PLAN-10 A-1: the view-only components, after the others
  for (const u of units.slice(comps.length)) {
    const node = {
      name: u.name,
      id: idOf(u),
      key: null,
      parentId: null,
      file: rel(u.file),
      kind: VIA_KIND[renderedAs.get(u)] || 'root',
      viewOnly: true,
      actions: [],
      stateKeys: [],
      calculated: [],
      contextProvides: [],
      contextConsumes: contextNames(contextReads(u.view)),
      eventsEmitted: [],
      eventsSelected: [],
      children: childrenOf(u),
      selectors: [],
      diagnostics: [],
    }
    const entry = entryOf(u)
    if (entry !== undefined) node.entry = entry
    components.push(node)
  }

  // PLAN-10 D521: the stable key, 'file#name' (no line, so it survives edits above the definition)
  const keys = keysOf(units, rel)
  components.forEach((node, i) => { node.key = keys.get(units[i]) })

  return { version: 1, source: 'static', components, events, diagnostics: appWide.map(d => slimDiagnostic(d)) }
}

/**
 * PLAN-10 D521: 'file#name' per unit (components and view-only ones alike); when several units in one
 * file share a name, the first in source order keeps 'file#name' and the others get '#2', '#3', ...
 */
function keysOf(units, rel) {
  const groups = new Map()
  for (const u of units) {
    const k = `${rel(u.file)}#${u.name}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(u)
  }
  const out = new Map()
  for (const [k, list] of groups) {
    list.sort((a, b) => a.node.start - b.node.start)
    list.forEach((u, i) => out.set(u, i ? `${k}#${i + 1}` : k))
  }
  return out
}

/** The intent actions whose stream expression contains `node` (a CHILD.select call). */
function actionsAround(intent, node) {
  const out = []
  for (const a of intent.actions) {
    const v = intent.file.parents.get(a.node)?.value
    if (v && v.start <= node.start && node.end <= v.end && !out.includes(a.name)) out.push(a.name)
  }
  return out
}

/**
 * The intent actions a command sets off: those listening on its target for a native event the
 * command makes the element fire (`{ close: HelpDialog }` → DOM.close(HelpDialog) → HELP_CLOSED).
 */
function commandTriggers(comp, cmd) {
  const events = CAUSED_EVENTS[cmd.method]
  const intent = comp.intent
  if (!events || !intent?.fn) return []
  const out = []
  for (const sel of intent.selectors) {
    const same = cmd.control ? sel.control === cmd.control : sel.selector != null && sel.selector === cmd.selector
    if (!same) continue
    const types = sel.method === 'select' ? selectEvents(intent.file, sel.node) : [sel.method]
    if (!types.some(t => events.includes(t))) continue
    for (const a of intent.actions) {
      const prop = intent.file.parents.get(a.node)
      const v = prop?.value
      if (v && v.start <= sel.node.start && sel.node.end <= v.end && !out.includes(a.name)) out.push(a.name)
    }
  }
  return out
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
