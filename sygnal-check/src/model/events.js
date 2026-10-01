/**
 * File-wide EVENTS scan:
 *   selected: EVENTS.select('X')  (EVENTS, an alias from `{ EVENTS: ev }`, or sources.EVENTS)
 *   emitted:  emit('X', …) / event('X', …) imported from sygnal
 * (`{ type: 'X' }` returned from model EVENTS sinks is collected per model.)
 */
import { walk, unwrap, memberName, stringValue, propName } from '../ast.js'
import { findBinding } from '../scope.js'

const EMIT_HELPERS = new Set(['emit', 'event'])
const isSygnalModule = (src) => /^sygnal(\/|$)/.test(src)

export function scanFileEvents(file) {
  const res = { selected: [], emitted: [], dynamicSelected: [], dynamicEmitted: [] }
  // Local names bound to the EVENTS source anywhere in the file ({ EVENTS: ev })
  const aliases = new Set(['EVENTS'])
  walk(file.ast.program, (n) => {
    if (n.type === 'ObjectPattern') {
      for (const p of n.properties) {
        if (p.type === 'ObjectProperty' && propName(p) === 'EVENTS') {
          const v = p.value.type === 'AssignmentPattern' ? p.value.left : p.value
          if (v.type === 'Identifier') aliases.add(v.name)
        }
      }
    }
    return true
  })

  walk(file.ast.program, (n) => {
    if (n.type !== 'CallExpression') return true
    const callee = unwrap(n.callee)
    if (callee.type === 'MemberExpression' && memberName(callee) === 'select') {
      const obj = unwrap(callee.object)
      const isEvents = (obj.type === 'Identifier' && aliases.has(obj.name)) ||
        (obj.type === 'MemberExpression' && memberName(obj) === 'EVENTS')
      if (isEvents && n.arguments.length) {
        const s = stringValue(n.arguments[0])
        if (s != null) res.selected.push({ type: s, node: n.arguments[0], file })
        else res.dynamicSelected.push({ node: n, file })
      }
    } else if (callee.type === 'Identifier' && EMIT_HELPERS.has(callee.name)) {
      const b = findBinding(file, callee.name, n)
      if (b && b.kind === 'import' && isSygnalModule(b.source) && EMIT_HELPERS.has(b.imported)) {
        const s = n.arguments.length ? stringValue(n.arguments[0]) : null
        if (s != null) res.emitted.push({ type: s, node: n.arguments[0], file })
        else res.dynamicEmitted.push({ node: n, file })
      }
    }
    return true
  })
  return res
}
