/**
 * SYG401 (static): <Collection from="x"> where x is not a key of the
 * component's static initialState (or calculated fields), or where the
 * initial value is a literal that is clearly not an array.
 * Only checked when the component has a statically known initialState.
 *
 * A path (6.5.0: from="board.cards", "boards[0].cards") is followed through the literal
 * initialState: a missing key on the way is reported with the keys of that level; where a value
 * isn't an object or array literal (a variable, a call), the rest of the path can't be checked.
 */
import { unwrap, propName } from '../ast.js'

const NON_ARRAY = new Set(['ObjectExpression', 'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'TemplateLiteral'])
const segments = (from) => from.replace(/\[(\d+)\]/g, '.$1').split('.')

/** the value node at `segs` under an initialState value, { node } or { missing, keys } or null (can't tell) */
function follow(node, segs) {
  for (let i = 0; i < segs.length; i++) {
    node = unwrap(node)
    if (node?.type === 'ObjectExpression') {
      if (node.properties.some(p => p.type !== 'ObjectProperty')) return null // a spread: can't tell
      const p = node.properties.find(q => propName(q) === segs[i])
      if (!p) return { missing: segs.slice(0, i + 1).join('.'), keys: node.properties.map(q => propName(q)).filter(Boolean) }
      node = p.value
    } else if (node?.type === 'ArrayExpression' && /^\d+$/.test(segs[i])) {
      const el = node.elements[Number(segs[i])]
      if (!el || el.type === 'SpreadElement') return null
      node = el
    } else return null
  }
  return { node: unwrap(node) }
}

export default {
  id: 'collection-from',
  codes: ['SYG401'],
  description: "Collection 'from' field is missing or not an array",
  run(project, report) {
    for (const comp of project.components) {
      const view = comp.viewInfo
      const init = comp.initialState
      if (!view || !init || !init.known) continue
      for (const col of view.collections) {
        if (col.kind !== 'collection' || col.from == null) continue
        const field = col.from
        const at = { file: comp.file, node: col.fromNode || col.node }
        const [first, ...rest] = segments(field)
        if (comp.calculatedKeys.has(first)) continue
        if (rest.length) {
          if (!init.keys.has(first)) {
            const keys = [...init.keys.keys()]
            report({
              code: 'SYG401', component: comp.name, ...at,
              message: `<${col.tag} from="${field}"> but '${first}' is not a key of ${comp.name}.initialState` + (keys.length ? ` (keys: ${keys.join(', ')})` : ''),
              fix: `point 'from' at an existing array field, or add ${first} to ${comp.name}.initialState`,
              data: { from: field, keys },
            })
            continue
          }
          const r = follow(init.keys.get(first)?.node, rest)
          if (r?.missing) {
            report({
              code: 'SYG401', component: comp.name, ...at,
              message: `<${col.tag} from="${field}"> but ${comp.name}.initialState has no '${first}.${r.missing}'` + (r.keys.length ? ` (keys there: ${r.keys.join(', ')})` : ''),
              fix: `point 'from' at an existing array field, or add it to ${comp.name}.initialState`,
              data: { from: field, keys: r.keys },
            })
          } else if (r?.node && NON_ARRAY.has(r.node.type)) {
            report({
              code: 'SYG401', component: comp.name, ...at,
              message: `<${col.tag} from="${field}"> but ${comp.name}.initialState.${field} is not an array`,
              fix: `make ${field} an array in initialState`,
              data: { from: field },
            })
          }
          continue
        }
        if (!init.keys.has(field)) {
          const keys = [...init.keys.keys()]
          report({
            code: 'SYG401',
            component: comp.name,
            ...at,
            message: `<${col.tag} from="${field}"> but '${field}' is not a key of ${comp.name}.initialState` +
              (keys.length ? ` (keys: ${keys.join(', ')})` : ''),
            fix: `add ${field}: [] to ${comp.name}.initialState, or point 'from' at an existing array field`,
            data: { from: field, keys },
          })
          continue
        }
        const value = init.keys.get(field)?.node
        if (value && NON_ARRAY.has(value.type)) {
          report({
            code: 'SYG401',
            component: comp.name,
            ...at,
            message: `<${col.tag} from="${field}"> but ${comp.name}.initialState.${field} is not an array`,
            fix: `make ${field} an array in initialState`,
            data: { from: field },
          })
        }
      }
    }
  },
}
