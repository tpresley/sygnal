/**
 * SYG129 (PLAN-4 4-G2; PLAN-3 G-187; REPORT-v4: Haiku 12-t3, 14-t1, 14-t5): `CHILD.select(X)` in a
 * component that doesn't render X, while a component it renders does (X is a grandchild or
 * further down). A component's PARENT output reaches only the component that renders it, so the
 * action never fires. The fix is a relay: the intermediate component reads CHILD.select(X) and
 * sends it on with its own PARENT sink.
 *
 * Reported at the CHILD.select call, as a warning, only when every fact is static:
 *   - the argument is an identifier that resolves to a component function;
 *   - this component's view (helpers, Collection / Switchable targets, components passed into a
 *     child) doesn't render X, has no Collection / Switchable target the checker can't resolve,
 *     and doesn't mention X's name anywhere else (h(X), an object of components);
 *   - a component it renders (followed through views the checker can read) renders X.
 * Silent otherwise: no view function, X rendered nowhere the checker can see (not written yet,
 * or rendered through a package component), or a string argument (SYG506 under --strict).
 */
import { walk, unwrap, memberName, isFunction } from '../ast.js'
import { sourceAliases, isSourceRef } from '../model/intent.js'
import { resolveExpr } from '../model/resolve.js'
import { ownerName } from '../model/usages.js'

function usagesOf(sink, out = [], depth = 0) {
  for (const u of sink.children) {
    out.push(u)
    if (depth < 8) usagesOf(u.injected, out, depth + 1)
  }
  return out
}

/** Path of view functions from `start` (exclusive) down to the one that renders `target`, or null. */
function findPath(project, startUsages, target) {
  const seen = new Set()
  const queue = startUsages.filter(u => u.ref).map(u => ({ ref: u.ref, path: [u.ref] }))
  while (queue.length) {
    const { ref, path } = queue.shift()
    if (seen.has(ref.node) || path.length > 20) continue
    seen.add(ref.node)
    const sink = project.viewOf(ref)
    if (!sink) continue
    const uses = usagesOf(sink)
    if (uses.some(u => u.ref?.node === target.node)) return path
    for (const u of uses) if (u.ref && !seen.has(u.ref.node)) queue.push({ ref: u.ref, path: [...path, u.ref] })
  }
  return null
}

function relayFix(names) {
  const [P, mid, ...rest] = names
  const X = names[names.length - 1]
  if (rest.length === 1) {
    return `Relay it through ${mid}: in ${mid}.intent read RELAY: CHILD.select(${X}), in ${mid}.model send it on with ` +
      `RELAY: { PARENT: (state, data) => data }, and read CHILD.select(${mid}) in ${P}. Or broadcast it with EVENTS`
  }
  const between = names.slice(1, -1)
  return `Relay it up one level at a time (${between.join(', ')}): each reads CHILD.select() of the component it renders ` +
    `and sends it on with a PARENT sink; ${P} reads CHILD.select(${mid}). Or broadcast it with EVENTS`
}

export default {
  id: 'child-select-grandchild',
  codes: ['SYG129'],
  description: "CHILD.select() of a component this one doesn't render",
  run(project, report) {
    for (const comp of project.components) {
      const fn = comp.intent?.fn
      const sink = comp.viewInfo
      if (!fn || !comp.view || !sink) continue
      const file = comp.intent.file
      const sa = sourceAliases(fn)
      const calls = []
      walk(fn.body, (n) => {
        if (n.type !== 'CallExpression') return true
        const callee = unwrap(n.callee)
        if (callee.type !== 'MemberExpression' || memberName(callee) !== 'select') return true
        if (!isSourceRef(callee.object, 'CHILD', sa)) return true
        const arg = unwrap(n.arguments[0])
        if (arg?.type === 'Identifier') calls.push({ call: n, arg })
        return true
      })
      if (!calls.length) continue
      const own = usagesOf(sink)
      // a Collection / Switchable target the checker can't resolve might be anything
      if (own.some(u => u.kind !== 'tag' && !u.ref)) continue
      const viewText = comp.file.source.slice(comp.view.start, comp.view.end)
      for (const { call, arg } of calls) {
        const r = resolveExpr(project, file, arg)
        if (!r?.node || !isFunction(r.node)) continue
        const target = { file: r.file, node: r.node }
        if (own.some(u => u.ref?.node === target.node)) continue
        const xName = project.componentForFunction(target.node)?.name || arg.name
        if (own.some(u => !u.ref && (u.name === arg.name || u.name === xName))) continue
        const mentions = new RegExp(`\\b(${[...new Set([arg.name, xName])].join('|')})\\b`)
        if (mentions.test(viewText)) continue
        const path = findPath(project, own, target)
        if (!path) continue
        const names = [comp.name, ...path.map(ref => ownerName(project, ref)), xName]
        report({
          code: 'SYG129',
          component: comp.name,
          file,
          node: call,
          message: `CHILD.select(${arg.name}) never fires: a component's PARENT output reaches only the component that renders it, ` +
            `and ${comp.name} doesn't render ${xName}; it is rendered further down (${names.join(' > ')})`,
          fix: relayFix(names),
          data: { child: xName, path: names },
        })
      }
    }
  },
}
