/**
 * What each action does and what triggers it, per component, for the language server's code
 * lens (PLAN-7 P4-4, codelens.js). Built in the check worker next to the occurrence index
 * (model/positions.js), which has the positions; this has what the index doesn't: each model
 * entry's sinks, the EVENTS types it emits, its next() targets and its reply names, plus the
 * SYG101 / SYG102 verdicts (the rules themselves, so a lens never disagrees with a finding).
 *
 *   buildFlow(project) → Flow                      (plain data: structured-cloneable)
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
 * An entry's next() targets and EVENTS types are the ones inside its property, or inside a
 * module-level function or call (`const saved = event('SAVED', …)`, same file) or an imported
 * function its property names, followed up to three hops (as the model's next() scan follows
 * reducers).
 */
import { walk, unwrap, isFunction } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from '../model/resolve.js'
import syg101 from '../rules/syg101-intent-without-model.js'
import syg102 from '../rules/syg102-unreachable-model.js'

const idOf = (c) => `${c.file.path}:${c.node?.loc?.start.line ?? 1}`
const pathOf = (f) => (typeof f === 'string' ? f : f?.path) || null

/** The source regions an entry's code lives in: its property, and the functions it names. */
function regionsOf(project, e) {
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
    walk(node, (n, parent) => {
      if (n.type !== 'Identifier' || n === node) return true
      // a property key or a member's property name is not a reference
      if (parent && !parent.computed && ((parent.type === 'ObjectProperty' && parent.key === n) || (parent.type === 'MemberExpression' && parent.property === n))) return true
      const b = findBinding(f, n.name, n)
      if (!b) return true
      if (b.kind === 'function' && f.parents.get(b.node)?.type === 'Program') visit(f, b.node, depth + 1)
      else if (b.kind === 'var' && (isFunction(unwrap(b.init)) || unwrap(b.init)?.type === 'CallExpression')) {
        const decl = f.parents.get(b.node)
        if (f.parents.get(decl)?.type === 'Program') visit(f, unwrap(b.init), depth + 1)
      } else if (b.kind === 'import') {
        const r = resolveExpr(project, f, n)
        if (r?.file && r.file !== f && isFunction(r.node)) visit(r.file, r.node, depth + 1)
      }
      return true
    })
  }
  visit(file, prop, 0)
  return out
}

const inside = (regions, file, node) => {
  const abs = pathOf(file)
  return !!node && regions.some(r => r.file === abs && node.start >= r.start && node.end <= r.end)
}

/** The findings of one rule for one component (a view of the project with only that component). */
function findings(rule, project, comp) {
  const out = []
  const view = Object.create(project, { components: { value: [comp] } })
  try {
    rule.run(view, (d) => out.push(d))
  } catch {
    // a rule that can't run on this component: no verdict
  }
  return out
}

export function buildFlow(project) {
  const flow = {}
  for (const c of project.components) {
    const id = idOf(c)
    const entries = {}
    const model = c.model
    for (const e of model?.entries || []) {
      const ent = entries[e.action] ||= { sinks: [], events: [], next: [], replies: [] }
      for (const s of e.sinks) if (!ent.sinks.includes(s)) ent.sinks.push(s)
      const regions = regionsOf(project, e)
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

    const unhandled = [...new Set(findings(syg101, project, c).map(d => d.data?.action).filter(Boolean))]
    const untriggered = {}
    for (const d of findings(syg102, project, c)) if (d.data?.action) untriggered[d.data.action] = d.severity === 'info' ? 'info' : 'error'

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
