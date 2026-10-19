import {walk, unwrap} from '../ast.js'
import {findBinding} from '../scope.js'
import {resolveExpr} from '../model/resolve.js'

function imported(file, callee) {
  callee = unwrap(callee)
  if (callee?.type !== 'Identifier') return null
  const b = findBinding(file, callee.name, callee)
  return b?.kind === 'import' && /^sygnal(\/|$)/.test(b.source) ? b.imported : null
}
const literal = n => n && (n.type.endsWith('Literal') || n.type === 'UnaryExpression')
// Sygnal 7 remounts a component whose known state path or byId target changes, so this is
// legacy advice: report only when the installed Sygnal is known to be 6. An unknown version
// (Yarn PnP, no node_modules, git-tree checks) is no evidence of the old binding contract.
export default {
  id: 'byid-binding',
  codes: ['SYG454'],
  description: 'An unkeyed changing byId selection on Sygnal 6',
  run(project, report) {
    for (const p of project.scanned) {
      const file = project.files.get(p)
      if (!file?.ast || project.sygnalFor(file).major !== 6) continue
      walk(file.ast.program, n => {
        if (n.type !== 'JSXOpeningElement' || n.name?.type !== 'JSXIdentifier' || !/^[A-Z]/.test(n.name.name)) return true
        if (n.attributes.some(a => a.type === 'JSXSpreadAttribute' || a.name?.name === 'key')) return true
        const state = n.attributes.find(a => a.name?.name === 'state')?.value?.expression
        if (state?.type !== 'CallExpression' || imported(file, state.callee) !== 'byId') return true
        const id = state.arguments[1], resolved = resolveExpr(project, file, id)?.node
        if (!id || literal(resolved)) return true
        report({code:'SYG454', component:n.name.name, file, node:state,
          message:'This dynamic byId selection may change while the component retains its mount-time binding (Sygnal 6)',
          fix:'Give the component a key tied to the selected record ID; a new key also disposes its old requests and subscriptions'})
        return true
      })
    }
  },
}
