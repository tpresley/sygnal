// placeholder: worker A owns this file (PLAN-9 K-3: fromTree, toTree, removeNode, finish, keys).
// Worker C (p9-llm) needs `fromTree` and `finish` to compile and test `llm.ts`; this stand-in
// follows the phase-1 contract's key rules only as far as llm.ts's tests need them. The
// coordinator keeps A's file when merging.

const recordParam = (def: any) => Object.keys(def?.params || {}).find(k => typeof def.params[k]?.from == 'function')

/** contract Tree → Layout: identity keys (part, `part:record`, repeats `~2`; containers by id) */
export function fromTree(catalog: any, tree: any[], _previous?: any): any {
  const nodes: Record<string, any> = {}
  const seen: Record<string, number> = {}
  const keyOf = (n: any) => {
    const def = catalog.parts?.[n.part]
    const rp = def && recordParam(def)
    const base = rp && n.params?.[rp] !== undefined ? `${n.part}:${n.params[rp]}` : n.part
    const i = (seen[base] = (seen[base] || 0) + 1)
    return i == 1 ? base : `${base}~${i}`
  }
  const add = (n: any): string => {
    const key = keyOf(n)
    const def = catalog.parts?.[n.part] || catalog.containers?.[n.part]
    const node: any = {part: n.part}
    const params: any = {}
    for (const k in n.params || {}) if (n.params[k] !== def?.params?.[k]?.default) params[k] = n.params[k]
    if (Object.keys(params).length) node.params = params
    nodes[key] = node
    if (n.children) {
      const slots = Array.isArray(n.children) ? {default: n.children} : n.children
      node.slots = Object.fromEntries(Object.entries(slots).map(([s, kids]: any) => [s, kids.map(add)]))
    }
    return key
  }
  nodes.page = {part: 'page', slots: {default: []}}
  nodes.page.slots.default = (tree || []).map(add)
  return {root: 'page', nodes}
}

/** the finishing step (stand-in): a single-part row unwrapped, empty containers removed */
export function finish(_catalog: any, layout: any, _state?: any): any {
  const nodes = {...layout.nodes}
  const fix = (key: string): string[] => {
    const n = nodes[key]
    if (!n?.slots) return [key]
    const slots = Object.fromEntries(Object.entries(n.slots).map(([s, ks]: any) => [s, ks.flatMap(fix)]))
    const all = Object.values(slots).flat() as string[]
    if (key != layout.root && all.length == 0) { delete nodes[key]; return [] }
    if (key != layout.root && n.part == 'row' && all.length == 1) { delete nodes[key]; return all }
    nodes[key] = {...n, slots}
    return [key]
  }
  fix(layout.root)
  return {root: layout.root, nodes}
}
