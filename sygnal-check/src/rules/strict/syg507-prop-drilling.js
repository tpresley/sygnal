/**
 * SYG507 (C10, info): top-down data that crosses more than 2 component
 * levels belongs in `.context`, not in props passed through every level.
 *
 * Flags a component X that receives prop `p` from its parent P and passes it
 * on unchanged, under the same name, to its own child component Y
 * (P → X → Y = 3 levels). Reported at X's forwarding attribute.
 */
import { walk, unwrap, propName, memberName, jsxName, jsxAttrExpr } from '../../ast.js'
import { viewFunctions } from './syg501-positional-view.js'

const RESERVED = new Set([
  'state', 'children', 'slots', 'context', 'peers', 'key', 'className', 'class', 'id', 'style',
  'props', 'attrs', 'on', 'hook', 'ref', 'dataset', 'of', 'from', 'current', 'sygnalFactory', 'sygnalOptions',
])
const NOT_COMPONENT = new Set(['Fragment', 'Portal', 'Transition', 'Suspense', 'ClientOnly', 'Slot', 'Collection', 'Switchable'])
const isComponentTag = (name) => !!name && /^[A-Z]/.test(name) && !NOT_COMPONENT.has(name.split('.')[0])

/** How `fn` refers to its prop `p`: { local?: string, propsParam?: string } or null. */
function propRef(fn, p) {
  let first = fn.params?.[0]
  if (first?.type === 'AssignmentPattern') first = first.left
  if (first?.type === 'Identifier') return { propsParam: first.name }
  if (first?.type !== 'ObjectPattern') return null
  for (const prop of first.properties) {
    if (prop.type === 'RestElement') {
      if (prop.argument.type === 'Identifier') return { propsParam: prop.argument.name }
      continue
    }
    if (propName(prop) !== p) continue
    let v = prop.value
    if (v.type === 'AssignmentPattern') v = v.left
    return v.type === 'Identifier' ? { local: v.name } : null
  }
  return null
}

/** Child component attributes in fn's JSX that pass prop `p` on unchanged. */
function forwardsOf(fn, p) {
  const ref = propRef(fn, p)
  if (!ref) return []
  const out = []
  walk(fn.body, (n) => {
    if (n.type !== 'JSXOpeningElement') return true
    const tag = jsxName(n.name)
    if (!isComponentTag(tag)) return true
    for (const a of n.attributes) {
      if (a.type !== 'JSXAttribute' || jsxName(a.name) !== p) continue
      const v = unwrap(jsxAttrExpr(a))
      const same = (ref.local && v?.type === 'Identifier' && v.name === ref.local) ||
        (ref.propsParam && v?.type === 'MemberExpression' && unwrap(v.object).type === 'Identifier' &&
          unwrap(v.object).name === ref.propsParam && memberName(v) === p)
      if (same) out.push({ attr: a, child: tag })
    }
    return true
  })
  return out
}

export default {
  id: 'strict-prop-drilling',
  codes: ['SYG507'],
  description: 'Prop drilled through more than 2 component levels',
  strict: true,
  run(project, report) {
    const reported = new Set()
    for (const parent of viewFunctions(project)) {
      const sink = project.viewOf(parent)
      for (const u of sink?.children || []) {
        if (u.kind !== 'tag' || !u.ref) continue
        for (const a of u.node.attributes) {
          if (a.type !== 'JSXAttribute') continue
          const p = jsxName(a.name)
          if (!p || RESERVED.has(p) || p.includes(':') || p.includes('-')) continue
          for (const f of forwardsOf(u.ref.node, p)) {
            if (reported.has(f.attr)) continue
            reported.add(f.attr)
            report({
              code: 'SYG507',
              component: u.name,
              file: u.ref.file,
              node: f.attr,
              message: `prop '${p}' is passed down through 3 component levels (<${parent.name}> → <${u.name}> → <${f.child}>)`,
              fix: `provide it as context instead: \`${parent.name}.context = { ${p}: state => state.${p} }\`, and read \`context.${p}\` in <${f.child}>`,
              data: { prop: p, path: [parent.name, u.name, f.child] },
            })
          }
        }
      }
    }
  },
}
