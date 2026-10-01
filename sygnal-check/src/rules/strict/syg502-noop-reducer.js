/**
 * SYG502 (C3): a STATE reducer says "no change" with `return ABORT`, not by
 * returning the unchanged state or undefined.
 *
 * Static heuristics (a STATE reducer = plain-function model entry, a `STATE`
 * sink in the object form, or an 'X | STATE' shorthand):
 *   - `return state` / `cond ? next : state` where `state` is the first param
 *   - a bare `return;`
 *   - a block body that can reach its end without returning
 * An explicit `undefined` (`() => undefined`, `return undefined`) is NOT
 * flagged: it is how a Collection item removes itself.
 */
import { stateReducers, ownReturns, leaves, paramName, completes, text } from './shared.js'

/** `source` of `node` with `leaf` replaced by ABORT (single line, short), or null. */
function withAbort(file, node, leaf, prefix = '') {
  const s = text(file, node)
  const out = prefix + s.slice(0, leaf.start - node.start) + 'ABORT' + s.slice(leaf.end - node.start)
  return out.length <= 90 && !out.includes('\n') ? out : null
}

export default {
  id: 'strict-noop-reducer',
  codes: ['SYG502'],
  description: 'STATE reducer signals no change without ABORT',
  strict: true,
  run(project, report) {
    for (const comp of project.components) {
      for (const { action, fn: { file, node: fn } } of stateReducers(project, comp)) {
        const stateName = paramName(fn, 0)
        const hit = (node, message, fix) => report({ code: 'SYG502', component: comp.name, file, node, message, fix, data: { action } })
        const REMOVE = 'or `return undefined` explicitly if this removes a Collection item'
        const checkLeaf = (e, holder, prefix) => {
          if (!stateName || e.type !== 'Identifier' || e.name !== stateName) return
          const rewrite = withAbort(file, holder, e, prefix)
          hit(e, `the STATE reducer for '${action}' returns the unchanged \`${stateName}\` for "no change"`,
            rewrite ? `return ABORT instead: \`${rewrite}\`` : `return ABORT instead of \`${stateName}\``)
        }

        if (fn.body.type !== 'BlockStatement') {
          const params = fn.params.map(p => text(file, p)).join(', ')
          leaves(fn.body).forEach(e => checkLeaf(e, fn.body, `${action}: (${params}) => `))
          continue
        }
        const returns = ownReturns(fn)
        for (const r of returns) {
          if (!r.argument) {
            hit(r, `a bare \`return\` in the STATE reducer for '${action}' returns undefined`,
              `use \`return ABORT\` for "no change" (${REMOVE})`)
          } else {
            leaves(r.argument).forEach(e => checkLeaf(e, r))
          }
        }
        if (completes(fn.body.body)) {
          const end = { loc: { start: { line: fn.body.loc.end.line, column: fn.body.loc.end.column - 1 } } }
          if (returns.length === 0) {
            hit(end, `the STATE reducer for '${action}' never returns a value (undefined)`,
              `return the new state (\`({ ...${stateName || 'state'}, … })\`) or ABORT; if it only runs side effects, use \`${action}: { EFFECT: (state, data, next) => { … } }\``)
          } else {
            hit(end, `the STATE reducer for '${action}' can reach its end without returning (undefined)`,
              `end every path with a return: the new state, or \`return ABORT\` for "no change" (${REMOVE})`)
          }
        }
      }
    }
  },
}
