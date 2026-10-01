/**
 * SYG401 (static): <Collection from="x"> where x is not a key of the
 * component's static initialState (or calculated fields), or where the
 * initial value is a literal that is clearly not an array.
 * Only checked when the component has a statically known initialState.
 */
const NON_ARRAY = new Set(['ObjectExpression', 'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'TemplateLiteral'])

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
        if (comp.calculatedKeys.has(field)) continue
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
