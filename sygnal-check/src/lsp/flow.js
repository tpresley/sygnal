/**
 * What each action does and what triggers it, per component, for the language server's code
 * lens (PLAN-7 P4-4, codelens.js). Built in the check worker next to the occurrence index
 * (model/positions.js), which has the positions; this has what the index doesn't: each model
 * entry's sinks, the EVENTS types it emits, its next() targets and its reply names, plus the
 * SYG101 / SYG102 verdicts (the rules' own reports, so a lens never disagrees with a finding).
 *
 *   buildFlow(project, verdicts?) → Flow           (plain data: structured-cloneable)
 *     Flow = { [componentId]: {                    componentId: as in the index ('absPath:line')
 *       entries: { [action]: { sinks: string[], events: string[], next: string[],
 *                              replies: [{ sink, key, name }] } },
 *       unhandled: string[],                       SYG101: intent actions with no model entry
 *       untriggered: { [action]: 'error' | 'info' }  SYG102 (info: a dynamic name might trigger it)
 *       extra: { [action]: string[] }              triggers the index has no occurrence for:
 *                                                  'persist' (RESTORE), 'behavior <key>' (a
 *                                                  behavior's next() / reply names)
 *     } }
 *
 *   tapVerdicts(rules) → { rules, verdicts }
 *     `rules` with SYG101 and SYG102 replaced by versions that run the rule once per component
 *     (a view of the project with only that component) and record each component's reports
 *     before passing them on: runRules() over them gives the same diagnostics, and `verdicts`
 *     (pass it to buildFlow) the verdicts of that same run, so the check runs those rules once
 *     (P4 perf). The reports are recorded as the rule makes them (before `// sygnal-ignore` and
 *     `ignore`), as when buildFlow runs the rules itself. A rule not in `rules`, or without
 *     `verdicts`: buildFlow runs it per component.
 *
 * An entry's next() targets and EVENTS types are the ones inside its property, or inside a
 * module-level function or call (`const saved = event('SAVED', …)`, same file) or an imported
 * function its property names, followed up to three hops (as the model's next() scan follows
 * reducers). What a function's identifiers refer to in its own file is kept per AST node (the
 * parse cache reuses ASTs across builds); imports are resolved once per build.
 */
import { walk, unwrap, isFunction } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from '../model/resolve.js'
import syg101 from '../rules/syg101-intent-without-model.js'
import syg102 from '../rules/syg102-unreachable-model.js'

const idOf = (c) => `${c.file.path}:${c.node?.loc?.start.line ?? 1}`
const pathOf = (f) => (typeof f === 'string' ? f : f?.path) || null

/**
 * The module-level names of a file that can lead regionsOf() to another function: function
 * declarations, `const x = …` declarations and imports (an identifier with any other name can't).
 * Kept per AST.
 */
const topNamesCache = new WeakMap()
function topNames(f) {
  const program = f.ast?.program
  if (!program) return new Set()
  let names = topNamesCache.get(program)
  if (names) return names
  names = new Set()
  for (let st of program.body) {
    if (st.type === 'ImportDeclaration') { for (const s of st.specifiers) names.add(s.local.name); continue }
    if (st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration') st = st.declaration
    if (st?.type === 'FunctionDeclaration' && st.id) names.add(st.id.name)
    else if (st?.type === 'VariableDeclaration') for (const d of st.declarations) if (d.id.type === 'Identifier') names.add(d.id.name)
  }
  topNamesCache.set(program, names)
  return names
}

/**
 * What a region's identifiers refer to, in walk order: { node } a module-level function (or call)
 * of the same file, or { ident } an imported name (resolved per build: it depends on other files).
 */
const refsCache = new WeakMap()
function refsOf(f, node) {
  let list = refsCache.get(node)
  if (list) return list
  list = []
  const top = topNames(f)
  if (top.size) {
    walk(node, (n, parent) => {
      if (n.type !== 'Identifier' || n === node || !top.has(n.name)) return true
      // a property key or a member's property name is not a reference
      if (parent && !parent.computed && ((parent.type === 'ObjectProperty' && parent.key === n) || (parent.type === 'MemberExpression' && parent.property === n))) return true
      const b = findBinding(f, n.name, n)
      if (!b) return true
      if (b.kind === 'function' && f.parents.get(b.node)?.type === 'Program') list.push({ node: b.node })
      else if (b.kind === 'var' && (isFunction(unwrap(b.init)) || unwrap(b.init)?.type === 'CallExpression')) {
        const decl = f.parents.get(b.node)
        if (f.parents.get(decl)?.type === 'Program') list.push({ node: unwrap(b.init) })
      } else if (b.kind === 'import') list.push({ ident: n })
      return true
    })
  }
  refsCache.set(node, list)
  return list
}

/** The source regions an entry's code lives in: its property, and the functions it names. */
function regionsOf(project, e, imports) {
  const file = e.file
  const prop = file?.parents?.get(e.node)
  if (!prop || prop.key !== e.node) return [] // undoable()'s UNDO / REDO: at the callee
  const out = []
  const seen = new Set()
  const visit = (f, node, depth) => {
    if (!node || seen.has(node)) return
    seen.add(node)
    out.push({ file: f.path, start: node.start, end: node.end })
    if (depth >= 3) return
    for (const ref of refsOf(f, node)) {
      if (ref.node) { visit(f, ref.node, depth + 1); continue }
      let r = imports.get(ref.ident)
      if (r === undefined) imports.set(ref.ident, r = resolveExpr(project, f, ref.ident) || null)
      if (r?.file && r.file !== f && isFunction(r.node)) visit(r.file, r.node, depth + 1)
    }
  }
  visit(file, prop, 0)
  return out
}

const inside = (regions, file, node) => {
  const abs = pathOf(file)
  return !!node && regions.some(r => r.file === abs && node.start >= r.start && node.end <= r.end)
}

/** Run `rule` on one component (a view of the project with only that component). */
function runOn(rule, project, comp, report) {
  const view = Object.create(project, { components: { value: [comp] } })
  rule.run(view, report)
}

/** The findings of one rule for one component; none when the rule can't run on it. */
function findings(rule, project, comp) {
  const out = []
  try {
    runOn(rule, project, comp, (d) => out.push(d))
  } catch {
    // a rule that can't run on this component: no verdict
  }
  return out
}

export function tapVerdicts(rules) {
  const verdicts = { tapped: new Set(), reports: new Map() } // reports: comp → Map<rule, report[]>
  const tap = (rule) => ({
    ...rule,
    run(project, report) {
      for (const c of project.components) {
        let byRule = verdicts.reports.get(c)
        if (!byRule) verdicts.reports.set(c, byRule = new Map())
        const list = []
        byRule.set(rule, list)
        // a crash ends the rule as an untapped run would (runRules turns it into a SYG900); the
        // components after it have no verdict, like the findings the crash cut short
        runOn(rule, project, c, (d) => { list.push(d); report(d) })
      }
    },
  })
  const out = rules.map(r => {
    if (r !== syg101 && r !== syg102) return r
    verdicts.tapped.add(r)
    return tap(r)
  })
  return { rules: out, verdicts }
}

export function buildFlow(project, verdicts = null) {
  const flow = {}
  const imports = new Map() // Identifier → resolveExpr result (this build)
  const regionCache = new Map() // model entry node → regions (a model shared by components)
  const reportsOf = (rule, c) => verdicts?.tapped.has(rule) ? verdicts.reports.get(c)?.get(rule) || [] : findings(rule, project, c)
  for (const c of project.components) {
    const id = idOf(c)
    const entries = {}
    const model = c.model
    for (const e of model?.entries || []) {
      const ent = entries[e.action] ||= { sinks: [], events: [], next: [], replies: [] }
      for (const s of e.sinks) if (!ent.sinks.includes(s)) ent.sinks.push(s)
      let regions = regionCache.get(e.node)
      if (!regions || regions.file !== e.file) {
        regions = regionsOf(project, e, imports)
        regions.file = e.file
        if (e.node) regionCache.set(e.node, regions)
      }
      if (!regions.length) continue
      for (const t of model.nextTargets) if (inside(regions, t.file, t.node) && !ent.next.includes(t.name)) ent.next.push(t.name)
      if (e.sinks.includes('EVENTS')) {
        for (const t of [...model.eventsEmitted, ...project.events.emitted]) {
          if (inside(regions, t.file, t.node) && !ent.events.includes(t.type)) ent.events.push(t.type)
        }
      }
    }
    for (const t of model?.replyTargets || []) {
      const ent = entries[t.action]
      if (ent && !ent.replies.some(r => r.sink === t.sink && r.key === t.key && r.name === t.name)) ent.replies.push({ sink: t.sink, key: t.key, name: t.name })
    }

    const unhandled = [...new Set(reportsOf(syg101, c).map(d => d.data?.action).filter(Boolean))]
    const untriggered = {}
    for (const d of reportsOf(syg102, c)) if (d.data?.action) untriggered[d.data.action] = d.severity === 'info' ? 'info' : 'error'

    const extra = {}
    const more = (name, label) => { const l = extra[name] ||= []; if (!l.includes(label)) l.push(label) }
    if (c.staticProps.persist) more('RESTORE', 'persist')
    for (const u of c.uses?.entries || []) {
      if (!u.def) continue
      for (const t of u.def.nextTargets) more(u.def.model?.has(t) ? `${u.key}.${t}` : t, `behavior ${u.key}`)
      for (const t of u.def.replyTargets) more(t, `behavior ${u.key}`)
    }
    flow[id] = { entries, unhandled, untriggered, extra }
  }
  return flow
}
