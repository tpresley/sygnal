/**
 * SYG259 (warn, 7.3, Sift's live-writes walk): an action's STATE reducer sets a top-level field to
 * an empty literal ('', ``, null, undefined, false, [] or {}) and another handler of the same entry
 * (EFFECT, PARENT, HTTP, EVENTS, ELEMENT, a driver) reads that field from its state argument. Since
 * 7.0 the outputs run after STATE with the committed state, so the handler reads the cleared value:
 *
 *   KEY: { STATE: (s) => ({ ...s, text: '' }), PARENT: (s) => s.text }        // always ''
 *   KEY: { STATE: (s) => ({ ...s, text: '' }), PARENT: (s, d, n, { previousState }) => previousState.text }
 *
 * Narrow on purpose (the maintainer's decision): reading a field STATE set to a computed value is
 * usually what the output means (it sends the new state), and the opt-in runtime audit SYG257 covers
 * that broader case. Only the object literals the reducer returns (its body, its `return`s, both
 * branches of a conditional) and reads of `<state param>.<field>` / a destructured first parameter
 * count. A field cleared on some paths only (`if (enter) return { ...s, text: '' }`) is reported too:
 * on that path the output reads the cleared value. A read compared with that same empty value
 * anywhere in the handler (`s.edge !== null && …s.edge…`) asks for the committed state on purpose
 * when STATE clears it on some paths only: not reported for that handler. Cleared on every path,
 * the comparison is the bug itself (`state.draft === null` is always true) and is reported.
 */
import { walk, unwrap, isFunction, propName, stringValue } from '../ast.js'
import { findBinding } from '../scope.js'
import { modelHandlers } from '../model/clockReads.js'

/** an empty literal: its text for the message, or null */
function emptyText(file, node) {
  const n = unwrap(node)
  if (!n) return null
  if (n.type === 'StringLiteral' && n.value === '') return "''"
  if (n.type === 'TemplateLiteral' && !n.expressions.length && n.quasis.every(q => q.value.cooked === '')) return "''"
  if (n.type === 'NullLiteral') return 'null'
  if (n.type === 'BooleanLiteral' && !n.value) return 'false'
  if (n.type === 'Identifier' && n.name === 'undefined' && !findBinding(file, 'undefined', n)) return 'undefined'
  if (n.type === 'UnaryExpression' && n.operator === 'void') return 'undefined'
  if (n.type === 'ArrayExpression' && !n.elements.length) return '[]'
  if (n.type === 'ObjectExpression' && !n.properties.length) return '{}'
  return null
}

/** the values a reducer can return: an arrow's expression body, its `return`s (not in nested
 * functions), and both branches of a conditional or a logical expression */
function returnedValues(fn) {
  const out = []
  const add = (v) => {
    const n = unwrap(v)
    if (n?.type === 'ConditionalExpression') { add(n.consequent); add(n.alternate) }
    else if (n?.type === 'LogicalExpression') { add(n.left); add(n.right) }
    else if (n) out.push(n)
  }
  if (fn.body.type !== 'BlockStatement') add(fn.body)
  else walk(fn.body, (n) => {
    if (n !== fn.body && isFunction(n)) return false
    if (n.type === 'ReturnStatement' && n.argument) add(n.argument)
  })
  return out
}

/** field -> { value: the empty literal STATE sets it to, always: on every path the reducer returns by } */
function clearedFields(file, fn) {
  const values = returnedValues(fn), objs = values.filter(v => v.type === 'ObjectExpression')
  const out = new Map()
  for (const o of objs) {
    for (const p of o.properties) {
      if (p.type !== 'ObjectProperty' || p.computed && !stringValue(p.key)) continue
      const name = propName(p)
      const text = name && emptyText(file, p.value)
      if (text && !out.has(name)) out.set(name, { value: text, always: true })
    }
  }
  for (const [name, c] of out) c.always = values.every(o => o.type === 'ObjectExpression' && o.properties.some(p => p.type === 'ObjectProperty' && propName(p) === name && emptyText(file, p.value)))
  return out
}

/** the handler's reads of state fields: [{ field, node }] (`state.x`, `state['x']`, `({ x })`) */
function stateReads(file, fn) {
  const p = fn.params[0]
  const out = []
  if (!p) return out
  const param = p.type === 'AssignmentPattern' ? p.left : p
  if (param.type === 'ObjectPattern') {
    for (const prop of param.properties) if (prop.type === 'ObjectProperty') {
      const name = propName(prop)
      if (name) out.push({ field: name, node: prop.key })
    }
    return out
  }
  if (param.type !== 'Identifier') return out
  walk(fn.body, (n) => {
    if ((n.type !== 'MemberExpression' && n.type !== 'OptionalMemberExpression')) return
    const obj = unwrap(n.object)
    if (obj?.type !== 'Identifier' || obj.name !== param.name) return
    const b = findBinding(file, obj.name, obj)
    if (!b || b.kind !== 'param' || b.node !== fn) return
    const field = n.computed ? stringValue(n.property) : n.property.type === 'Identifier' && n.property.name
    if (field) out.push({ field, node: n })
  })
  return out
}

const EQ = new Set(['===', '!==', '==', '!='])
/** the read is compared with the same empty value (`s.edge !== null`): it asks for the committed one */
function comparedWith(file, node, value) {
  const p = file.parents.get(node)
  if (p?.type !== 'BinaryExpression' || !EQ.has(p.operator)) return false
  return emptyText(file, p.left === node ? p.right : p.left) === value
}

export default {
  id: 'output-reads-cleared',
  codes: ['SYG259'],
  description: "An output reads a field its action's STATE cleared",
  perFile: true,
  run(project, report) {
    for (const comp of project.components) {
      const byAction = new Map()
      for (const h of modelHandlers(project, comp)) {
        if (!isFunction(h.fn.node)) continue
        if (!byAction.has(h.action)) byAction.set(h.action, [])
        byAction.get(h.action).push(h)
      }
      for (const [action, hs] of byAction) {
        const reducer = hs.find(h => h.sink === 'STATE')
        if (!reducer) continue
        const cleared = clearedFields(reducer.fn.file, reducer.fn.node)
        if (!cleared.size) continue
        for (const h of hs) {
          if (h === reducer) continue
          const reads = stateReads(h.fn.file, h.fn.node)
          // a field STATE clears on some paths only, which the handler compares with that empty value
          // somewhere, is one it means to read (`s.edge !== null`); cleared on every path, the
          // comparison is the bug (`state.draft === null` is always true)
          const seen = new Set(reads.filter(r => cleared.has(r.field) && !cleared.get(r.field).always && comparedWith(h.fn.file, r.node, cleared.get(r.field).value)).map(r => r.field))
          for (const r of reads) {
            const c = cleared.get(r.field)
            if (!c || seen.has(r.field)) continue
            const value = c.value
            seen.add(r.field)
            report({
              code: 'SYG259',
              file: h.fn.file,
              node: r.node,
              component: comp.name,
              message: `The ${h.sink} handler of '${action}' reads \`${r.field}\` from its state, which the same action's STATE sets to ${value}: outputs run after STATE (7.0), so it ${c.always ? 'always reads' : 'then reads'} ${value}`,
              fix: `read the value from before the action: \`${h.sink}: (state, data, next, { previousState }) => … previousState.${r.field} …\` (or pass it in the action's data)`,
              data: { action, sink: h.sink, field: r.field, value, always: c.always },
            })
          }
        }
      }
    }
  },
}
