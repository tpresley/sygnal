// PROTOTYPE (would live in sygnal/ai): the catalog shared by every candidate API.
//
//   const catalog = defineCatalog({
//     parts: {
//       revenueChart: { component: RevenueChart, description: 'Line chart: revenue, last 12 months',
//         state: 'metrics',                                    // a key | a lens | (node) => key | lens
//         params: { range: { enum: ['month', 'quarter', 'year'], default: 'year', description: 'Time range' } } },
//       customer: { component: CustomerCard, description: 'One customer record',
//         params: { id: { from: (state) => state.customers.map((c) => ({ value: c.id, description: `Customer ${c.name}` })) } },
//         state: (node) => byId('customers', node.params.id) },  // a record part: one instance per record
//       note: { component: Note, description: 'A free note', local: { text: '' },   // local: state kept in the composition
//         params: { title: { type: 'string', maxLength: 40, description: 'A heading for the note' } } },  // free text: LLM only
//     },
//     containers: {
//       page: { render: ({ slots }) => <div className="page">{slots.default}</div> },
//       row:  { description: 'Parts side by side', render: ({ slots }) => <div className="row">{slots.default}</div> },
//       tabs: { description: 'Parts as tabs, one visible at a time', render: tabsView },
//     },
//   })
//
// Layout (state): { root: 'n0', nodes: { [key]: { part, params?, slots?: { default: [keys] } } } }.
// Render: catalog.render(slice, state) → vnodes for the host's own view. Containers are plain view
// functions called inline (NOT components), so every part is a child instance of the host: keyed
// by `id={nodeKey}`, it survives moves between containers and reorders, and the host hears it with
// CHILD.select(PartComponent).
import { ABORT } from 'sygnal'

// ------------------------------------------------------------------ lenses
/** a lens to the array element of `field` with `id` (a record part) */
export const byId = (field, id, idKey = 'id') => ({
  get: (s) => s?.[field]?.find((x) => x[idKey] === id),
  set: (s, v) => ({ ...s, [field]: s[field].map((x) => (x[idKey] === id ? v : x)) }),
})

// ------------------------------------------------------------------ catalog
export function defineCatalog({ parts, containers = {} }) {
  const all = {}
  for (const id in parts) all[id] = { id, kind: 'part', params: {}, ...parts[id] }
  for (const id in containers) all[id] = { id, kind: 'container', params: {}, slots: ['default'], ...containers[id] }
  if (!all.page) all.page = { id: 'page', kind: 'container', params: {}, slots: ['default'], render: ({ slots }) => <div className="compose-page">{slots.default}</div> }

  const catalog = {
    parts: all,
    get: (id) => all[id],
    /** the leaf parts the model may use, with each record expanded (state: the host's state) */
    options: (state) => listOptions(all, state),
    /** the JSON-ish description of every part and param (what an LLM sees) */
    describe: (state) => describeCatalog(all, state),
    /** the identity key of a node (stable across compositions) */
    keyOf: (node) => identity(all[node.part], node),
    render: (slice, state, opts) => renderLayout(catalog, slice, state, opts),
    /** a part's state lens for a node (or undefined: the host's whole state) */
    lensOf: (node, key, at) => lensOf(all[node.part], node, key, at),
    /** layout utils */
    fromTree: (tree, previous) => fromTree(catalog, tree, previous),
    toTree: (layout) => toTree(layout),
  }
  return catalog
}

// a param can be: { enum, description, default } (a choice), { from: state => [{ value, description }] }
// (a choice over records: the part's identity), or a JSON Schema for free text / numbers (LLM only)
const isChoice = (p) => Array.isArray(p.enum) || typeof p.from === 'function'
const choicesOf = (p, state) => (p.from ? p.from(state) : p.enum.map((v) => ({ value: v, description: p.descriptions?.[v] ?? String(v) })))
export const freeParams = (part) => Object.keys(part.params).filter((k) => !isChoice(part.params[k]))
export const recordParam = (part) => Object.keys(part.params).find((k) => part.params[k].from)

function listOptions(all, state) {
  const out = []
  for (const id in all) {
    const p = all[id]
    if (p.kind !== 'part') continue
    const rp = recordParam(p)
    if (!rp) { out.push({ option: id, part: id, description: p.description, params: {} }); continue }
    for (const r of choicesOf(p.params[rp], state)) {
      out.push({ option: `${id}:${r.value}`, part: id, description: `${p.description}: ${r.description}`, params: { [rp]: r.value } })
    }
  }
  return out
}

function describeCatalog(all, state) {
  return Object.values(all).filter((p) => p.id !== 'page').map((p) => ({
    part: p.id,
    kind: p.kind,
    description: p.description,
    params: Object.fromEntries(Object.entries(p.params).map(([k, v]) => [k, isChoice(v) ? { oneOf: choicesOf(v, state) } : { ...v }])),
  }))
}

function identity(part, node) {
  const rp = part && recordParam(part)
  return rp ? `${node.part}:${node.params?.[rp]}` : node.part
}

// ------------------------------------------------------------------ layout utils
export const emptyLayout = () => ({ root: 'page', nodes: { page: { part: 'page', slots: { default: [] } } } })

/**
 * A nested tree `[{ part, params?, children? }]` (what an LLM writes, or a composer builds) → the
 * flat layout. Keys are identities (`tasks`, `customer:42`); a repeat gets `~2`, `~3`; containers
 * get `row`, `row~2`. So recomposing the same part gives the same key: its instance and local state survive.
 */
export function fromTree(catalog, tree, previous) {
  const nodes = { page: { part: 'page', slots: { default: [] } } }
  const used = new Set(['page'])
  const add = (n) => {
    const part = catalog.get(n.part)
    if (!part) return null                               // an unknown part (a model typo, a stale layout): dropped
    let key = identity(part, n)
    for (let i = 2; used.has(key); i++) key = `${identity(part, n)}~${i}`
    used.add(key)
    const node = { part: n.part }
    const params = withDefaults(part, n.params)
    if (Object.keys(params).length) node.params = params
    if (part.kind === 'container') node.slots = { default: (n.children || []).map(add).filter(Boolean) }
    nodes[key] = node
    return key
  }
  nodes.page.slots.default = tree.map(add).filter(Boolean)
  void previous
  return { root: 'page', nodes }
}

const withDefaults = (part, params = {}) => {
  const out = {}
  for (const k in part.params) {
    const v = params[k] ?? part.params[k].default
    if (v !== undefined) out[k] = v
  }
  return out
}

export function toTree(layout) {
  const walk = (key) => {
    const n = layout.nodes[key]
    const out = { part: n.part }
    if (n.params) out.params = n.params
    if (n.slots) out.children = (n.slots.default || []).map(walk)
    return out
  }
  return (layout.nodes[layout.root].slots?.default || []).map(walk)
}

/** remove a node (and its subtree) */
export function removeNode(layout, key) {
  const nodes = {}
  const drop = new Set()
  const mark = (k) => { drop.add(k); (layout.nodes[k]?.slots?.default || []).forEach(mark) }
  mark(key)
  for (const k in layout.nodes) {
    if (drop.has(k)) continue
    const n = layout.nodes[k]
    nodes[k] = n.slots ? { ...n, slots: { ...n.slots, default: n.slots.default.filter((c) => !drop.has(c)) } } : n
  }
  return { ...layout, nodes }
}

// ------------------------------------------------------------------ state of a part
// `at`: the path of the composition's own state (`['page']`, or one card: `['cards', 'byId', 'c1']`):
// `local` parts keep their state in `<at>.local[nodeKey]`
const getIn = (o, path) => path.reduce((x, k) => x?.[k], o)
const setIn = (o, [k, ...rest], v) => (rest.length ? { ...o, [k]: setIn(o?.[k] ?? {}, rest, v) } : { ...o, [k]: v })

function lensOf(part, node, key, at) {
  const s = part.state
  if (part.local !== undefined) {
    const init = part.local
    return {
      get: (st) => getIn(st, [...at, 'local', key]) ?? init,
      set: (st, v) => setIn(st, [...at, 'local', key], v),
    }
  }
  if (typeof s === 'function') return s(node, key)
  return s
}

// ------------------------------------------------------------------ render
/**
 * The layout as vnodes for the host's view. `slice` is the composition's state (`state.page`):
 * its `layout` (or `preview` while composing); `ui` holds container UI state (the open tab).
 */
// Options: `at` (the slice's path in the host state, default [composeKey]); `scope` (several layouts
// in one host, e.g. one per chat message: instance ids become `<scope>/<nodeKey>` and every part gets
// `scope` / `frozen` / `answer` props); `frozen` (an answered card: wrapped in a disabled fieldset).
function renderLayout(catalog, slice, state, { composeKey = 'page', at = [composeKey], scope, frozen = false, answer, card } = {}) {
  const layout = slice?.preview || slice?.layout
  if (!layout) return null
  const nodeOf = (key) => {
    const n = layout.nodes[key]
    const part = n && catalog.get(n.part)
    if (!part) return null
    if (part.kind === 'container') {
      const kids = (n.slots?.default || []).map((k) => ({ key: k, node: layout.nodes[k], vnode: nodeOf(k), part: catalog.get(layout.nodes[k]?.part) }))
      const ui = slice.ui?.[key] || {}
      return part.render({
        key, node: n, params: n.params || {}, ui,
        slots: { default: kids.map((c) => c.vnode) },
        children: kids,
        // a container control the composition handles (tabs): data attributes the behavior's intent reads
        control: (action, value) => ({ data: { composeNode: key, composeAction: action, composeValue: String(value), ...(scope && { composeScope: scope }) }, className: 'compose-control' }),
      })
    }
    const C = part.component
    const lens = catalog.lensOf(n, key, at)
    const props = part.props ? part.props(n.params || {}, state) : n.params || {}
    const extra = scope ? { scope, frozen, answer: answer?.node === key ? answer.value : undefined } : {}
    // id: the instance key (after the params: a param named id must not replace it)
    const el = <C {...props} {...extra} id={scope ? `${scope}/${key}` : key} node={key} state={lens} />
    return card ? card({ key, node: n, part, vnode: el }) : el
  }
  const out = nodeOf(layout.root)
  return frozen ? <fieldset disabled className="compose-frozen">{out}</fieldset> : out
}

/** a result part's PARENT value: `{ scope, node, value }` (an answer for the card it is in) */
export const answer = (props, value) => ({ scope: props.scope, node: props.node, value })

export { ABORT }
