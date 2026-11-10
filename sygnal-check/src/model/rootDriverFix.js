/**
 * The mechanical fix for a driver no run() call registers (SYG643, SYG609): write it on the root,
 * `App.drivers = { HTTP: makeFetchDriver() }`, and import the factory. Only for a factory that
 * needs no options, one app, a root known to the checker, and statics assigned at the top level.
 * An existing object-literal `drivers` static gains the property. null when it isn't mechanical.
 */
import { unwrap } from '../ast.js'
import { ensureImport } from '../rules/syg426-lowercase-markers.js'

export function rootDriverFix(app, key, factory, rendering) {
  const root = app.root
  if (!root || rendering.length !== 1) return null
  const file = root.file
  const at = root.view || root.node
  const imp = ensureImport(file, factory, 'sygnal', at)
  if (!imp) return null
  const value = `${key}: ${factory}()`
  const edit = (start, text) => ({ file: file.path, start, end: start, text })
  let insert
  const own = root.staticProps.drivers && unwrap(root.staticProps.drivers)
  if (own) {
    if (own.type !== 'ObjectExpression') return null
    const last = own.properties.at(-1)
    insert = last ? edit(last.end, `, ${value}`) : edit(own.start + 1, ` ${value} `)
  } else {
    const nodes = Object.values(root.staticPropNodes || {})
    if (!nodes.length || !nodes.every(n => n.type === 'MemberExpression')) return null
    const statements = nodes.map(n => file.ast.program.body.find(s => s.start <= n.start && n.end <= s.end))
    if (statements.some(s => s?.type !== 'ExpressionStatement')) return null
    insert = edit(Math.max(...statements.map(s => s.end)), `\n\n${root.name}.drivers = { ${value} }`)
  }
  return [{ title: `Name ${factory}() on ${root.name}`, kind: 'quickfix', preferred: true, fixAll: true, edits: [insert, ...imp] }]
}
