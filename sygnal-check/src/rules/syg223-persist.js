/**
 * persist() (PLAN-4 GS-5), statically. The dev entry reports both codes at run time
 * (src/extra/diagnostics/checks/persist.ts); these catch them before the app runs.
 *
 *   SYG223 (warn)   a literal `pick` / `omit` key of `C.persist = persist({ ... })` that isn't a
 *                   key of C's literal initialState (a typo: that key is never saved, or never
 *                   left out). Silent when the options, the array or the initialState aren't
 *                   literal (a spread, a call).
 *   SYG224 (error)  `persist` on a component that isn't the root: the core sets it up on the root
 *                   only. Reported when a run() call in the scanned files renders the component
 *                   and none has it as its root; silent when no run() root renders it (a library
 *                   component, an app whose run() call isn't scanned, a test).
 */
import { unwrap, propName, stringValue } from '../ast.js'
import { closestName } from '../names.js'
import { sygnalImport } from '../model/behaviors.js'
import { resolveExpr } from '../model/resolve.js'
import { findApps } from '../model/apps.js'

/** the options object literal of a `persist({ ... })` value, or null */
function persistOptions(project, comp) {
  const r = resolveExpr(project, comp.file, comp.staticProps.persist)
  const call = unwrap(r?.node)
  if (call?.type !== 'CallExpression' || sygnalImport(r.file, call.callee) !== 'persist') return null
  const o = call.arguments[0] && resolveExpr(project, r.file, call.arguments[0])
  const obj = unwrap(o?.node)
  return obj?.type === 'ObjectExpression' ? { file: o.file, node: obj } : null
}

function reportKeys(project, report, comp) {
  if (!comp.initialState?.known) return
  const opts = persistOptions(project, comp)
  if (!opts) return
  const keys = [...comp.initialState.keys.keys()]
  for (const p of opts.node.properties) {
    if (p.type !== 'ObjectProperty') continue
    const opt = propName(p)
    if (opt !== 'pick' && opt !== 'omit') continue
    const r = resolveExpr(project, opts.file, p.value)
    const arr = unwrap(r?.node)
    if (arr?.type !== 'ArrayExpression') continue
    for (const el of arr.elements) {
      const k = el && stringValue(el)
      if (k == null || comp.initialState.keys.has(k)) continue
      const near = closestName(k, keys)
      report({
        code: 'SYG223',
        component: comp.name,
        file: r.file,
        node: el,
        message: `persist ${opt} names '${k}', which is not a key of ${comp.name}.initialState, so it is ${opt === 'pick' ? 'never saved' : 'never left out'}${near ? ` (did you mean '${near}'?)` : ''}`,
        fix: near ? `rename '${k}' to '${near}'` : `use top-level keys of initialState in ${opt} (${keys.join(', ')}), or add '${k}' to initialState`,
        data: { option: opt, key: k, ...(near ? { suggestion: near } : {}) },
      })
    }
  }
}

export default {
  id: 'persist',
  codes: ['SYG223', 'SYG224'],
  description: 'persist(): a pick / omit key not in initialState; persist on a component that is not the root',
  run(project, report) {
    const persisted = project.components.filter(c => c.staticProps.persist)
    if (!persisted.length) return
    let apps
    for (const comp of persisted) {
      reportKeys(project, report, comp)
      apps ||= findApps(project)
      const rendering = apps.filter(a => a.components.has(comp))
      if (!rendering.length || rendering.some(a => !a.root || a.root === comp)) continue
      const roots = [...new Set(rendering.map(a => a.root.name))]
      report({
        code: 'SYG224',
        component: comp.name,
        file: comp.file,
        node: comp.staticPropNodes?.persist || comp.staticProps.persist,
        message: `${comp.name}.persist is set, but ${comp.name} is not the root component (run() renders ${roots.join(', ')}), so its state is never saved or restored: persist() works on the root only`,
        fix: `move persist to ${roots[0]} and pick the keys that hold ${comp.name}'s state`,
        data: { roots },
      })
    }
  },
}
