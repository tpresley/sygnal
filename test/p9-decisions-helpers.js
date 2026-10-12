// PLAN-9 worker B: a TEST-ONLY STAND-IN for worker A's catalog and layout modules
// (src/extra/ai/compose/catalog.ts defineCatalog, layout.ts fromTree / toTree / finish), written
// from dev-plans/research/ai-compose/phase1-contract.md so decisions.ts can be tested before A's
// branch is merged. The p9-decisions tests mock '../src/extra/ai/compose/layout' with this module.
// At merge the coordinator should drop the vi.mock lines (and this stand-in) and run the same
// tests on A's real defineCatalog / layout.ts.
//
// The normalized catalog: { parts, containers, get, options, guidance, limits, categories,
// description }. Parts get `in` (default ['page']) and `maxUses` (default 1). Containers: the
// built-ins `page` and `row`, plus the declared ones; `row: false` (or the research flag
// `rows: false`) leaves `row` out.
//
// Assumptions B makes about A's catalog that the contract doesn't spell out (see the report):
//   - a container may have `description` (labels its slots in parent_ questions) and `in`;
//   - `page` may have a `description` (the catalog's `description` here);
//   - `categories: { id: description }` describes the `category` values for the prefilter;
//   - a catalog can opt out of the built-in row.

export function defineCatalog(decl) {
  const parts = {}
  const containers = {}
  for (const [id, p] of Object.entries(decl.parts || {})) parts[id] = { in: ['page'], maxUses: 1, ...p, id }
  containers.page = { id: 'page', slots: { default: null }, description: decl.description, ...(decl.containers?.page || {}) }
  if (decl.containers?.row !== false && decl.rows !== false) containers.row = { id: 'row', slots: { default: null }, direction: 'row' }
  for (const [id, k] of Object.entries(decl.containers || {})) {
    if (id === 'page' || id === 'row' || !k) continue
    containers[id] = { in: ['page'], ...k, id }
  }
  const catalog = {
    parts,
    containers,
    get: (id) => parts[id] ?? containers[id],
    guidance: decl.guidance,
    limits: { maxParts: 12, maxDepth: 4, ...(decl.limits || {}) },
    categories: decl.categories,
    description: decl.description,
    options(state) {
      const out = []
      for (const [id, p] of Object.entries(parts)) {
        const rp = Object.keys(p.params || {}).find((k) => p.params[k].from)
        if (!rp) { out.push({ option: id, part: id, description: p.description }); continue }
        for (const r of p.params[rp].from(state)) out.push({ option: `${id}:${r.value}`, part: id, params: { [rp]: r.value }, description: `${p.description}: ${r.description}` })
      }
      return out
    },
  }
  return catalog
}

const recordParam = (part) => Object.keys(part?.params || {}).find((k) => part.params[k].from)
const isContainer = (catalog, id) => !!catalog.containers[id]

/** non-default params only */
function ownParams(part, params) {
  const out = {}
  for (const [k, v] of Object.entries(params || {})) {
    const d = part?.params?.[k]
    if (d && d.default !== undefined && String(d.default) === String(v)) continue
    out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

export function fromTree(catalog, tree, previous) {
  void previous
  const nodes = { page: { part: 'page', slots: { default: [] } } }
  const used = new Set(['page'])
  const add = (n) => {
    const def = catalog.get(n.part)
    if (!def) return null
    const rp = recordParam(def)
    const base = rp ? `${n.part}:${n.params?.[rp]}` : n.part
    let key = base
    for (let i = 2; used.has(key); i++) key = `${base}~${i}`
    used.add(key)
    const node = { part: n.part }
    if (isContainer(catalog, n.part)) {
      const kids = n.children || []
      node.slots = Array.isArray(kids) ? { default: kids.map(add).filter(Boolean) } : Object.fromEntries(Object.entries(kids).map(([s, l]) => [s, l.map(add).filter(Boolean)]))
    } else {
      const params = ownParams(def, n.params)
      if (params) node.params = params
    }
    nodes[key] = node
    return key
  }
  nodes.page.slots.default = (tree || []).map(add).filter(Boolean)
  return { root: 'page', nodes }
}

export function toTree(layout) {
  const walk = (key) => {
    const n = layout.nodes[key]
    const out = { part: n.part }
    if (n.params && Object.keys(n.params).length) out.params = n.params
    if (n.slots) {
      const names = Object.keys(n.slots)
      out.children = names.length === 1 && names[0] === 'default' ? n.slots.default.map(walk) : Object.fromEntries(names.map((s) => [s, n.slots[s].map(walk)]))
    }
    return out
  }
  return (layout.nodes[layout.root].slots?.default || []).map(walk)
}

/** a minimal, idempotent finishing step (tree form): unknown parts, required parts, companions, empty / single-part rows, empty containers, minSlots */
export function finish(catalog, layout, state) {
  void state
  const clean = (list) => {
    const out = []
    for (const n of list) {
      const def = catalog.get(n.part)
      if (!def) continue
      if (!isContainer(catalog, n.part)) { out.push(n); continue }
      let kids = n.children || []
      if (Array.isArray(kids)) kids = clean(kids)
      else kids = Object.fromEntries(Object.entries(kids).map(([s, l]) => [s, clean(l)]).filter(([, l]) => l.length))
      const filled = Array.isArray(kids) ? (kids.length ? 1 : 0) : Object.keys(kids).length
      const flat = Array.isArray(kids) ? kids : Object.values(kids).flat()
      if (!filled) continue
      if (n.part === 'row' && flat.length < 2) { out.push(...flat); continue }
      if (def.minSlots && filled < def.minSlots) { out.push(...flat); continue }
      out.push({ ...n, children: kids })
    }
    return out
  }
  let tree = clean(toTree(layout))
  const leaves = []
  const walk = (list) => list.forEach((n) => (n.children ? walk(Array.isArray(n.children) ? n.children : Object.values(n.children).flat()) : leaves.push(n.part)))
  walk(tree)
  const req = Object.values(catalog.parts).filter((p) => p.required && !leaves.includes(p.id))
  tree = [...req.filter((p) => p.pin !== 'end').map((p) => ({ part: p.id })), ...tree, ...req.filter((p) => p.pin === 'end').map((p) => ({ part: p.id }))]
  for (const id of [...leaves]) {
    for (const c of catalog.parts[id]?.companions || []) {
      if (leaves.includes(c)) continue
      leaves.push(c)
      const where = (catalog.parts[c].in || ['page'])[0].split(':')[0]
      if (where === 'page') { tree.push({ part: c }); continue }
      let box = tree.find((n) => n.part === where)
      if (!box) tree.push((box = { part: where, children: [] }))
      box.children.push({ part: c })
    }
  }
  return fromTree(catalog, tree)
}

// ---------- the research notation (structure/composer.mjs format/parse) → a Tree ----------
/** 'page(a row(b c) tabs[overview: d | billing: e])' → [{ part: 'a' }, { part: 'row', children: [...] }, ...]; '' → [] */
export function parseTree(text) {
  if (!text.trim()) return []
  const tokens = text.match(/[A-Za-z0-9_]+|[()[\]:|]/g)
  let i = 0
  const node = () => {
    const out = { part: tokens[i++] }
    if (tokens[i] === '(') {
      i++
      out.children = []
      while (tokens[i] !== ')') out.children.push(node())
      i++
    } else if (tokens[i] === '[') {
      i++
      out.children = {}
      while (tokens[i] !== ']') {
        const slot = tokens[i++]
        i++
        const kids = []
        while (tokens[i] !== '|' && tokens[i] !== ']') kids.push(node())
        out.children[slot] = kids
        if (tokens[i] === '|') i++
      }
      i++
    }
    return out
  }
  return node().children
}

/** a Tree → the research notation (for messages) */
export function formatTree(tree) {
  const f = (n) => {
    if (!n.children) return n.part + (n.params ? `{${Object.entries(n.params).map(([k, v]) => `${k}=${v}`).join(',')}}` : '')
    if (Array.isArray(n.children)) return `${n.part}(${n.children.map(f).join(' ')})`
    return `${n.part}[${Object.entries(n.children).map(([s, l]) => `${s}: ${l.map(f).join(' ')}`).join(' | ')}]`
  }
  return `page(${tree.map(f).join(' ')})`
}
