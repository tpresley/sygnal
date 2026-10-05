/**
 * SYG501 (C1): a view must destructure its first argument
 *   function Lane({ state, context, ...props })
 * instead of using the positional (props, state, context, peers) arguments.
 *
 * Checks every component view and every function rendered as a JSX
 * component tag (or Collection/Switchable `of`) from one.
 */
import { propName } from '../../ast.js'
import { text } from './shared.js'

const POSITIONAL = ['state', 'context', 'peers']

/** Component functions reachable from the discovered components: Array<{ name, file, node }> */
export function viewFunctions(project) {
  const seen = new Set()
  const out = []
  const visitSink = (sink) => {
    for (const u of sink?.children || []) {
      visit(u.name, u.ref)
      visitSink(u.injected)
    }
  }
  const visit = (name, ref) => {
    if (!ref || seen.has(ref.node)) return
    seen.add(ref.node)
    out.push({ name, file: ref.file, node: ref.node })
    visitSink(project.viewOf(ref))
  }
  for (const c of project.components) if (c.view) visit(c.name, { file: c.file, node: c.view })
  return out
}

export function canonicalParams(file, fn) {
  const [p1, ...rest] = fn.params
  const parts = []
  const names = new Set()
  let restPart = null
  const first = p1?.type === 'AssignmentPattern' ? p1.left : p1
  if (first?.type === 'ObjectPattern') {
    for (const prop of first.properties) {
      if (prop.type === 'RestElement') { restPart = text(file, prop); continue }
      parts.push(text(file, prop))
      const k = propName(prop)
      if (k) names.add(k)
    }
  } else if (first?.type === 'Identifier' && !first.name.startsWith('_')) {
    restPart = `...${first.name}`
  }
  POSITIONAL.forEach((key, i) => {
    const p = rest[i]
    if (!p || names.has(key) || p.type === 'RestElement') return
    if (p.type === 'Identifier') parts.push(p.name === key ? key : `${key}: ${p.name}`)
    else if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier' && p.left.name === key) parts.push(`${key} = ${text(file, p.right)}`)
    else parts.push(`${key}: ${text(file, p)}`)
  })
  if (restPart) parts.push(restPart)
  return `{ ${parts.join(', ')} }`
}

function signature(name, fn, params) {
  if (fn.type === 'ArrowFunctionExpression') return `const ${name} = (${params}) => …`
  return `function ${name}(${params})`
}

export default {
  id: 'strict-positional-view',
  codes: ['SYG501'],
  description: 'View uses positional (props, state, context) arguments',
  strict: true,
  run(project, report) {
    for (const v of viewFunctions(project)) {
      const fn = v.node
      if (!fn.params || fn.params.length < 2) continue
      const used = POSITIONAL.slice(0, fn.params.length - 1)
      report({
        code: 'SYG501',
        component: v.name,
        file: v.file,
        node: fn.params[1],
        message: `the view uses positional arguments (props, ${used.join(', ')}), which Sygnal 6.0 removed: a view gets one argument`,
        fix: `destructure the first argument: \`${signature(v.name, fn, canonicalParams(v.file, fn))}\``,
        data: { params: fn.params.length },
      })
    }
  },
}
