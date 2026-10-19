import {walk, unwrap, propName} from '../ast.js'
import {findBinding} from '../scope.js'
import {resolveExpr} from '../model/resolve.js'

function imported(file, callee) {
  callee = unwrap(callee)
  if (callee?.type !== 'Identifier') return null
  const b = findBinding(file, callee.name, callee)
  return b?.kind === 'import' && /^sygnal(\/|$)/.test(b.source) ? b.imported : null
}
const literal = n => n && (n.type.endsWith('Literal') || n.type === 'UnaryExpression')
export default {
  id: 'sink-timing-and-bindings',
  codes: ['SYG255', 'SYG454'],
  description: 'Snapshot contracts and an unkeyed changing byId selection',
  run(project, report) {
    const checked = new Set()
    const timing = (file, node, component = 'module') => {
      if (!node || checked.has(node)) return
      checked.add(node)
      const version = project.sygnalFor(file)
      if (version.sinkState === false) {
        report({code:'SYG255', component, file, node,
          message:`sinkState requires Sygnal 7; this file uses installed Sygnal ${version.version}`,
          fix:'Remove sinkState to retain the existing pre-update snapshot, or upgrade Sygnal to 7 and review non-state reducers for the new after default'})
        return
      }
      const r = resolveExpr(project, file, node), value = r?.node
      if (!literal(value) || ['before', 'after'].includes(value.value)) return
      report({code:'SYG255', component, file, node,
        message: "sinkState must be 'before' or 'after'",
        fix: "Use 'after' for updated-state outputs, or 'before' for a legacy snapshot contract"})
    }
    for (const comp of project.components) timing(comp.file, comp.staticProps.sinkState, comp.name)
    for (const p of project.scanned) {
      const file = project.files.get(p)
      if (!file?.ast) continue
      walk(file.ast.program, n => {
        if (n.type === 'CallExpression') {
          const name = imported(file, n.callee)
          const index = {run:2, renderComponent:1, defineBehavior:0, defineComponent:0, defineElement:2}[name]
          if (index === undefined) return true
          const r = resolveExpr(project, file, n.arguments[index]), o = r?.node
          if (o?.type === 'ObjectExpression') for (const prop of o.properties) if (prop.type !== 'SpreadElement' && propName(prop) === 'sinkState') timing(r.file, prop.value)
        }
        if (n.type !== 'JSXOpeningElement' || n.name?.type !== 'JSXIdentifier' || !/^[A-Z]/.test(n.name.name)) return true
        if (n.attributes.some(a => a.type === 'JSXSpreadAttribute' || a.name?.name === 'key')) return true
        const state = n.attributes.find(a => a.name?.name === 'state')?.value?.expression
        if (state?.type !== 'CallExpression' || imported(file, state.callee) !== 'byId') return true
        const id = state.arguments[1], resolved = resolveExpr(project, file, id)?.node
        if (!id || literal(resolved)) return true
        const version = project.sygnalFor(file)
        if (version.major >= 7) return true
        report({code:'SYG454', component:n.name.name, file, node:state,
          message:version.major === null
            ? 'This dynamic byId selection retains its mount-time binding in Sygnal 6; the installed Sygnal version could not be determined'
            : 'This dynamic byId selection may change while the component retains its mount-time binding',
          fix:'Give the component a key tied to the selected record ID; a new key also disposes its old requests and subscriptions'})
        return true
      })
    }
  },
}
