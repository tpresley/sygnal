/**
 * SYG503 (C4, heuristic): side effects go in an EFFECT sink,
 *   ACTION: { EFFECT: (state, data, next) => { ... } }
 * not in a STATE reducer that runs them and then returns ABORT.
 *
 * Flags a STATE reducer with a call statement whose result is unused
 * (`cmd.send('play')`, `next('X')`, `localStorage.setItem(...)`) on the path
 * to a `return ABORT` (earlier in the same block or an enclosing block).
 */
import { unwrap, isFunction } from '../../ast.js'
import { stateReducers, ownReturns, leaves, isAbort, returnLeaves, shortText } from './shared.js'

function isCallStatement(s) {
  if (s.type !== 'ExpressionStatement') return false
  let e = unwrap(s.expression)
  if (e.type === 'AwaitExpression') e = unwrap(e.argument)
  if (e.type === 'ChainExpression') e = unwrap(e.expression)
  return e.type === 'CallExpression' || e.type === 'OptionalCallExpression' || e.type === 'NewExpression'
}

/** Call statements that run before `ret` on its path from the function body. */
function callsBefore(file, fn, ret) {
  const out = []
  let child = ret
  let n = file.parents.get(ret)
  while (n && n !== fn) {
    if (isFunction(n)) return out
    const body = n.type === 'BlockStatement' ? n.body : n.type === 'SwitchCase' ? n.consequent : null
    if (body) {
      for (const s of body) {
        if (s === child) break
        if (isCallStatement(s)) out.push(s)
      }
    }
    child = n
    n = file.parents.get(n)
  }
  return out
}

export default {
  id: 'strict-effect-in-state',
  codes: ['SYG503'],
  description: 'Side effect in a STATE reducer that returns ABORT',
  strict: true,
  run(project, report) {
    for (const comp of project.components) {
      for (const { action, fn: { file, node: fn } } of stateReducers(project, comp)) {
        if (fn.body.type !== 'BlockStatement') continue
        const aborts = ownReturns(fn).filter(r => r.argument && leaves(r.argument).some(isAbort))
        if (!aborts.length) continue
        const calls = new Set()
        for (const r of aborts) callsBefore(file, fn, r).forEach(c => calls.add(c))
        if (!calls.size) continue
        const first = [...calls].sort((a, b) => a.start - b.start)[0]
        const onlyAbort = returnLeaves(fn).every(isAbort)
        const call = shortText(file, first.expression, 50, '…')
        report({
          code: 'SYG503',
          component: comp.name,
          file,
          node: first,
          message: `the STATE reducer for '${action}' runs a side effect (\`${call}\`) and returns ABORT`,
          fix: onlyAbort
            ? `move it to an EFFECT sink: \`${action}: { EFFECT: (state, data, next) => { ${call} } }\` (no return value needed)`
            : `keep the state change in STATE and move the side effect to EFFECT: \`${action}: { STATE: (state, data) => …, EFFECT: (state, data, next) => { ${call} } }\``,
          data: { action },
        })
      }
    }
  },
}
