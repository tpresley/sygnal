/**
 * SYG171 (PLAN-10 X-1, D512): a component sends to `PARENT`, but no component that renders it
 * reads `CHILD.select(It)`, so every value it sends goes nowhere.
 *
 * Reported (warn) at the component's first PARENT sink only when every fact is static:
 *   - scanned components render it by tag, as a Collection item or a Switchable target (JSX passed
 *     into another component is placed, and so parented, by that component: silent);
 *   - no scanned intent reads CHILD.select(It) at all (one that reads it in the wrong component
 *     is SYG129's);
 *   - every parent's intent is readable and uses CHILD only as CHILD.select(X) with X resolved to
 *     another component, or the parent has no intent; a parent with `uses` (a behavior may read
 *     CHILD), a sources rest pattern, or CHILD passed elsewhere (a helper) keeps it silent.
 * A component nothing scanned renders (a catalog part, a defineElement() element, whose PARENT
 * values become DOM events) is never reported.
 */
import { walk, unwrap, memberName } from '../ast.js'
import { renderGraph } from '../model/renderGraph.js'
import { sourceAliases } from '../model/intent.js'

/**
 * Whether `p` reads CHILD only in ways the checker sees: false when its intent can't be read,
 * passes CHILD (or all of the sources) on, or selects something it can't resolve.
 */
function intentIsClosed(p) {
  if (p.staticProps?.uses) return false
  if (p.viewOnly || !p.staticProps.intent) return true
  const fn = p.intent?.fn
  if (!fn) return false
  let first = fn.params?.[0]
  if (first?.type === 'AssignmentPattern') first = first.left
  if (first?.type === 'ObjectPattern' && first.properties.some(x => x.type === 'RestElement')) return false
  if (first && first.type !== 'ObjectPattern' && first.type !== 'Identifier') return false
  if (p.intent.childSelects.some(cs => !cs.ref)) return false
  const sa = sourceAliases(fn)
  const childNames = sa.aliases.get('CHILD') || new Set()
  const parents = p.intent.file.parents
  let closed = true
  walk(fn.body, (n) => {
    if (!closed) return false
    if (n.type !== 'Identifier') return true
    const isChild = childNames.has(n.name)
    const isSources = sa.sourcesParam === n.name
    if (!isChild && !isSources) return true
    const up = parents.get(n)
    // not a reference: a property key or a member name
    if (up?.type === 'ObjectProperty' && up.key === n && !up.computed && up.value !== n) return true
    if ((up?.type === 'MemberExpression' || up?.type === 'OptionalMemberExpression') && up.property === n && !up.computed) return true
    if (isSources) {
      // sources.X (sources.CHILD only as sources.CHILD.select(...)), or const { … } = sources (no rest)
      if (up?.type === 'VariableDeclarator' && up.init === n && up.id.type === 'ObjectPattern' && !up.id.properties.some(x => x.type === 'RestElement')) return true
      if ((up?.type !== 'MemberExpression' && up?.type !== 'OptionalMemberExpression') || up.object !== n || up.computed) { closed = false; return false }
      if (memberName(up) !== 'CHILD') return true
      const call = parents.get(up)
      if (call?.type !== 'MemberExpression' || memberName(call) !== 'select' || unwrap(parents.get(call)?.callee) !== call) closed = false
      return true
    }
    // CHILD: only as CHILD.select(...)
    if ((up?.type !== 'MemberExpression' && up?.type !== 'OptionalMemberExpression') || up.object !== n || memberName(up) !== 'select') { closed = false; return false }
    const call = parents.get(up)
    if (call?.type !== 'CallExpression' || unwrap(call.callee) !== up) closed = false
    return true
  })
  return closed
}

export default {
  id: 'parent-unread',
  codes: ['SYG171'],
  description: 'PARENT sink no parent reads',
  run(project, report) {
    const g = renderGraph(project)
    const selected = new Set()
    for (const c of project.components) for (const cs of c.intent?.childSelects || []) if (cs.ref) selected.add(cs.ref.node)
    for (const c of project.components) {
      const sends = (c.model?.sinkValues || []).filter(s => s.sink === 'PARENT')
      if (!sends.length || !c.view || selected.has(c.view)) continue
      const parents = g.parentsOf.get(c) || []
      if (!parents.length || parents.some(p => p.via === 'slot')) continue
      const units = [...new Set(parents.map(p => p.unit))]
      if (!units.every(intentIsClosed)) continue
      const names = units.map(u => u.name)
      const actions = [...new Set(sends.map(s => s.action))]
      const first = sends[0]
      report({
        code: 'SYG171',
        component: c.name,
        file: first.file,
        node: first.keyNode,
        related: parents.filter(p => p.usage.file).slice(0, 3).map(p => ({ node: p.usage.node?.name || p.usage.node, file: p.usage.file, message: `${p.unit.name} renders <${c.name}> here` })),
        message: `${c.name} sends to PARENT (${actions.join(', ')}), but ${names.join(' and ')} ${names.length === 1 ? 'renders' : 'render'} it without reading CHILD.select(${c.name}), so the value goes nowhere`,
        fix: `read it in ${names[0]}.intent, e.g. ${actions[0]}: CHILD.select(${c.name}), with a model entry for it; or remove the PARENT sink`,
        data: { child: c.name, parents: names, actions },
      })
    }
  },
}
