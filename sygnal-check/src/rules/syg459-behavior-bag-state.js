/**
 * SYG459 (7.2, N6): a behavior option reads a host-state field off its bag.
 *
 * Since 7.2 the wizard's and the form's functions get the bag the view gets,
 * `{ ...props, state, context, uid }`, after their own arguments. Before, the wizard's second
 * argument was the host's state, so `when: (step, h) => h.route` compiled and reads `undefined`
 * now. Reported for a top-level key of the bag parameter's object pattern (`(s, { route })`), or
 * a member read off a plain parameter (`(s, h) => h.route`), that names a key of the host's
 * `initialState` and no prop the host takes. `state`, `context` and `uid` are the bag's own.
 *
 * Covered: wizard `steps.*.{ when, valid, label, visit, dirty, discard, dialog }`, `draft`, `key`,
 * `dirty`, `discard`, `resetTo`, `dialog`, `groups.*.label`, `url.from`; form `values`, `dynamic`,
 * `request` (options given as an object literal or a const bound to one).
 *
 * --fix: `h.route` → `h.state.route`; `(s, { route })` → `(s, { state: { route } })` (no rest
 * element, no `state` entry and no type annotation on the pattern).
 */
import { walk, unwrap, propName, memberName, stringValue, isFunction } from '../ast.js'
import { BAG_KEYS } from '../model/context.js'
import { analyzeUses } from '../model/behaviors.js'
import { resolveExpr } from '../model/resolve.js'
import { renderedUsages } from '../model/usages.js'

// the bag's index among each function's parameters
const WIZARD = { draft: 1, key: 1, dirty: 2, discard: 1, resetTo: 1, dialog: 1 }
const STEP = { when: 1, valid: 1, label: 1, visit: 1, dirty: 2, discard: 1, dialog: 1 }
const FORM = { values: 1, dynamic: 1, request: 2 }

/** The props a host takes, as far as the checker sees: its view's pattern and its usages' attributes. */
function propsOf(project, comp) {
  const out = new Set()
  let p = comp.view?.params?.[0]
  if (p?.type === 'AssignmentPattern') p = p.left
  if (p?.type === 'ObjectPattern') for (const q of p.properties) { const k = q.type === 'ObjectProperty' ? propName(q) : null; if (k) out.add(k) }
  if (comp.view) {
    for (const { usage } of renderedUsages(project)) {
      if (usage.ref?.node !== comp.view || usage.node?.type !== 'JSXOpeningElement') continue
      for (const a of usage.node.attributes) if (a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier') out.add(a.name.name)
    }
  }
  return out
}

/** The object literal an option node is (or a const bound to one), with its file. */
function objectOf(project, file, node) {
  const r = node && resolveExpr(project, file, node)
  return r?.node?.type === 'ObjectExpression' ? r : null
}

/** [path, fn node, bag index, file] for each covered function of a uses entry. */
function functionsOf(project, entry) {
  const out = []
  const fn = (path, node, file, at) => {
    const r = node && resolveExpr(project, file, node)
    if (r && isFunction(r.node)) out.push([path, r.node, at, r.file])
  }
  const table = entry.def.name === 'wizard' ? WIZARD : FORM
  for (const [k, at] of Object.entries(table)) { const o = entry.options.get(k); if (o) fn(k, o.node, o.file, at) }
  if (entry.def.name !== 'wizard') return out
  const steps = entry.options.get('steps'), sObj = steps && objectOf(project, steps.file, steps.node)
  for (const p of sObj?.node.properties || []) {
    const name = p.type === 'ObjectProperty' ? propName(p) : null, step = name && objectOf(project, sObj.file, p.value)
    for (const q of step?.node.properties || []) {
      const k = q.type === 'ObjectProperty' ? propName(q) : null
      if (k in STEP) fn(`steps.${name}.${k}`, q.value, step.file, STEP[k])
    }
  }
  const groups = entry.options.get('groups'), gObj = groups && objectOf(project, groups.file, groups.node)
  for (const p of gObj?.node.properties || []) {
    const name = p.type === 'ObjectProperty' ? propName(p) : null, g = name && objectOf(project, gObj.file, p.value)
    const label = g?.node.properties.find(q => q.type === 'ObjectProperty' && propName(q) === 'label')
    if (label) fn(`groups.${name}.label`, label.value, g.file, 1)
  }
  const url = entry.options.get('url'), uObj = url && objectOf(project, url.file, url.node)
  const from = uObj?.node.properties.find(q => q.type === 'ObjectProperty' && propName(q) === 'from')
  if (from) fn('url.from', from.value, uObj.file, 1)
  return out
}

export default {
  id: 'behavior-bag-state',
  codes: ['SYG459'],
  description: 'Behavior option reads a host-state field off its bag',
  run(project, report) {
    for (const comp of project.components) {
      const uses = analyzeUses(project, comp)
      if (!uses?.entries.length || !comp.initialState?.keys?.size) continue
      const stateKeys = comp.initialState.keys
      let props = null
      for (const entry of uses.entries) {
        const kind = entry.def?.name
        if (kind !== 'wizard' && kind !== 'form') continue
        for (const [path, fn, at, file] of functionsOf(project, entry)) {
          let param = fn.params?.[at]
          if (param?.type === 'AssignmentPattern') param = param.left
          if (!param) continue
          props ??= propsOf(project, comp)
          const bad = (k) => k && !BAG_KEYS.has(k) && stateKeys.has(k) && !props.has(k)
          const where = `${comp.name}'s ${kind} option ${path}`
          const say = (k) => `${where} reads '${k}' off its bag (7.2: { ...props, state, context, uid }), which has no such prop, so it is undefined; ${comp.name}'s state has a '${k}' (before 7.2 the wizard's second argument was the host state)`
          if (param.type === 'ObjectPattern') {
            const hits = param.properties.filter(p => p.type === 'ObjectProperty' && !(p.computed && !stringValue(p.key)) && bad(propName(p)))
            if (!hits.length) continue
            const keys = hits.map(propName), src = file.source
            const fixable = !param.typeAnnotation && hits.length === param.properties.length
              && !param.properties.some(p => p.type === 'RestElement' || (p.type === 'ObjectProperty' && propName(p) === 'state'))
            const text = `{ state: { ${hits.map(h => src.slice(h.start, h.end)).join(', ')} } }`
            report({
              code: 'SYG459', component: comp.name, file, node: hits[0].key, endNode: hits[hits.length - 1],
              message: say(keys[0]) + (keys.length > 1 ? ` (also ${keys.slice(1).map(k => `'${k}'`).join(', ')})` : ''),
              fix: `read the host's state: (…, { state: { ${keys.join(', ')} } }) => …`,
              data: { option: path, keys },
              fixes: fixable ? [{ title: `Read ${keys.join(', ')} from the bag's state`, kind: 'quickfix', preferred: true, fixAll: true, edits: [{ file: file.path, start: param.start, end: param.end, text }] }] : undefined,
            })
            continue
          }
          if (param.type !== 'Identifier') continue
          const name = param.name
          walk(fn.body, (n) => {
            if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && unwrap(n.object)?.type === 'Identifier' && unwrap(n.object).name === name && !n.computed) {
              const k = memberName(n)
              if (bad(k)) {
                report({
                  code: 'SYG459', component: comp.name, file, node: n.property,
                  message: say(k),
                  fix: `read the host's state: ${name}.state.${k}`,
                  data: { option: path, keys: [k] },
                  fixes: [{ title: `Read ${k} from ${name}.state`, kind: 'quickfix', preferred: true, fixAll: true, edits: [{ file: file.path, start: n.property.start, end: n.property.start, text: 'state.' }] }],
                })
              }
            }
            return true
          })
        }
      }
    }
  },
}
