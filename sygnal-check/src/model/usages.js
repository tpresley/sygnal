/**
 * Child-component usages across the project (PLAN-4 4-G2): every tag, Collection / Switchable
 * target and component passed into a child (children, slots), in the views of the scanned
 * components and of every function they render, as far as the checker can follow.
 *
 *   renderedUsages(project) → Array<{ owner, usage }>
 *     owner  { name, ref: { file, node } }   the component (view function) whose JSX holds the usage
 *     usage  a view sink child: { kind: 'tag' | 'collection' | 'switchable', name, ref, node, file, injected }
 *
 *   ownerName(project, ref) → the component's name, or the function's name
 *   stateAttr(usage)        → the usage's `state` attribute: { text, field } or null
 */
import { unwrap } from '../ast.js'

export function ownerName(project, ref) {
  const comp = project.componentForFunction(ref.node)
  if (comp) return comp.name
  const n = ref.node
  if (n.id?.name) return n.id.name
  const p = ref.file.parents.get(n)
  if (p?.type === 'VariableDeclarator' && p.id?.type === 'Identifier') return p.id.name
  return '<anonymous>'
}

export function renderedUsages(project) {
  if (project._renderedUsages) return project._renderedUsages
  const out = []
  const seen = new Set()
  const queue = project.components.filter(c => c.view).map(c => ({ file: c.file, node: c.view }))
  while (queue.length) {
    const ref = queue.shift()
    if (!ref?.node || seen.has(ref.node)) continue
    seen.add(ref.node)
    const sink = project.viewOf(ref)
    if (!sink) continue
    const owner = { name: ownerName(project, ref), ref }
    const visit = (s, depth) => {
      for (const u of s.children) {
        out.push({ owner, usage: u })
        if (u.ref) queue.push(u.ref)
        if (depth < 8) visit(u.injected, depth + 1)
      }
    }
    visit(sink, 0)
  }
  project._renderedUsages = out
  return out
}

/** The `state` attribute of a usage's opening element: { text, field } (field: the literal name) or null. */
export function stateAttr(usage) {
  for (const a of usage.node.attributes || []) {
    if (a.type !== 'JSXAttribute' || a.name?.name !== 'state') continue
    const v = a.value
    if (v?.type === 'StringLiteral') return { text: `state="${v.value}"`, field: v.value }
    const e = v?.type === 'JSXExpressionContainer' ? unwrap(v.expression) : null
    if (e?.type === 'StringLiteral') return { text: `state="${e.value}"`, field: e.value }
    return { text: 'state={…}', field: null }
  }
  return null
}
