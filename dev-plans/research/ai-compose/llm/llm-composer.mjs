// llm-composer.mjs: compose a UI from prepared parts with a GenAI LLM (structured output).
// Framework-neutral, pure functions. One catalog declaration (shared with the decision-model path)
// → JSON schema + system prompt; model output → the shared layout format, validated and repaired;
// edits (whole layout + key reconciliation, or operations); a partial-JSON preview reader.
//
// Shared layout format:
//   { root: 'n0', nodes: { n0: { part: 'page', slots: { default: ['n1'] } }, n1: { part: 'x', params: {...} } } }
//
// Catalog declaration:
//   {
//     root: 'page',                     // the root container part (always present, never chosen)
//     maxDepth: 2,                      // page = depth 0; a container at depth maxDepth-1 at most
//     parts: [
//       { id, description,
//         params?: { name: { description, options: { value: 'what it means' }, default } }   // enum: both backends
//                | { name: { description, text: { maxLength }, default } }                     // free text: LLM only
//         container?: { slots: { default: { min, max, accepts?: [ids] | 'leaves' } }, direction: 'row'|'column' },
//         repeatable?: false }           // a part appears once unless repeatable (containers are)
//     ]
//   }

// ---------------------------------------------------------------- catalog
export function normalizeCatalog(catalog) {
  if (catalog.__normal) return catalog
  const byId = {}
  for (const p of catalog.parts) byId[p.id] = { repeatable: !!p.container, ...p, params: p.params || {} }
  if (!byId[catalog.root]) byId[catalog.root] = { id: catalog.root, description: 'The page: its parts stacked top to bottom', container: { slots: { default: {} } }, params: {}, repeatable: false }
  return { ...catalog, maxDepth: catalog.maxDepth ?? 2, byId, __normal: true }
}

const isContainer = (c, id) => !!c.byId[id]?.container
const slotNames = (c, id) => Object.keys(c.byId[id]?.container?.slots || {})
const choosable = (c) => Object.values(c.byId).filter((p) => p.id !== c.root)
const leaves = (c) => choosable(c).filter((p) => !p.container)
const containers = (c) => choosable(c).filter((p) => p.container)
const enumParams = (p) => Object.entries(p.params || {}).filter(([, d]) => d.options || (d.list && d.list.min))

function accepts(c, containerId, slot, childId) {
  const rule = c.byId[containerId]?.container?.slots?.[slot]?.accepts
  if (!rule) return true
  if (rule === 'leaves') return !isContainer(c, childId)
  return rule.includes(childId)
}

// ---------------------------------------------------------------- prompt
function paramText(d, name) {
  if (d.options) {
    const opts = Object.entries(d.options).map(([v, m]) => `${v} = ${m}`).join('; ')
    return `${name}: ${d.description ? d.description + '. ' : ''}one of ${opts} (default ${d.default})`
  }
  if (d.list) return `${name}: ${d.description}; a list of ${d.list.min ? `${d.list.min} to ` : 'at most '}${d.list.max ?? 6} short texts`
  return `${name}: ${d.description}; short text, at most ${d.text.maxLength ?? 40} characters${d.default !== undefined ? `; "${d.default}" when the request does not say` : ''}`
}

/** the catalog as the prompt shows it */
export function catalogText(catalog, { only } = {}) {
  const c = normalizeCatalog(catalog)
  const lines = ['Parts (id: what it shows):']
  for (const p of leaves(c)) {
    if (only && !only.includes(p.id)) continue
    lines.push(`- ${p.id}: ${p.description}`)
    for (const [n, d] of Object.entries(p.params)) lines.push(`    param ${paramText(d, n)}`)
  }
  const cs = containers(c)
  if (cs.length) {
    lines.push('', 'Containers (hold other parts):')
    for (const p of cs) {
      const slots = Object.entries(p.container.slots).map(([s, r]) => {
        const lim = [r.min && `at least ${r.min}`, r.max && `at most ${r.max}`].filter(Boolean).join(', ')
        const acc = r.accepts === 'leaves' ? 'parts only, no containers' : r.accepts ? `only ${r.accepts.join(', ')}` : ''
        return s === 'default' ? [lim, acc].filter(Boolean).join('; ') : `slot ${s}${lim || acc ? ` (${[lim, acc].filter(Boolean).join('; ')})` : ''}`
      }).filter(Boolean).join('; ')
      lines.push(`- ${p.id}: ${p.description}${slots ? ` (${slots})` : ''}`)
      for (const [n, d] of Object.entries(p.params)) lines.push(`    param ${paramText(d, n)}`)
    }
  }
  return lines.join('\n')
}

const RULES = [
  'Use only the parts the request asks for, by name or by what they show. Include every part it asks for. Do not add parts it does not ask for, even related ones.',
  'Use each part at most once.',
  'Order the parts top to bottom as the request says (first, at the top, above, then, below, under, at the bottom). When it does not say, keep the order in which the request mentions them.',
  'Use a container only when the request asks for it (a row only when it wants parts side by side, next to each other or in a row).',
  'Set a param only from what the request says; otherwise use its default.',
  'If nothing in the catalog fits the request, return an empty list.',
]

const SHAPES = {
  tree: `{"children": [ {"part": "<id>", "params": {...}}, {"part": "<container id>", "children": [ ... ]} ]}   (top to bottom; a container's children in order)`,
  blocks: `{"blocks": [ "<id>", {"part": "<id with params>", "<param>": "<value>"}, {"<container id>": [ "<id>", "<id>" ]} ]}   (top to bottom; a container block lists its parts in order)`,
  flat: `{"page": ["<key>", ...], "nodes": {"<key>": {"part": "<id>", "params": {...}, "children": ["<key>", ...]}}}   (page lists the top-level keys top to bottom; give each node a short unique key like n1, n2)`,
  select: `{"parts": ["<id>", ...]}   (the parts the request asks for)`,
}

/** the system prompt for an encoding ('tree' | 'blocks' | 'flat' | 'select'; 'two' = select, then blocks) */
export function systemPrompt(catalog, encoding, { only, edit = false } = {}) {
  if (encoding.endsWith('+plan')) {
    const base = systemPrompt(catalog, encoding.slice(0, -5), { only, edit })
    const [head, shape] = base.split('\n\nReply with JSON only, in this shape:\n')
    return `${head}
- First write asked_for: each thing the request asks for, in its own words, one item per thing (an empty list when it asks for nothing the parts show). Then use exactly one part for each item, and no other parts.

Reply with JSON only, in this shape:
{"asked_for": ["<thing the request asks for>", ...], ${shape.slice(1)}`
  }
  const enc = encoding === 'two' ? 'blocks' : encoding
  const intro = 'You compose a page of an app from parts the app has prepared. Each part already has its own data and wording; you only choose which parts the request asks for and arrange them.'
  const rules = enc === 'select' ? [RULES[0], RULES[5]] : RULES
  const editText = edit === 'whole'
    ? '\n\nThe user message gives the current page and a change. Return the whole new page: keep everything the change does not mention exactly as it is (same parts, order, containers and params).'
    : ''
  return `${intro}\n\n${catalogText(catalog, { only })}\n\nRules:\n${rules.map((r) => `- ${r}`).join('\n')}${editText}\n\nReply with JSON only, in this shape:\n${SHAPES[enc]}`
}

// ---------------------------------------------------------------- schema
function paramsSchema(p, { flat = false } = {}) {
  const props = {}
  for (const [n, d] of Object.entries(p.params)) {
    props[n] = d.options ? { enum: Object.keys(d.options) }
      : d.list ? { type: 'array', items: { type: 'string', maxLength: d.list.maxLength ?? 40 }, ...(d.list.min && { minItems: d.list.min }), maxItems: d.list.max ?? 6 }
      : { type: 'string', maxLength: d.text.maxLength ?? 40 }
  }
  return props
}

function treeNode(c, depth, ids, defs, typed) {
  const name = `d${depth}`
  if (defs[name]) return { $ref: `#/$defs/${name}` }
  defs[name] = true
  const alts = []
  for (const p of choosable(c)) {
    if (ids && !p.container && !ids.includes(p.id)) continue
    if (p.container && depth >= c.maxDepth) continue
    const props = { part: { const: p.id } }
    const required = ['part']
    const ps = paramsSchema(p)
    if (Object.keys(ps).length) { props.params = { type: 'object', properties: ps, required: enumParams(p).map(([n]) => n), additionalProperties: false }; required.push('params') }
    if (p.container) {
      for (const s of slotNames(c, p.id)) {
        const r = p.container.slots[s]
        const key = s === 'default' ? 'children' : s
        props[key] = { type: 'array', items: treeNode(c, depth + 1, ids, defs, typed), ...(r.max && { maxItems: r.max }) }
        required.push(key)
      }
    }
    alts.push({ type: 'object', properties: props, required, additionalProperties: false })
  }
  defs[name] = { anyOf: alts }
  return { $ref: `#/$defs/${name}` }
}

function blockItem(c, p, depth, ids) {
  const ps = paramsSchema(p)
  if (!p.container) {
    if (!Object.keys(ps).length) return null // a plain id string
    return { type: 'object', properties: { part: { const: p.id }, ...ps }, required: ['part', ...enumParams(p).map(([n]) => n)], additionalProperties: false }
  }
  const inner = itemsFor(c, depth + 1, ids)
  return { type: 'object', properties: { [p.id]: { type: 'array', items: inner }, ...ps }, required: [p.id], additionalProperties: false }
}

function itemsFor(c, depth, ids) {
  const plain = leaves(c).filter((p) => (!ids || ids.includes(p.id)) && !Object.keys(p.params).length).map((p) => p.id)
  const alts = []
  if (plain.length) alts.push({ enum: plain })
  for (const p of choosable(c)) {
    if (ids && !p.container && !ids.includes(p.id)) continue
    if (p.container && depth >= c.maxDepth) continue
    const it = blockItem(c, p, depth, ids)
    if (it) alts.push(it)
  }
  return alts.length === 1 ? alts[0] : { anyOf: alts }
}

/** the JSON schema of the model's reply for an encoding; `only` restricts the leaf parts (two-step) */
export function layoutSchema(catalog, encoding, { only } = {}) {
  if (encoding.endsWith('+plan')) {
    const base = layoutSchema(catalog, encoding.slice(0, -5), { only })
    return { ...base, properties: { asked_for: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 8 }, ...base.properties }, required: ['asked_for', ...base.required] }
  }
  const c = normalizeCatalog(catalog)
  if (encoding === 'select') {
    return { type: 'object', properties: { parts: { type: 'array', items: { enum: leaves(c).map((p) => p.id) } } }, required: ['parts'], additionalProperties: false }
  }
  if (encoding === 'tree') {
    const defs = {}
    const items = treeNode(c, 1, only, defs)
    return { type: 'object', properties: { children: { type: 'array', items } }, required: ['children'], additionalProperties: false, $defs: defs }
  }
  if (encoding === 'blocks' || encoding === 'two') {
    return { type: 'object', properties: { blocks: { type: 'array', items: itemsFor(c, 1, only) } }, required: ['blocks'], additionalProperties: false }
  }
  if (encoding === 'flat') {
    const alts = choosable(c).filter((p) => !only || p.container || only.includes(p.id)).map((p) => {
      const props = { part: { const: p.id } }
      const req = ['part']
      const ps = paramsSchema(p)
      if (Object.keys(ps).length) { props.params = { type: 'object', properties: ps, required: enumParams(p).map(([n]) => n), additionalProperties: false }; req.push('params') }
      if (p.container) { props.children = { type: 'array', items: { type: 'string' } }; req.push('children') }
      return { type: 'object', properties: props, required: req, additionalProperties: false }
    })
    return { type: 'object', properties: { page: { type: 'array', items: { type: 'string' } }, nodes: { type: 'object', additionalProperties: { anyOf: alts } } }, required: ['page', 'nodes'], additionalProperties: false }
  }
  throw new Error(`unknown encoding ${encoding}`)
}

// ---------------------------------------------------------------- reading the reply → tree → layout
// internal tree: { part, params?, slots?: { name: [tree] } } ; issues: [{ kind, detail }]

// unconstrained output (tool-call arguments) sometimes names the part with another key
const PART_ALIASES = ['type', 'component', 'name', 'id']
function fromTreeNode(c, n, issues = []) {
  if (typeof n === 'string') return { part: n }
  if (!n || typeof n !== 'object') return null
  let part = n.part
  if (typeof part !== 'string') {
    const k = PART_ALIASES.find((a) => typeof n[a] === 'string' && c.byId[n[a]])
    if (k) { part = n[k]; issues.push({ kind: 'alias', detail: `${k}: ${part}` }) }
  }
  if (!n.params && c.byId[part]) {
    // params written flat on the node
    const flat = Object.fromEntries(Object.entries(n).filter(([k]) => k in (c.byId[part].params || {})))
    if (Object.keys(flat).length) { n = { ...n, params: flat }; issues.push({ kind: 'alias', detail: `flat params on ${part}` }) }
  }
  const t = { part, params: n.params }
  if (isContainer(c, n.part)) {
    t.slots = {}
    for (const s of slotNames(c, n.part)) t.slots[s] = (n[s === 'default' ? 'children' : s] || []).map((x) => fromTreeNode(c, x, issues))
    // a slot the container does not have: kept under its name, repaired later
    for (const k of Object.keys(n)) if (!['part', 'params', 'children', ...slotNames(c, n.part)].includes(k) && Array.isArray(n[k])) t.slots[k] = n[k].map((x) => fromTreeNode(c, x, issues))
  } else if (Array.isArray(n.children) && n.children.length) {
    t.slots = { default: n.children.map((x) => fromTreeNode(c, x, issues)) } // children on a leaf: repaired later
  }
  return t
}

function fromBlock(c, b) {
  if (typeof b === 'string') return { part: b }
  if (!b || typeof b !== 'object') return null
  if (Array.isArray(b)) return { part: '__row', slots: { default: b.map((x) => fromBlock(c, x)) } }
  if (typeof b.part === 'string') {
    const { part, params, children, ...rest } = b
    const t = { part, params: { ...(params || {}), ...rest } }
    if (Array.isArray(children)) t.slots = { default: children.map((x) => fromBlock(c, x)) }
    return t
  }
  const ck = Object.keys(b).find((k) => Array.isArray(b[k]))
  if (!ck) return null
  const params = Object.fromEntries(Object.entries(b).filter(([k]) => k !== ck))
  return { part: ck, params, slots: { default: b[ck].map((x) => fromBlock(c, x)) } }
}

function fromFlat(c, v, issues) {
  const nodes = v.nodes && typeof v.nodes === 'object' ? v.nodes : {}
  const seen = new Set()
  const build = (key, path) => {
    if (path.includes(key)) { issues.push({ kind: 'cycle', detail: key }); return null }
    let n = nodes[key]
    if (!n) {
      const byPart = Object.entries(nodes).find(([, x]) => x?.part === key)
      if (byPart) { issues.push({ kind: 'keyAsPart', detail: key }); key = byPart[0]; n = byPart[1] }
    }
    if (!n) { issues.push({ kind: 'dangling', detail: key }); return null }
    seen.add(key)
    const t = { part: n.part, params: n.params, key }
    if (Array.isArray(n.children)) t.slots = { default: n.children.map((k) => build(k, [...path, key])).filter(Boolean) }
    return t
  }
  const kids = (Array.isArray(v.page) ? v.page : []).map((k) => build(k, [])).filter(Boolean)
  for (const k of Object.keys(nodes)) if (!seen.has(k)) issues.push({ kind: 'orphan', detail: k })
  return kids
}

/** the model's parsed reply → the root's children as trees */
export function readReply(catalog, encoding, value) {
  encoding = encoding.replace(/\+plan$/, '')
  const c = normalizeCatalog(catalog)
  const issues = []
  let kids = []
  if (!value || typeof value !== 'object') issues.push({ kind: 'invalid', detail: 'not an object' })
  else if (encoding === 'tree') {
    let list = value.children
    if (!Array.isArray(list)) {
      // unconstrained output (tool-call arguments): the list under another name ('parts', 'items', 'ui', ...)
      const k = Object.keys(value).find((x) => Array.isArray(value[x]) && value[x].some((n) => n && typeof n === 'object'))
      if (k) { list = value[k]; issues.push({ kind: 'alias', detail: `${k} for children` }) }
      else if (value.part || value.type) { list = [value]; issues.push({ kind: 'alias', detail: 'a single node' }) }
    }
    kids = (Array.isArray(list) ? list : []).map((n) => fromTreeNode(c, n, issues))
  }
  else if (encoding === 'blocks' || encoding === 'two') kids = (value.blocks || []).map((b) => fromBlock(c, b))
  else if (encoding === 'flat') kids = fromFlat(c, value, issues)
  return { tree: { part: c.root, slots: { default: kids } }, issues }
}

/**
 * Validate and repair a tree against the catalog: unknown parts dropped, a non-repeatable part kept
 * the first time only, invalid / missing enum params → default, text params trimmed, unknown slots
 * merged into default, containers too deep or not accepted → their children lifted, containers below
 * their slot minimum unwrapped, empty containers dropped, children on a leaf lifted.
 */
export function repairTree(catalog, tree, issues = []) {
  const c = normalizeCatalog(catalog)
  const used = new Set()
  const fixParams = (p, params) => {
    const out = {}
    for (const [n, d] of Object.entries(p.params)) {
      const v = params?.[n]
      if (d.options) {
        if (v !== undefined && !(v in d.options)) issues.push({ kind: 'param', detail: `${p.id}.${n}=${v}` })
        out[n] = v in (d.options || {}) ? v : d.default
      } else if (d.list) {
        const items = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s*[,;|]\s*/) : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, d.list.maxLength ?? 40))
        const uniq = [...new Set(items)].slice(0, d.list.max ?? 6)
        if (!Array.isArray(v) && v !== undefined) issues.push({ kind: 'param', detail: `${p.id}.${n} not a list` })
        if (uniq.length >= (d.list.min || 1)) out[n] = uniq
        else if (d.default !== undefined) out[n] = d.default
      } else if (typeof v === 'string' && v.trim()) out[n] = v.trim().slice(0, d.text.maxLength ?? 40)
      else if (d.default !== undefined && d.default !== '') out[n] = d.default
    }
    for (const n of Object.keys(params || {})) if (!(n in p.params)) issues.push({ kind: 'param', detail: `${p.id}.${n} unknown` })
    return Object.keys(out).length ? out : undefined
  }
  // returns a list (a node may turn into its lifted children)
  const walk = (n, depth, parent, slot) => {
    if (!n || typeof n.part !== 'string') { issues.push({ kind: 'invalid', detail: 'node without part' }); return [] }
    if (n.part === '__row') n = { ...n, part: containers(c).find((p) => p.container.direction === 'row')?.id || 'row' }
    const p = c.byId[n.part]
    const kidsOf = (d) => Object.values(n.slots || {}).flat().flatMap((k) => walk(k, d, n.part, 'default'))
    if (!p || p.id === c.root) { issues.push({ kind: 'unknownPart', detail: n.part }); return kidsOf(depth) }
    if (!p.container) {
      const lifted = n.slots ? (issues.push({ kind: 'structure', detail: `children on leaf ${p.id}` }), kidsOf(depth)) : []
      if (!accepts(c, parent, slot, p.id)) issues.push({ kind: 'structure', detail: `${p.id} not accepted in ${parent}` })
      if (used.has(p.id) && !p.repeatable) { issues.push({ kind: 'duplicate', detail: p.id }); return lifted }
      used.add(p.id)
      return [{ part: p.id, params: fixParams(p, n.params), key: n.key }, ...lifted]
    }
    // a container
    if (depth >= c.maxDepth || !accepts(c, parent, slot, p.id)) {
      issues.push({ kind: 'structure', detail: `${p.id} too deep or not accepted` })
      return kidsOf(depth)
    }
    const slots = {}
    for (const s of slotNames(c, p.id)) slots[s] = []
    for (const [s, kids] of Object.entries(n.slots || {})) {
      const target = s in slots ? s : 'default' in slots ? 'default' : slotNames(c, p.id)[0]
      if (target !== s) issues.push({ kind: 'structure', detail: `unknown slot ${p.id}.${s}` })
      slots[target].push(...(kids || []).flatMap((k) => walk(k, depth + 1, p.id, target)))
    }
    const total = Object.values(slots).flat().length
    if (total === 0) { issues.push({ kind: 'structure', detail: `empty ${p.id}` }); return [] }
    const under = Object.entries(slots).some(([s, k]) => k.length < (p.container.slots[s]?.min || 0))
    const over = Object.entries(slots).some(([s, k]) => p.container.slots[s]?.max && k.length > p.container.slots[s].max)
    if (over) issues.push({ kind: 'structure', detail: `${p.id} over max` })
    if (under) { issues.push({ kind: 'structure', detail: `${p.id} under min, unwrapped` }); return Object.values(slots).flat() }
    return [{ part: p.id, params: fixParams(p, n.params), slots, key: n.key }]
  }
  const root = { part: c.root, slots: { default: (tree.slots?.default || []).flatMap((k) => walk(k, 1, c.root, 'default')) } }
  return { tree: root, issues }
}

/** tree → shared layout format with fresh keys (keys already on nodes are kept) */
export function treeToLayout(tree) {
  const nodes = {}
  let i = 0
  const taken = new Set()
  const collect = (n) => { if (n.key) taken.add(n.key); Object.values(n.slots || {}).flat().forEach(collect) }
  collect(tree)
  const fresh = () => { let k; do k = `n${i++}`; while (taken.has(k)); taken.add(k); return k }
  const add = (n, isRoot) => {
    const key = n.key && !nodes[n.key] ? n.key : (isRoot ? 'n0' : fresh())
    if (isRoot) taken.add('n0')
    const out = { part: n.part }
    if (n.params) out.params = n.params
    nodes[key] = out
    if (n.slots) out.slots = Object.fromEntries(Object.entries(n.slots).map(([s, kids]) => [s, kids.map((k) => add(k))]))
    return key
  }
  if (!tree.key) taken.add('n0')
  const root = add({ ...tree, key: tree.key || 'n0' }, false)
  return { root, nodes }
}

export function layoutToTree(layout) {
  const seen = new Set()
  const go = (key) => {
    if (seen.has(key)) return null
    seen.add(key)
    const n = layout.nodes[key]
    if (!n) return null
    const t = { part: n.part, key }
    if (n.params) t.params = n.params
    if (n.slots) t.slots = Object.fromEntries(Object.entries(n.slots).map(([s, ks]) => [s, ks.map(go).filter(Boolean)]))
    return t
  }
  return go(layout.root)
}

/** reply value → { layout, issues } (the whole read / validate / repair path) */
export function readLayout(catalog, encoding, value) {
  const { tree, issues } = readReply(catalog, encoding, value)
  const fixed = repairTree(catalog, tree, issues)
  return { layout: treeToLayout(fixed.tree), issues }
}

/** a compact string of a layout: `row(a,b) c{range=quarter}` (page children); used for scoring */
export function layoutToString(layout, { text = false } = {}) {
  const t = layoutToTree(layout)
  const str = (n) => {
    const p = n.params ? `{${Object.keys(n.params).sort().map((k) => `${k}=${n.params[k]}`).join(',')}}` : ''
    const kids = n.slots ? Object.entries(n.slots).map(([s, ks]) => (s === 'default' ? '' : `${s}:`) + ks.map(str).join(',')).join(';') : null
    return `${n.part}${p}${kids !== null ? `(${kids})` : ''}`
  }
  return (t?.slots?.default || []).map(str).join(' ')
}

/** parse 'row(a,b) c{range=quarter}' back into a layout (for labelled cases) */
export function stringToLayout(s, root = 'page') {
  let i = 0
  const ws = () => { while (s[i] === ' ' || s[i] === ',') i++ }
  const ident = () => { const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i)); i += m[0].length; return m[0] }
  const node = () => {
    const n = { part: ident() }
    if (s[i] === '{') {
      const end = s.indexOf('}', i)
      n.params = Object.fromEntries(s.slice(i + 1, end).split(',').filter(Boolean).map((kv) => kv.split('=')))
      i = end + 1
    }
    if (s[i] === '(') {
      i++
      n.slots = { default: [] }
      let slot = 'default'
      while (s[i] !== ')') {
        ws()
        const m = /^([A-Za-z0-9_-]+):/.exec(s.slice(i))
        if (m) { slot = m[1]; n.slots[slot] = n.slots[slot] || []; i += m[0].length }
        n.slots[slot].push(node())
        if (s[i] === ';') i++
        ws()
      }
      i++
      if (!n.slots.default.length && Object.keys(n.slots).length > 1) delete n.slots.default
    }
    return n
  }
  const kids = []
  ws()
  while (i < s.length) { kids.push(node()); ws() }
  return treeToLayout({ part: root, slots: { default: kids } })
}

// ---------------------------------------------------------------- edits
/** a layout as the edit prompt shows it: one node per line, indented, with its key */
export function describeLayout(layout) {
  const lines = []
  const go = (key, depth) => {
    const n = layout.nodes[key]
    const ps = n.params ? ' ' + Object.entries(n.params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''
    lines.push(`${'  '.repeat(depth)}${key}: ${n.part}${ps}`)
    for (const [s, ks] of Object.entries(n.slots || {})) {
      if (s !== 'default') lines.push(`${'  '.repeat(depth + 1)}[${s}]`)
      ks.forEach((k) => go(k, depth + 1))
    }
  }
  go(layout.root, 0)
  return lines.join('\n')
}

/** the previous layout in the encoding's own shape (what the model returns for a whole-layout edit) */
export function layoutToReply(layout, encoding, catalog) {
  encoding = encoding.replace(/\+plan$/, '')
  const c = normalizeCatalog(catalog)
  const t = layoutToTree(layout)
  if (encoding === 'tree') {
    const go = (n) => {
      const o = { part: n.part }
      if (n.params) o.params = n.params
      for (const [s, ks] of Object.entries(n.slots || {})) o[s === 'default' ? 'children' : s] = ks.map(go)
      return o
    }
    return { children: t.slots.default.map(go) }
  }
  const go = (n) => {
    if (n.slots) return { [n.part]: n.slots.default.map(go), ...(n.params || {}) }
    return n.params ? { part: n.part, ...n.params } : n.part
  }
  return { blocks: t.slots.default.map(go) }
}

/**
 * Keep the previous keys on a new layout: a non-repeatable part keeps its key (it is unique); a
 * container keeps the key of the previous container of the same part sharing the most children.
 */
export function reconcileKeys(prev, nextTree) {
  const prevByPart = {}
  const prevContainers = []
  for (const [k, n] of Object.entries(prev.nodes)) {
    if (k === prev.root) continue
    if (n.slots) prevContainers.push({ key: k, part: n.part, kids: Object.values(n.slots).flat().map((ck) => prev.nodes[ck]?.part) })
    else prevByPart[n.part] = k
  }
  const usedC = new Set()
  const go = (n, isRoot) => {
    const out = { ...n }
    if (isRoot) out.key = prev.root
    else if (!n.slots && prevByPart[n.part]) out.key = prevByPart[n.part]
    if (n.slots) out.slots = Object.fromEntries(Object.entries(n.slots).map(([s, ks]) => [s, ks.map((k) => go(k))]))
    if (n.slots && !isRoot) {
      const kids = Object.values(n.slots).flat().map((k) => k.part)
      let best = null, score = 0
      for (const pc of prevContainers) {
        if (pc.part !== n.part || usedC.has(pc.key)) continue
        const s = kids.filter((x) => pc.kids.includes(x)).length
        if (s > score) { best = pc; score = s }
      }
      if (best) { usedC.add(best.key); out.key = best.key }
    }
    return out
  }
  return go(nextTree, true)
}

/** the operations schema for an edit; nodes are named by their key in the previous layout */
export function opsSchema(catalog, prev) {
  const c = normalizeCatalog(catalog)
  const keys = Object.keys(prev.nodes)
  const nodeKeys = keys.filter((k) => k !== prev.root)
  const containerKeys = keys.filter((k) => prev.nodes[k].slots)
  const newParts = leaves(c).map((p) => p.id)
  const target = { enum: [...containerKeys, 'new'] }
  const ops = [
    ...leaves(c).map((p) => {
      const ps = paramsSchema(p)
      return { type: 'object', properties: { op: { const: 'add' }, part: { const: p.id }, ...(Object.keys(ps).length && { params: { type: 'object', properties: ps, additionalProperties: false } }), to: target, index: { type: 'integer' } }, required: ['op', 'part', 'to', 'index'], additionalProperties: false }
    }),
    ...(nodeKeys.length ? [
      { type: 'object', properties: { op: { const: 'remove' }, node: { enum: nodeKeys } }, required: ['op', 'node'], additionalProperties: false },
      { type: 'object', properties: { op: { const: 'move' }, node: { enum: nodeKeys }, to: target, index: { type: 'integer' } }, required: ['op', 'node', 'to', 'index'], additionalProperties: false },
      { type: 'object', properties: { op: { const: 'replace' }, node: { enum: nodeKeys }, part: { enum: newParts } }, required: ['op', 'node', 'part'], additionalProperties: false },
      { type: 'object', properties: { op: { const: 'setParam' }, node: { enum: nodeKeys }, param: { type: 'string' }, value: { type: 'string' } }, required: ['op', 'node', 'param', 'value'], additionalProperties: false },
    ] : []),
    { type: 'object', properties: { op: { const: 'wrap' }, nodes: { type: 'array', items: { enum: nodeKeys.length ? nodeKeys : ['none'] } }, container: { enum: containers(c).map((p) => p.id) } }, required: ['op', 'nodes', 'container'], additionalProperties: false },
  ]
  return { type: 'object', properties: { ops: { type: 'array', items: { anyOf: ops } } }, required: ['ops'], additionalProperties: false }
}

export function opsSystemPrompt(catalog) {
  return `${systemPrompt(catalog, 'tree').split('\n\nReply with JSON only')[0]}

The user message gives the current page (one node per line: key: part params, children indented under their container) and a change. Return only the operations that make the change, in order:
- {"op":"add","part":"<id>","params":{...},"to":"<container key>","index":<position in it, 0 = top/left>}
- {"op":"remove","node":"<key>"}
- {"op":"move","node":"<key>","to":"<container key>","index":<position>}
- {"op":"replace","node":"<key>","part":"<id>"}
- {"op":"setParam","node":"<key>","param":"<name>","value":"<value>"}
- {"op":"wrap","nodes":["<key>",...],"container":"<container id>"}   (puts those nodes, in that order, into a new container where the first one was)
Indexes count the container's children after the earlier operations. Leave everything else as it is.

Reply with JSON only: {"ops": [ ... ]}`
}

/** apply operations to a previous layout → { layout, issues } (repaired; keys kept) */
export function applyOps(catalog, prev, ops) {
  const c = normalizeCatalog(catalog)
  const issues = []
  const L = structuredClone(prev)
  let n = 0
  const fresh = () => { let k; do k = `n${Object.keys(L.nodes).length + n++}`; while (L.nodes[k]); return k }
  const parentOf = (key) => {
    for (const [pk, p] of Object.entries(L.nodes)) for (const [s, ks] of Object.entries(p.slots || {})) { const i = ks.indexOf(key); if (i >= 0) return { pk, s, i } }
    return null
  }
  const insert = (to, index, key) => {
    const t = L.nodes[to === 'new' || !L.nodes[to] ? L.root : to]
    if (!t?.slots) { issues.push({ kind: 'op', detail: `add to non-container ${to}` }); L.nodes[L.root].slots.default.push(key); return }
    const ks = t.slots.default || Object.values(t.slots)[0]
    const i = Number.isInteger(index) ? Math.max(0, Math.min(index, ks.length)) : ks.length
    ks.splice(i, 0, key)
  }
  for (const op of Array.isArray(ops) ? ops : []) {
    try {
      if (op.op === 'add') { const k = fresh(); L.nodes[k] = { part: op.part, ...(op.params && { params: op.params }) }; insert(op.to, op.index, k) }
      else if (op.op === 'remove') { const p = parentOf(op.node); if (p) L.nodes[p.pk].slots[p.s].splice(p.i, 1); delete L.nodes[op.node] }
      else if (op.op === 'move') { const p = parentOf(op.node); if (!p) throw 0; L.nodes[p.pk].slots[p.s].splice(p.i, 1); insert(op.to, op.index, op.node) }
      else if (op.op === 'replace') { const k = fresh(); const p = parentOf(op.node); if (!p) throw 0; L.nodes[p.pk].slots[p.s][p.i] = k; delete L.nodes[op.node]; L.nodes[k] = { part: op.part } }
      else if (op.op === 'setParam') { const nd = L.nodes[op.node]; if (!nd) throw 0; nd.params = { ...(nd.params || {}), [op.param]: op.value } }
      else if (op.op === 'wrap') {
        const ks = (op.nodes || []).filter((k) => L.nodes[k])
        if (!ks.length) throw 0
        const first = parentOf(ks[0])
        const k = fresh()
        L.nodes[k] = { part: op.container, slots: { default: [] } }
        L.nodes[first.pk].slots[first.s].splice(first.i, 0, k)
        for (const x of ks) { const p = parentOf(x); L.nodes[p.pk].slots[p.s].splice(p.i, 1); L.nodes[k].slots.default.push(x) }
      } else throw 0
    } catch { issues.push({ kind: 'op', detail: JSON.stringify(op) }) }
  }
  // garbage: nodes no longer reachable are gone; repair the result keeping keys
  const tree = layoutToTree(L)
  const fixed = repairTree(c, tree, issues)
  return { layout: treeToLayout(fixed.tree), issues }
}

// ---------------------------------------------------------------- streaming preview
/**
 * Parse a JSON prefix: closes open containers, drops an unfinished string, number or key and the
 * key whose value never started. Returns undefined when nothing is usable yet.
 */
export function parsePartialJSON(text) {
  let i = 0
  const s = text
  const INCOMPLETE = Symbol('incomplete')
  const sp = () => { while (i < s.length && /\s/.test(s[i])) i++ }
  const value = () => {
    sp()
    if (i >= s.length) return INCOMPLETE
    const ch = s[i]
    if (ch === '{') {
      i++
      const o = {}
      for (;;) {
        sp()
        if (i >= s.length) return markPartial(o)
        if (s[i] === '}') { i++; return o }
        if (s[i] === ',') { i++; continue }
        const k = value()
        if (k === INCOMPLETE || typeof k !== 'string') return markPartial(o)
        sp()
        if (s[i] !== ':') return markPartial(o)
        i++
        const v = value()
        if (v === INCOMPLETE) return markPartial(o)
        o[k] = v
        if (v && typeof v === 'object' && v[PARTIAL]) return markPartial(o)
      }
    }
    if (ch === '[') {
      i++
      const a = []
      for (;;) {
        sp()
        if (i >= s.length) return markPartial(a)
        if (s[i] === ']') { i++; return a }
        if (s[i] === ',') { i++; continue }
        const v = value()
        if (v === INCOMPLETE) return markPartial(a)
        a.push(v)
        if (v && typeof v === 'object' && v[PARTIAL]) return markPartial(a)
      }
    }
    if (ch === '"') {
      let j = i + 1, out = ''
      while (j < s.length && s[j] !== '"') { if (s[j] === '\\') { j++; if (j >= s.length) break } out += s[j]; j++ }
      if (j >= s.length) { i = s.length; return INCOMPLETE }
      const raw = s.slice(i, j + 1)
      i = j + 1
      try { return JSON.parse(raw) } catch { return out }
    }
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i))
    if (!m || i + m[0].length >= s.length) { i = s.length; return INCOMPLETE }
    i += m[0].length
    return JSON.parse(m[0])
  }
  const v = value()
  return v === INCOMPLETE ? undefined : v
}
const PARTIAL = Symbol.for('partial')
function markPartial(x) { Object.defineProperty(x, PARTIAL, { value: true, enumerable: false }); return x }

/**
 * A preview layout from a streamed reply prefix: only complete parts (the last, unfinished node is
 * left out by the partial parser), repaired like a full reply. Containers still filling show what
 * they hold so far (no min check: a row of one shows as that part until its second part arrives).
 */
export function previewFromPartial(catalog, encoding, text, { settled = true, previous } = {}) {
  let v = parsePartialJSON(text)
  if (!v || typeof v !== 'object') return null
  // settled: a leaf node shows once its object is closed (its params are final: no year → quarter flicker);
  // a container still filling shows what it holds so far
  const prune = (x) => {
    if (Array.isArray(x)) return x.filter((y) => !(settled && y && typeof y === 'object' && !Array.isArray(y) && y[PARTIAL] && !Object.values(y).some(Array.isArray))).map(prune)
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, prune(y)]))
    return x
  }
  v = prune(v)
  const { tree } = readReply(catalog, encoding, v)
  // drop nodes whose part id is not a known part (an unfinished object may carry only part so far: fine)
  const c = normalizeCatalog(catalog)
  const relaxed = { ...c, parts: c.parts, byId: Object.fromEntries(Object.entries(c.byId).map(([k, p]) => [k, p.container ? { ...p, container: { ...p.container, slots: Object.fromEntries(Object.entries(p.container.slots).map(([s, r]) => [s, { ...r, min: 0 }])) } } : p])) }
  const { tree: t } = repairTree(relaxed, tree, [])
  // previous: the last preview (or the page on screen): parts keep their keys, so nothing remounts as the reply grows
  return treeToLayout(previous ? reconcileKeys(previous, t) : t)
}

// ---------------------------------------------------------------- schema check (as emitted, before repair)
/** a small JSON-schema check (type, enum, const, properties, required, additionalProperties, items,
 *  min/maxItems, maxLength, anyOf, $ref to #/$defs) → list of error paths; [] = valid */
export function checkSchema(schema, value, root = schema, path = '$') {
  if (schema.$ref) return checkSchema(root.$defs[schema.$ref.split('/').pop()], value, root, path)
  if (schema.anyOf) {
    const ok = schema.anyOf.some((s) => checkSchema(s, value, root, path).length === 0)
    return ok ? [] : [`${path}: matches no alternative`]
  }
  const errs = []
  if ('const' in schema && value !== schema.const) errs.push(`${path}: not ${schema.const}`)
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} not in enum`)
  const t = schema.type
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}: not an object`]
    for (const r of schema.required || []) if (!(r in value)) errs.push(`${path}.${r}: missing`)
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) errs.push(...checkSchema(schema.properties[k], v, root, `${path}.${k}`))
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: not allowed`)
      else if (typeof schema.additionalProperties === 'object') errs.push(...checkSchema(schema.additionalProperties, v, root, `${path}.${k}`))
    }
  } else if (t === 'array') {
    if (!Array.isArray(value)) return [`${path}: not an array`]
    if (schema.minItems && value.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems}`)
    if (schema.maxItems && value.length > schema.maxItems) errs.push(`${path}: more than ${schema.maxItems}`)
    if (schema.items) value.forEach((v, i) => errs.push(...checkSchema(schema.items, v, root, `${path}[${i}]`)))
  } else if (t === 'string') {
    if (typeof value !== 'string') errs.push(`${path}: not a string`)
    else if (schema.maxLength && value.length > schema.maxLength) errs.push(`${path}: longer than ${schema.maxLength}`)
  } else if (t === 'integer' && !Number.isInteger(value)) errs.push(`${path}: not an integer`)
  return errs
}

// ---------------------------------------------------------------- edits, v2: positions as an enum of places
// Models place things badly by index; they place them well relative to a node they can name.
// Places: 'top', 'bottom', and per node k: 'above k', 'below k' (on the page, around k's top-level block),
// 'left of k', 'right of k' (side by side with k: joins k's row, or makes a row with k).

function placesFor(c, prev) {
  const places = ['top', 'bottom']
  for (const k of Object.keys(prev.nodes)) {
    if (k === prev.root) continue
    places.push(`above ${k}`, `below ${k}`)
    if (!isContainer(c, prev.nodes[k].part)) places.push(`left of ${k}`, `right of ${k}`)
  }
  return places
}

export function opsSchemaV2(catalog, prev) {
  const c = normalizeCatalog(catalog)
  const nodeKeys = Object.keys(prev.nodes).filter((k) => k !== prev.root)
  const where = { enum: placesFor(c, prev) }
  const withParams = (base, p) => {
    const ps = paramsSchema(p)
    return Object.keys(ps).length ? { ...base, params: { type: 'object', properties: ps, additionalProperties: false } } : base
  }
  const ops = [
    ...leaves(c).map((p) => ({ type: 'object', properties: { ...withParams({ op: { const: 'add' }, part: { const: p.id } }, p), where }, required: ['op', 'part', 'where'], additionalProperties: false })),
  ]
  if (nodeKeys.length) {
    ops.push(
      { type: 'object', properties: { op: { const: 'remove' }, node: { enum: nodeKeys } }, required: ['op', 'node'], additionalProperties: false },
      { type: 'object', properties: { op: { const: 'move' }, node: { enum: nodeKeys }, where }, required: ['op', 'node', 'where'], additionalProperties: false },
      ...leaves(c).map((p) => ({ type: 'object', properties: withParams({ op: { const: 'replace' }, node: { enum: nodeKeys }, part: { const: p.id } }, p), required: ['op', 'node', 'part'], additionalProperties: false })),
      { type: 'object', properties: { op: { const: 'setParams' }, node: { enum: nodeKeys }, params: { type: 'object' } }, required: ['op', 'node', 'params'], additionalProperties: false },
    )
  }
  return { type: 'object', properties: { ops: { type: 'array', items: { anyOf: ops } } }, required: ['ops'], additionalProperties: false }
}

export function opsSystemPromptV2(catalog) {
  return `${systemPrompt(catalog, 'tree').split('\n\nReply with JSON only')[0]}

The user message gives the current page (one node per line: key: part params; a row's parts are indented under it) and a change. Return only the operations that make the change, in order:
- {"op":"add","part":"<id>","params":{...},"where":"<place>"}
- {"op":"remove","node":"<key>"}
- {"op":"move","node":"<key>","where":"<place>"}
- {"op":"replace","node":"<key>","part":"<id>","params":{...}}   (the new part takes the old one's place)
- {"op":"setParams","node":"<key>","params":{"<param>":"<value>"}}
A place is "top" or "bottom" of the page, "above <key>" or "below <key>" (on the page), or "left of <key>" / "right of <key>" (side by side with that part, in a row).
Change only what the request asks; everything else stays as it is. A request that changes nothing gets no operations.

Reply with JSON only: {"ops": [ ... ]}`
}

/** apply v2 operations → { layout, issues } (repaired; keys kept) */
export function applyOpsV2(catalog, prev, ops) {
  const c = normalizeCatalog(catalog)
  const issues = []
  const L = structuredClone(prev)
  let n = 0
  const fresh = () => { let k; do k = `n${Object.keys(L.nodes).length + n++}`; while (L.nodes[k]); return k }
  const parentOf = (key) => {
    for (const [pk, p] of Object.entries(L.nodes)) for (const [s, ks] of Object.entries(p.slots || {})) { const i = ks.indexOf(key); if (i >= 0) return { pk, s, i } }
    return null
  }
  const detach = (key) => { const p = parentOf(key); if (p) L.nodes[p.pk].slots[p.s].splice(p.i, 1); return p }
  const rowPart = containers(c).find((p) => p.container.direction === 'row')?.id
  const place = (key, where) => {
    const page = L.nodes[L.root].slots.default
    const m = /^(above|below|left of|right of) (\S+)$/.exec(where || '')
    if (where === 'top') return page.unshift(key)
    if (!m || !L.nodes[m[2]] || m[2] === key) { if (where !== 'bottom') issues.push({ kind: 'op', detail: `place ${where}` }); return page.push(key) }
    const [, rel, ref] = m
    const p = parentOf(ref)
    const top = p.pk === L.root ? ref : p.pk // ref's top-level block
    if (rel === 'above' || rel === 'below') return page.splice(page.indexOf(top) + (rel === 'below' ? 1 : 0), 0, key)
    if (p.pk !== L.root) return L.nodes[p.pk].slots[p.s].splice(p.i + (rel === 'right of' ? 1 : 0), 0, key)
    if (!rowPart) { issues.push({ kind: 'op', detail: 'no row container' }); return page.splice(p.i + 1, 0, key) }
    const r = fresh()
    L.nodes[r] = { part: rowPart, slots: { default: rel === 'right of' ? [ref, key] : [key, ref] } }
    page.splice(p.i, 1, r)
  }
  for (const op of Array.isArray(ops) ? ops : []) {
    try {
      if (op.op === 'add') { const k = fresh(); L.nodes[k] = { part: op.part, ...(op.params && { params: op.params }) }; place(k, op.where) }
      else if (op.op === 'remove') { if (!detach(op.node)) throw 0; delete L.nodes[op.node] }
      else if (op.op === 'move') { if (!L.nodes[op.node] || !detach(op.node)) throw 0; place(op.node, op.where) }
      else if (op.op === 'replace' && L.nodes[op.node]?.part === op.part) { const nd = L.nodes[op.node]; nd.params = { ...(nd.params || {}), ...(op.params || {}) }; issues.push({ kind: 'op', detail: 'replace with the same part = setParams (key kept)' }) }
      else if (op.op === 'replace') { const p = parentOf(op.node); if (!p) throw 0; const k = fresh(); L.nodes[p.pk].slots[p.s][p.i] = k; delete L.nodes[op.node]; L.nodes[k] = { part: op.part, ...(op.params && { params: op.params }) } }
      else if (op.op === 'setParams' || op.op === 'setParam') { const nd = L.nodes[op.node]; if (!nd) throw 0; nd.params = { ...(nd.params || {}), ...(op.params || { [op.param]: op.value }) } }
      else throw 0
    } catch { issues.push({ kind: 'op', detail: JSON.stringify(op) }) }
  }
  // rows left with one part are unwrapped by the repair; unreachable nodes are dropped
  const fixed = repairTree(c, layoutToTree(L), issues)
  return { layout: treeToLayout(fixed.tree), issues }
}

// ---------------------------------------------------------------- generated few-shot examples
/**
 * Three example turns built from the catalog itself (no app-written examples needed): two parts in
 * order, two parts side by side (when there is a row container), and a request nothing fits. They
 * teach the reply length and "only what is asked"; the prompts are the parts' own descriptions.
 * Returns [prompt, layoutString, asked_for][] (layoutString in stringToLayout notation).
 */
export function autoShots(catalog, { unrelated = 'Book a table for two at an Italian restaurant' } = {}) {
  const c = normalizeCatalog(catalog)
  const ls = leaves(c).filter((p) => !enumParams(p).length)
  const pick = (i) => ls[Math.min(ls.length - 1, Math.floor(i * ls.length))]
  const d = (p) => {
    let s = p.description.replace(/\s*\([^)]*\)/g, '')
    if (s.includes(': ')) s = s.slice(s.indexOf(': ') + 2) // 'KPI card: new signups' → 'new signups'
    return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s
  }
  const [a, b, x, y] = [pick(0.85), pick(0.15), pick(0.6), pick(0.35)]
  const row = containers(c).find((p) => p.container.direction === 'row')
  const shots = [[`Show ${d(a)}, then ${d(b)}`, `${a.id} ${b.id}`, [d(a), d(b)]]]
  if (row && x !== y) shots.push([`${d(x).charAt(0).toUpperCase() + d(x).slice(1)} and ${d(y)}, side by side`, `${row.id}(${x.id},${y.id})`, [d(x), d(y)]])
  shots.push([unrelated, '', []])
  return shots
}
