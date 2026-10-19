/*
 * PLAN-9 (D463): byId(field, id, idKey = 'id'), a { get, set } lens to the element of the array
 * `state[field]` whose `idKey` is `id`: a record part's state (`state: (node) => byId('projects',
 * node.params.id)`), or any child's `state={byId('todos', 3)}`. get: the element (undefined when it
 * is gone); set: the array with that element replaced (the state unchanged when it is gone).
 * Side-effect free.
 */
import {BINDING} from '../shared'
export const byId = (field: string, id: any, idKey = 'id') => Object.defineProperty({
  get: (s: any) => (Array.isArray(s?.[field]) ? s[field].find((x: any) => x?.[idKey] === id) : undefined),
  set: (s: any, v: any) => {
    const a = s?.[field]
    if (!Array.isArray(a) || !a.some((x: any) => x?.[idKey] === id)) return s
    return {...s, [field]: a.map((x: any) => (x?.[idKey] === id ? v : x))}
  },
}, BINDING, {value: [field, id, idKey]})
