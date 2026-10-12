// Params, parts from records, and edits for "compose a UI from prepared parts" with a decision model.
// Framework-neutral and pure: every function builds a decision request (dictionary form:
// { state, questions }) or reads its answers. No I/O, no Sygnal imports.
//
// Catalog (plain data):
//   { parts: [{ id, description,
//       params?:  { [name]: { label, default, ask?, options: { [value]: description } } },
//       records?: { param, label, items: [{ key, description }] } }] }
// Layout (shared provisional format):
//   { root: 'n0', nodes: { n0: { part: 'page', slots: { default: ['n1', 'n2'] } },
//                          n1: { part: 'revenueChart', params: { range: 'quarter' } },
//                          n2: { part: 'row', slots: { default: ['n3', 'n4'] } }, ... } }
// A record part appears once per chosen record: { part: 'project', params: { project: 'atlas' } }.

// ---------- question builders ----------
export const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria })
export const noul = (instructions, criteria) => ({ type: 'noul', instructions, ...(criteria && { criteria }) })
const sep = '__' // question names: use_<part>, use_<part>__<record>, param_<part>__<name>, set_<node>__<name>, ...

/**
 * Backend limits. TypeSafe Jev takes up to 255 candidates per choice; Ollama's /v1/systemone (nimble)
 * takes 2–26. A choice with more options is split into chunks `<name>__c<i>`, each repeating the
 * `head` options (not_stated / keep / none); readChunked() takes the most probable non-head answer.
 */
export const LIMITS = { maxOptions: 255 }
export function chunkedChoice(qs, name, instructions, head, options) {
  const entries = Object.entries(options)
  const room = LIMITS.maxOptions - Object.keys(head).length
  if (entries.length <= room) { qs[name] = choice(instructions, { ...head, ...options }); return }
  for (let i = 0, c = 0; i < entries.length; i += room, c++) qs[`${name}${sep}c${c}`] = choice(instructions, { ...head, ...Object.fromEntries(entries.slice(i, i + room)) })
}
export function readChunked(answers, name, headKeys) {
  if (answers[name]) return answers[name]
  let best = null
  for (let c = 0; answers[`${name}${sep}c${c}`]; c++) {
    const a = answers[`${name}${sep}c${c}`]
    if (headKeys.includes(a.choice)) { best ??= a; continue }
    if (!best || headKeys.includes(best.choice) || (a.probabilities?.[a.choice] ?? 0) > (best.probabilities?.[best.choice] ?? 0)) best = a
  }
  return best
}

// ---------- wording (recommended; measured in REPORT.md) ----------
export const W = {
  select: 'Does user_request ask for this element, by name or by what it shows? Every element user_request names must be used, wherever on the page it wants it. Omit elements user_request does not ask for, even when related to the topic.',
  omit: 'None of these elements is needed.',
  row: 'Does user_request explicitly ask for some elements to be placed side by side, next to each other, beside each other or in a row?',
  param: (part, p) => `Consider this element: ${part.description}. ${p.ask ?? `Which ${p.label} does user_request ask for it?`} Choose not_stated when user_request does not mention a ${p.label}.`,
  paramForced: (part, p) => `Consider this element: ${part.description}. ${p.ask ?? `Which ${p.label} does user_request ask for it?`}`,
  notStated: (p) => `user_request does not mention a ${p.label}`,
  recordUse: (part, r, item) => `${part.description}, for this ${r.label}: ${item.description}`,
  recordNoul: (part, r, item) => `Does user_request ask for this ${r.label} by name or by what it is? ${item.description}. Answer no for ${r.label}s user_request does not ask for.`,
  recordFamily: (part, r, names) => `${part.description}; one per ${r.label} that user_request names${names ? ` (the ${r.label}s: ${r.items.map((i) => i.name ?? i.description.split(/[:,]/)[0]).join(', ')})` : ''}`,
  slot: (part, r, n) => `${part.description}. Which ${r.label} does user_request name ${['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][n] ?? `as number ${n}`}? Choose none when user_request names fewer than ${n} ${r.label}${n > 1 ? 's' : ''} from this list.`,
  addSlot: (part, r, n) => `${part.description}. Which ${r.label} does user_request ask to add to the page ${['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][n] ?? `as number ${n}`}? Choose none when user_request asks to add fewer than ${n} ${r.label}${n > 1 ? 's' : ''} from this list.`,
  slotNone: (r, n) => `user_request names fewer than ${n} ${r.label}${n > 1 ? 's' : ''} from this list`,
  recordPick: (r) => `Which ${r.label} does user_request ask for? If it asks for several, any one of them.`,
  above: 'Which of these two elements comes higher on the page? Follow user_request: an element it wants at the top, first or above comes higher, one it wants below, under or after comes lower. When user_request does not say, the one it mentions first comes higher.',
  place: (d) => `Where does this element go: ${d}? Follow user_request: only the elements it wants side by side go in the row.`,
  // edits
  remove: (d) => `Does user_request ask to take this element off the page (remove, delete, hide or drop it, or swap it for a different element)? The element: ${d}. Changing its settings (time range, filter, category, sort, number of rows) keeps it on the page. Answer no for elements user_request does not mention.`,
  keep: 'This element is on the current page. Does user_request ask to take it off the page (remove, delete, hide, drop it, or swap it for a different element)? Changing its settings (time range, filter, category, sort, number of rows) is not removing it: keep it then.',
  keepCriteria: (d) => ({ keep: `Keep it on the page, with the same or changed settings: ${d}`, remove: `Take it off the page: ${d}` }),
  placeGate: 'Does user_request say where an element on the current page should go (at the top, at the bottom, first, last, above, below, next to another element)?',
  changeGate: (labels) => `Does user_request ask to change a setting of an element already on the page (such as its ${labels.join(', ')})?`,
  moveSlot: (n) => `Which element on the current page does user_request ask to move to another place (to the top, the bottom, above, below or next to another element)${n > 1 ? `, other than the ones already named` : ''}? ${n > 1 ? `Answer the ${['', 'first', 'second', 'third'][n] ?? n}` : 'Answer the first'} such element; an element named only as the reference point (the X in "next to X" or "below X") is not moved. Choose none when user_request asks to move fewer than ${n} element${n > 1 ? 's' : ''}.`,
  moveSlotNone: (n) => `user_request asks to move fewer than ${n} element${n > 1 ? 's' : ''} already on the page`,
  simplifyGate: 'Does user_request ask to make the page simpler, shorter, cleaner or less busy, without naming what to remove?',
  simplify: 'This element is on the current page. To make the page simpler, would you remove it as secondary to the page\'s main purpose? Keep the most important elements.',
  add: 'This element is not on the current page. Does user_request ask to add it or show it, by name or by what it shows? Answer omit when user_request does not ask for it.',
  move: (d) => `This element is on the current page: ${d}. Does user_request ask to move it to another place (to the top, the bottom, above, below, next to or beside another element)?`,
  where: (d, added) => `${added ? 'This element is being added to the page' : 'This element is being moved'}: ${d}. Where does user_request want it?${added ? ' Choose not_stated when user_request does not say where.' : ''}`,
  swap: 'Does user_request ask to replace or swap one element for a different element (instead of, in place of, swap X for Y)?',
  setParam: (d, p) => `This element is on the current page: ${d}. Does user_request ask to change its ${p.label}? Choose keep unless user_request asks for a different ${p.label}.`,
  keepParam: (p, cur) => `keep the current ${p.label}: ${cur}`,
  editAbove: 'Which of these two elements comes higher on the page after the change? Follow user_request: an element it wants at the top, first or above comes higher, one it wants at the bottom, below or under comes lower. When user_request does not say, keep the order of current_page, and a new element goes below the elements already on the page.',
}

// ---------- catalog helpers ----------
export const partById = (catalog, id) => catalog.parts.find((p) => p.id === id)
const itemOf = (part, key) => part.records?.items.find((i) => i.key === key)

/** what the model is told a node is (the part, a record, the params in force) */
export function describeNode(catalog, node) {
  const part = partById(catalog, node.part)
  if (!part) return node.part
  let d = part.description
  if (part.records) d += `, for ${itemOf(part, node.params?.[part.records.param])?.description ?? 'a record'}`
  for (const [name, p] of Object.entries(part.params || {})) {
    const v = node.params?.[name] ?? p.default
    d += `; ${p.label}: ${p.options[v] ?? v}`
  }
  return d
}

// ---------- params ----------
/**
 * One choice per param of each part. mode 'notStated' adds a not_stated option (→ the default);
 * mode 'threshold' asks without it and falls back to the default below `threshold` probability.
 */
export function paramQuestions(parts, { mode = 'notStated' } = {}) {
  const qs = {}
  for (const part of parts) for (const [name, p] of Object.entries(part.params || {})) {
    if (mode === 'notStated') chunkedChoice(qs, `param_${part.id}${sep}${name}`, W.param(part, p), { not_stated: W.notStated(p) }, p.options)
    else chunkedChoice(qs, `param_${part.id}${sep}${name}`, W.paramForced(part, p), {}, p.options)
  }
  return qs
}
/** answers → { [name]: value } for one part (only values that differ from the default are kept) */
export function readParams(part, answers, { threshold = 0.5 } = {}) {
  const out = {}
  for (const [name, p] of Object.entries(part.params || {})) {
    const a = readChunked(answers, `param_${part.id}${sep}${name}`, ['not_stated'])
    let v = a?.choice
    if (!v || v === 'not_stated' || !(v in p.options) || (a.probabilities?.[v] ?? 1) < threshold) v = p.default
    if (String(v) !== String(p.default)) out[name] = v
  }
  return out
}

// ---------- select (plain parts + record parts) ----------
/**
 * The select call. records: 'perRecord' (one omit/use choice per record), 'noul' (one noul per
 * record), 'pick' (a family choice + one choice over the records, read by probability), 'gated'
 * (family choice here; the per-record nouls in a second call, recordQuestions()).
 * params: 'inline' adds every param question here (read only for chosen parts); 'separate' leaves
 * them to configureQuestions() for the chosen parts.
 */
export function selectQuestions(catalog, { records = 'gated', params = 'separate', paramMode = 'notStated', parts = catalog.parts, slots = 4, familyNames = true, groups = false } = {}) {
  const qs = {}
  for (const part of parts) {
    const r = part.records
    if (groups && part.group) {
      // alternatives for the same content (cards for named records vs a filtered list): one choice
      const name = `use_g_${part.group}`
      if (!qs[name]) qs[name] = choice(W.select, { omit: W.omit, ...Object.fromEntries(parts.filter((p) => p.group === part.group).map((p) => [p.id, p.records ? W.recordFamily(p, p.records, familyNames) : p.description])) })
      if (r && records === 'slots') Object.assign(qs, slotQuestions(part, slots))
      continue
    }
    if (!r) qs[`use_${part.id}`] = choice(W.select, { omit: W.omit, use: part.description })
    else if (records === 'perRecord') for (const item of r.items) qs[`use_${part.id}${sep}${item.key}`] = choice(W.select, { omit: W.omit, use: W.recordUse(part, r, item) })
    else if (records === 'noul') for (const item of r.items) qs[`use_${part.id}${sep}${item.key}`] = noul(W.recordNoul(part, r, item))
    else if (records === 'slots') Object.assign(qs, slotQuestions(part, slots))
    else {
      qs[`use_${part.id}`] = choice(W.select, { omit: W.omit, use: W.recordFamily(part, r, familyNames) })
      if (records === 'pick') qs[`pick_${part.id}`] = choice(W.recordPick(r), Object.fromEntries(r.items.slice(0, 255).map((i) => [i.key, i.description])))
    }
  }
  if (params === 'inline') Object.assign(qs, paramQuestions(parts.filter((p) => p.params), { mode: paramMode }))
  qs.row = noul(W.row)
  return qs
}

/**
 * 'slots': K choices per record part, "the k-th <record> user_request names", each over none + the
 * records (≤ 254). Self-gating (none), one call, no per-record question.
 */
export function slotQuestions(part, k = 4, { adding = false } = {}) {
  const r = part.records
  const qs = {}
  const room = Math.min(254, LIMITS.maxOptions - 1)
  const chunks = []
  for (let i = 0; i < r.items.length; i += room) chunks.push(r.items.slice(i, i + room))
  // more records than one choice takes: K slots per chunk ("named first from this list"), read per chunk
  chunks.forEach((items, c) => {
    for (let n = 1; n <= k; n++) qs[`rec_${part.id}${sep}${n}${chunks.length > 1 ? `${sep}c${c}` : ''}`] = choice((adding ? W.addSlot : W.slot)(part, r, n), { none: W.slotNone(r, n), ...Object.fromEntries(items.map((i) => [i.key, i.description])) })
  })
  return qs
}

/** second call for 'gated' records, for each chosen record part: ask = 'choice' | 'noul' | 'slots' */
export function recordQuestions(catalog, partIds, { ask = 'choice', slots = 4 } = {}) {
  const qs = {}
  for (const id of partIds) {
    const part = partById(catalog, id)
    if (ask === 'slots') { Object.assign(qs, slotQuestions(part, slots)); continue }
    for (const item of part.records.items) {
      qs[`use_${part.id}${sep}${item.key}`] = ask === 'noul'
        ? noul(W.recordNoul(part, part.records, item))
        : choice(W.select, { omit: W.omit, use: W.recordUse(part, part.records, item) })
    }
  }
  return qs
}

/** the records chosen for one part, from per-record answers or slot answers */
function chosenRecords(part, answers, { atLeastOne = false } = {}) {
  const r = part.records
  const on = (a) => (a?.type === 'noul' ? a.noul >= 0.5 : a?.choice === 'use')
  const keys = r.items.filter((i) => on(answers[`use_${part.id}${sep}${i.key}`])).map((i) => i.key)
  const read = (suffix) => {
    for (let n = 1; answers[`rec_${part.id}${sep}${n}${suffix}`]; n++) {
      const a = answers[`rec_${part.id}${sep}${n}${suffix}`]
      // the group/family choice already said "these records": slot 1 is the best record even if none wins
      const best = Object.entries(a.probabilities || {}).filter(([k]) => k !== 'none').sort((x, y) => y[1] - x[1])[0]
      const c = n === 1 && atLeastOne && a.choice === 'none' && best ? best[0] : a.choice
      if (c === 'none') break // later slots are only read while earlier ones found something
      if (!keys.includes(c)) keys.push(c)
    }
  }
  read('')
  for (let c = 0; answers[`rec_${part.id}${sep}1${sep}c${c}`]; c++) read(`${sep}c${c}`)
  return keys
}

/**
 * select answers → nodes [{ part, params }] in catalog order (one per chosen record; slot order for
 * 'slots'), plus `needsRecords` (record parts chosen in a 'gated' select that still need
 * recordQuestions) and `row`. pickThreshold: for 'pick', every record with probability ≥ it is chosen.
 */
export function readSelection(catalog, answers, { records = 'gated', params = 'separate', threshold = 0.5, pickThreshold = 0.2, recordAnswers = null, parts = catalog.parts, groups = false, atLeastOne = false } = {}) {
  const nodes = []
  const needsRecords = []
  const on = (a) => (a?.type === 'noul' ? a.noul >= 0.5 : a?.choice === 'use')
  const used = (part) => (groups && part.group ? answers[`use_g_${part.group}`]?.choice === part.id : on(answers[`use_${part.id}`]))
  for (const part of parts) {
    const own = params === 'inline' ? readParams(part, answers, { threshold }) : {}
    const r = part.records
    if (!r) { if (used(part)) nodes.push({ part: part.id, params: own }); continue }
    let keys = []
    if (groups && part.group && records === 'slots') keys = used(part) ? chosenRecords(part, answers, { atLeastOne }) : []
    else if (records === 'perRecord' || records === 'noul' || records === 'slots') keys = chosenRecords(part, answers)
    else if (used(part)) {
      if (records === 'pick') {
        const p = answers[`pick_${part.id}`]?.probabilities || {}
        keys = r.items.filter((i) => (p[i.key] ?? 0) >= pickThreshold).map((i) => i.key)
      } else if (recordAnswers) keys = chosenRecords(part, recordAnswers, { atLeastOne })
      else needsRecords.push(part.id)
    }
    for (const k of keys) nodes.push({ part: part.id, params: { ...own, [r.param]: k } })
  }
  const row = nodes.length > 1 && (answers.row?.noul ?? 0) >= 0.5
  return { nodes, needsRecords, row }
}

/** the configure call ('separate' params): param questions for the chosen parts only */
export function configureQuestions(catalog, nodes, { paramMode = 'notStated' } = {}) {
  const ids = [...new Set(nodes.map((n) => n.part))]
  return paramQuestions(ids.map((id) => partById(catalog, id)).filter((p) => p.params), { mode: paramMode })
}
export function applyConfigure(catalog, nodes, answers, opts) {
  return nodes.map((n) => ({ ...n, params: { ...readParams(partById(catalog, n.part), answers, opts), ...n.params } }))
}

// ---------- order (pairwise) for a fresh composition ----------
const nodeId = (n) => (n.params && Object.keys(n.params).length ? `${n.part}${sep}${Object.values(n.params).join('_')}` : n.part)
export function orderQuestions(catalog, nodes, { row = false } = {}) {
  const qs = {}
  const ids = nodes.map(nodeId)
  if (row) nodes.forEach((n, i) => { qs[`place_${ids[i]}`] = choice(W.place(describeNode(catalog, n)), { page: 'On the page itself, full width, stacked vertically', row: 'In the row, side by side with the other row elements' }) })
  nodes.forEach((a, i) => nodes.slice(i + 1).forEach((b, j) => {
    qs[`above_${ids[i]}${sep}${sep}${ids[i + 1 + j]}`] = choice(W.above, { a: describeNode(catalog, a), b: describeNode(catalog, b) })
  }))
  return qs
}
/** answers → a layout with fresh keys n1.. (Borda order over the pairwise probabilities) */
export function readOrder(catalog, nodes, answers, { row = false } = {}) {
  const ids = nodes.map(nodeId)
  const wins = ids.map(() => 0)
  ids.forEach((a, i) => ids.slice(i + 1).forEach((b, j) => {
    const p = answers[`above_${a}${sep}${sep}${b}`]?.probabilities
    if (!p) return
    wins[i] += p.a ?? 0; wins[i + 1 + j] += p.b ?? 0
  }))
  const order = ids.map((_, i) => i).sort((x, y) => wins[y] - wins[x] || x - y)
  const inRow = row ? order.filter((i) => answers[`place_${ids[i]}`]?.choice === 'row') : []
  const layout = { root: 'n0', nodes: { n0: { part: 'page', slots: { default: [] } } } }
  let next = 1
  const put = (n) => { const k = `n${next++}`; layout.nodes[k] = { part: n.part, ...(n.params && Object.keys(n.params).length && { params: { ...n.params } }) }; return k }
  for (const i of order) {
    if (inRow.length >= 2 && inRow.includes(i)) {
      if (i !== inRow[0]) continue
      const rk = `n${next++}`
      layout.nodes[rk] = { part: 'row', slots: { default: inRow.map((j) => put(nodes[j])) } }
      layout.nodes.n0.slots.default.push(rk)
    } else layout.nodes.n0.slots.default.push(put(nodes[i]))
  }
  return layout
}

// ---------- layout helpers ----------
/** the page's leaves in order: [{ key, node, row }] (row = the row container's key or null) */
export function leaves(layout) {
  const out = []
  for (const k of layout.nodes[layout.root].slots.default) {
    const n = layout.nodes[k]
    if (n.part === 'row') for (const c of n.slots.default) out.push({ key: c, node: layout.nodes[c], row: k })
    else out.push({ key: k, node: n, row: null })
  }
  return out
}
/** a readable signature: `orders(status=paid) row(revenue,signups)`; rows sorted inside (left/right not scored) */
export function signature(layout) {
  if (!layout) return ''
  const one = (n) => n.part + (n.params && Object.keys(n.params).length ? `(${Object.entries(n.params).sort().map(([k, v]) => `${k}=${v}`).join(',')})` : '')
  return layout.nodes[layout.root].slots.default.map((k) => {
    const n = layout.nodes[k]
    return n.part === 'row' ? `row(${n.slots.default.map((c) => one(layout.nodes[c])).sort().join(',')})` : one(n)
  }).join(' ')
}
/** builds a layout from a signature-like list (for writing cases): ['a', ['b','c'], {part, params}] */
export function layoutOf(blocks) {
  const layout = { root: 'n0', nodes: { n0: { part: 'page', slots: { default: [] } } } }
  let next = 1
  const put = (b) => { const k = `n${next++}`; layout.nodes[k] = typeof b === 'string' ? { part: b } : { ...b }; return k }
  for (const b of blocks) {
    if (Array.isArray(b)) { const rk = `n${next++}`; layout.nodes[rk] = { part: 'row', slots: { default: [] } }; layout.nodes[rk].slots.default = b.map(put); layout.nodes.n0.slots.default.push(rk) }
    else layout.nodes.n0.slots.default.push(put(b))
  }
  return layout
}

// ---------- edits ----------
/**
 * Edit call 1 (one request): per node keep/remove, per node a move noul, per node param changes
 * (with a keep option), per absent part an add choice (+ its params inline), and the swap and row gates.
 * `simplify: true` adds a per-node noul for vague "make it simpler" requests.
 */
export function editQuestions(catalog, layout, { simplify = true, recordSlots = 2, placeGate = true, prompt = null, moveSlots = 2, changeGate = true } = {}) {
  const qs = {}
  const ls = leaves(layout)
  for (const { key, node } of ls) {
    const d = describeNode(catalog, node)
    qs[`remove_${key}`] = noul(W.remove(d))
    if (!moveSlots) qs[`move_${key}`] = noul(W.move(d))
    if (simplify) qs[`simpler_${key}`] = noul(`${W.simplify} The element: ${d}`) // read only when the `simpler` gate is on
    const part = partById(catalog, node.part)
    for (const [name, p] of Object.entries(part?.params || {})) {
      if (part.records && name === part.records.param) continue
      const cur = String(node.params?.[name] ?? p.default)
      chunkedChoice(qs, `set_${key}${sep}${name}`, W.setParam(d, p), { keep: W.keepParam(p, p.options[cur] ?? cur) }, Object.fromEntries(Object.entries(p.options).filter(([v]) => v !== cur)))
    }
  }
  // adds: plain parts not on the page, and record parts (more records can always be added); parts in
  // a `group` (alternatives for the same content) share one choice; record parts add K record slots
  const present = new Set(ls.map((l) => l.node.part))
  const addable = catalog.parts.filter((p) => p.records || !present.has(p.id))
  const groups = new Set()
  for (const part of addable) {
    if (part.group) {
      if (groups.has(part.group)) continue
      groups.add(part.group)
      qs[`add_g_${part.group}`] = choice(W.add, { omit: W.omit, ...Object.fromEntries(addable.filter((p) => p.group === part.group).map((p) => [p.id, p.records ? W.recordFamily(p, p.records, true) : p.description])) })
    } else if (!part.records) qs[`add_${part.id}`] = choice(W.add, { omit: W.omit, use: part.description })
    if (part.records) {
      // with the prompt, only records it names are offered for adding (narrowRecords)
      const offered = prompt ? narrowRecords({ parts: [part] }, prompt).parts[0] : part
      if (!offered) continue
      const onPage = new Set(ls.filter((l) => l.node.part === part.id).map((l) => String(l.node.params?.[part.records.param])))
      const items = offered.records.items.filter((i) => !onPage.has(i.key))
      if (items.length) Object.assign(qs, slotQuestions({ ...part, records: { ...part.records, items } }, recordSlots, { adding: true }))
    }
  }
  Object.assign(qs, paramQuestions(addable.filter((p) => p.params)))
  qs.swap = noul(W.swap)
  qs.row = noul(W.row)
  if (simplify) qs.simpler = noul(W.simplifyGate)
  if (placeGate) qs.placed = noul(W.placeGate)
  if (changeGate) {
    // the settings named in the gate are the labels of the params on the page
    const labels = [...new Set(ls.flatMap((l) => Object.entries(partById(catalog, l.node.part)?.params || {}).map(([, p]) => p.label)))]
    if (labels.length) qs.change = noul(W.changeGate(labels))
  }
  // moveSlots: "which element does user_request ask to move, first/second?" over the nodes + none,
  // instead of one move noul per node (a lookup, like record slots)
  for (let n = 1; n <= moveSlots; n++) {
    chunkedChoice(qs, `moved_${n}`, W.moveSlot(n), { none: W.moveSlotNone(n) }, Object.fromEntries(ls.map((l) => [l.key, describeNode(catalog, l.node)])))
  }
  return qs
}
export const editState = (catalog, layout, prompt) => ({
  user_request: prompt,
  current_page: leaves(layout).map((l) => describeNode(catalog, l.node)),
})

/** call-1 answers → a plan { removed, moved, added: [{ part, params }], params: { key: {...} }, swap, row } */
export function readEdit(catalog, layout, answers, { simplify = true, placeGate = true, atLeastOne = false, moveSlots = 2, changeGate = true } = {}) {
  const ls = leaves(layout)
  const plan = { removed: [], moved: [], added: [], params: {}, swap: (answers.swap?.noul ?? 0) >= 0.5, row: (answers.row?.noul ?? 0) >= 0.5 }
  const simpler = simplify && (answers.simpler?.noul ?? 0) >= 0.5
  const changing = !changeGate || (answers.change?.noul ?? 0) >= 0.5
  const slotMoved = []
  for (let n = 1; n <= moveSlots; n++) {
    const c = readChunked(answers, `moved_${n}`, ['none'])?.choice
    if (!c || c === 'none') break
    if (!slotMoved.includes(c)) slotMoved.push(c)
  }
  for (const { key, node } of ls) {
    const part = partById(catalog, node.part)
    const next = { ...(node.params || {}) }
    let changed = false
    for (const [name, p] of Object.entries(part?.params || {})) {
      const v = changing ? readChunked(answers, `set_${key}${sep}${name}`, ['keep'])?.choice : null
      if (v && v !== 'keep' && v in p.options) { changed = true; if (String(v) === String(p.default)) delete next[name]; else next[name] = v }
    }
    // a node whose settings change is kept ("show jackets instead" also reads as a swap)
    if (!changed && ((answers[`remove_${key}`]?.noul ?? 0) >= 0.5 || (simpler && (answers[`simpler_${key}`]?.noul ?? 0) >= 0.5))) { plan.removed.push(key); continue }
    if (moveSlots ? slotMoved.includes(key) : (answers[`move_${key}`]?.noul ?? 0) >= 0.5) plan.moved.push(key)
    if (changed) plan.params[key] = next
  }
  // the request places something but no node was flagged as moved: every remaining node gets a
  // `where` question in call 2, whose not_stated answer leaves it where it is
  if (placeGate && !plan.moved.length && (answers.placed?.noul ?? 0) >= 0.5) plan.moved = ls.map((l) => l.key).filter((k) => !plan.removed.includes(k))
  // a vague "simpler" must never empty the page
  if (plan.removed.length === ls.length && simpler) plan.removed = plan.removed.filter((k) => (answers[`remove_${k}`]?.noul ?? 0) >= 0.5)
  const present = new Set(ls.map((l) => l.node.part))
  for (const part of catalog.parts) {
    const asked = part.group ? answers[`add_g_${part.group}`]?.choice === part.id : answers[`add_${part.id}`]?.choice === 'use'
    if (!asked || (!part.records && present.has(part.id))) continue
    const own = readParams(part, answers)
    if (!part.records) plan.added.push({ part: part.id, params: own })
    else for (const k of chosenRecords(part, answers, { atLeastOne })) plan.added.push({ part: part.id, params: { ...own, [part.records.param]: k } })
  }
  return plan
}

/** the new keys for added parts (fresh, never reused) */
function freshKeys(layout, n) {
  let max = Math.max(0, ...Object.keys(layout.nodes).map((k) => Number(k.replace(/\D/g, '')) || 0))
  return Array.from({ length: n }, () => `n${++max}`)
}

/** a replace in place: one removed + one added + the swap gate (no question needed for its position) */
const replaceOf = (plan) => (plan.swap && plan.removed.length === 1 && plan.added.length === 1 ? { from: plan.removed[0] } : null)

/**
 * Edit call 2 (only when something is added (not in place), moved, or the row gate is on): pairwise
 * "which comes higher" between each placed element (moved/added) and every other node, and the
 * row placement when the row gate is on. Returns {} when no call is needed.
 */
export function editPlaceQuestionsPairwise(catalog, layout, plan) {
  const { stay, movers } = editSets(catalog, layout, plan)
  const qs = {}
  for (const m of movers) {
    for (const s of stay) qs[`above_${m.id}${sep}${sep}${s.id}`] = choice(W.editAbove, { a: m.d, b: s.d })
  }
  movers.forEach((a, i) => movers.slice(i + 1).forEach((b) => { qs[`above_${a.id}${sep}${sep}${b.id}`] = choice(W.editAbove, { a: a.d, b: b.d }) }))
  if (plan.row) for (const x of [...stay, ...movers]) qs[`place_${x.id}`] = choice(W.place(x.d), { page: 'On the page itself, full width, stacked vertically', row: 'In the row, side by side with the other row elements' })
  return qs
}
function editSets(catalog, layout, plan) {
  const rep = replaceOf(plan)
  const keys = freshKeys(layout, plan.added.length)
  const node = (key) => ({ ...layout.nodes[key], ...(plan.params[key] && { params: plan.params[key] }) })
  const stay = []
  const moved = []
  let inPlace = null
  leaves(layout).forEach((l, i) => {
    if (plan.removed.includes(l.key)) {
      // a replace: the new node is placed like a moved one, and by default takes the old one's place
      if (rep && rep.from === l.key) inPlace = { id: keys[0], key: keys[0], node: plan.added[0], row: null, origRow: l.row, ord: i, replaces: describeNode(catalog, layout.nodes[l.key]), d: describeNode(catalog, plan.added[0]) }
      return
    }
    const e = { id: l.key, key: l.key, node: node(l.key), row: l.row, ord: i, d: describeNode(catalog, node(l.key)) }
    if (plan.moved.includes(l.key)) moved.push({ ...e, origRow: l.row, row: null })
    else stay.push(e)
  })
  const movers = [...moved, ...(inPlace ? [inPlace] : plan.added.map((n, i) => ({ id: keys[i], key: keys[i], node: n, row: null, d: describeNode(catalog, n) })))]
  return { stay, movers }
}

/**
 * plan + call-2 answers → the new layout. Unchanged nodes keep their keys (and so their state);
 * a param change keeps the key; a replace or an add gets a fresh key. Stationary nodes keep their
 * relative order; a placed node goes at Σ P(stationary above it) among them.
 */
export function applyEditPairwise(catalog, layout, plan, answers = {}) {
  const { stay, movers } = editSets(catalog, layout, plan)
  const pos = new Map(stay.map((s, i) => [s.id, i + 0.5]))
  for (const m of movers) {
    let p = 0
    for (const s of stay) {
      const pr = answers[`above_${m.id}${sep}${sep}${s.id}`]?.probabilities
      p += pr ? pr.b ?? 0 : 1 // unanswered: below
    }
    let tie = 0
    for (const o of movers) if (o !== m) {
      const pr = answers[`above_${m.id}${sep}${sep}${o.id}`]?.probabilities ?? answers[`above_${o.id}${sep}${sep}${m.id}`]?.probabilities
      if (!pr) continue
      tie += answers[`above_${m.id}${sep}${sep}${o.id}`] ? pr.b ?? 0 : pr.a ?? 0
    }
    pos.set(m.id, p + tie * 1e-3)
  }
  const all = [...stay, ...movers].sort((a, b) => pos.get(a.id) - pos.get(b.id))
  // rows: with the gate on, the row is re-read; otherwise existing rows keep their stationary members
  const rowOf = new Map()
  if (plan.row) {
    const inRow = all.filter((x) => answers[`place_${x.id}`]?.choice === 'row')
    if (inRow.length >= 2) {
      const reuse = inRow.find((x) => x.row)?.row
      const rk = reuse || freshKeys(layout, plan.added.length + 1).at(-1)
      inRow.forEach((x) => rowOf.set(x.id, rk))
    }
    for (const x of all) if (!rowOf.has(x.id) && x.row && !inRow.length) rowOf.set(x.id, x.row) // gate on but nothing placed: keep rows
  } else for (const x of all) if (x.row) rowOf.set(x.id, x.row)
  const out = { root: layout.root, nodes: { [layout.root]: { ...layout.nodes[layout.root], slots: { default: [] } } } }
  const counts = {}
  for (const x of all) if (rowOf.has(x.id)) counts[rowOf.get(x.id)] = (counts[rowOf.get(x.id)] || 0) + 1
  // a row sits at its first stationary member (else its first member); its members gather there
  const anchor = {}
  for (const x of all) { const rk = rowOf.get(x.id); if (rk && counts[rk] >= 2 && stay.includes(x) && !anchor[rk]) anchor[rk] = x.id }
  for (const x of all) { const rk = rowOf.get(x.id); if (rk && counts[rk] >= 2 && !anchor[rk]) anchor[rk] = x.id }
  for (const x of all) {
    const rk = rowOf.get(x.id)
    const clean = { ...x.node }
    if (clean.params && !Object.keys(clean.params).length) delete clean.params
    out.nodes[x.key] = clean
    if (rk && counts[rk] >= 2) {
      if (anchor[rk] === x.id) { out.nodes[rk] = { part: 'row', slots: { default: all.filter((y) => rowOf.get(y.id) === rk).map((y) => y.key) } }; out.nodes[layout.root].slots.default.push(rk) }
    } else out.nodes[layout.root].slots.default.push(x.key)
  }
  return out
}

// ---------- edits: destinations (recommended) ----------
/**
 * Edit call 2, destination form: one choice per moved or added node (a replace in place needs none):
 * top / bottom / above:<key> / below:<key> / beside:<key> over the nodes that stay, plus not_stated
 * (an added node goes to the bottom, a moved one stays where it was). Returns {} when nothing moves.
 */
export function editWhereQuestions(catalog, layout, plan) {
  const { stay, movers } = editSets(catalog, layout, plan)
  const qs = {}
  for (const m of movers) {
    const added = !layout.nodes[m.key]
    const head = { not_stated: m.replaces ? `user_request does not say where: it takes the place of ${m.replaces}` : added ? 'user_request does not say where' : 'user_request does not ask to move it after all', top: 'At the very top of the page', bottom: 'At the very bottom of the page' }
    const criteria = {}
    for (const s of [...stay, ...movers.filter((o) => o !== m && layout.nodes[o.key])]) {
      criteria[`above:${s.key}`] = `Just above: ${s.d}`
      criteria[`below:${s.key}`] = `Just below: ${s.d}`
      criteria[`beside:${s.key}`] = `Next to, side by side with: ${s.d}`
    }
    chunkedChoice(qs, `where_${m.key}`, W.where(m.d, added), head, criteria)
  }
  return qs
}

/**
 * plan + call-2 answers → the new layout. Nodes that stay keep their keys, order and rows; a param
 * change keeps the key (the component keeps its state); an add or a replace gets a fresh key.
 */
export function applyEdit(catalog, layout, plan, answers = {}) {
  let { stay, movers } = editSets(catalog, layout, plan)
  // a moved node that another moved node is placed relative to is only the reference point ("put
  // the orders next to the revenue" flags both): it stays (of two naming each other, the less sure)
  const whereOf = (m) => readChunked(answers, `where_${m.key}`, ['not_stated'])
  const target = (m) => whereOf(m)?.choice?.split(':')[1]
  const conf = (m) => whereOf(m)?.confidence ?? 0
  const demote = movers.filter((m) => (layout.nodes[m.key] && movers.some((o) => o !== m && target(o) === m.key && !(target(m) === o.key && conf(m) > conf(o))))
    // not moved after all, or a replace with no stated place: back at its (or the old node's) place
    || (m.ord !== undefined && (whereOf(m)?.choice ?? 'not_stated') === 'not_stated'))
  if (demote.length) {
    stay = [...stay, ...demote.map((m) => ({ ...m, row: m.origRow }))].sort((a, b) => a.ord - b.ord)
    movers = movers.filter((m) => !demote.includes(m))
  }
  // blocks: [{ row: key|null, items: [entry] }], from the nodes that stay, keeping their rows
  const blocks = []
  for (const s of stay) {
    const last = blocks.at(-1)
    if (s.row && last?.row === s.row) last.items.push(s)
    else blocks.push({ row: s.row, items: [s] })
  }
  const indexOf = (key) => blocks.findIndex((b) => b.items.some((x) => x.key === key))
  const fresh = freshKeys(layout, plan.added.length + movers.length + 1).slice(plan.added.length)
  const origIndex = new Map(leaves(layout).map((l, i) => [l.key, i]))
  for (const m of movers) {
    const w = whereOf(m)?.choice ?? 'not_stated'
    const [op, target] = w.split(':')
    const t = target ? indexOf(target) : -1
    const one = { row: null, items: [m] }
    if (op === 'top') blocks.unshift(one)
    else if ((op === 'above' || op === 'below') && t >= 0) blocks.splice(op === 'above' ? t : t + 1, 0, one)
    else if (op === 'beside' && t >= 0) {
      const b = blocks[t]
      if (!b.row) b.row = fresh.shift()
      b.items.splice(b.items.findIndex((x) => x.key === target) + 1, 0, m)
    } else if (op === 'not_stated' && layout.nodes[m.key]) {
      // a moved node that is not moved after all: back before the first node that followed it
      const after = blocks.findIndex((b) => b.items.some((x) => origIndex.get(x.key) > origIndex.get(m.key)))
      blocks.splice(after < 0 ? blocks.length : after, 0, one)
    } else blocks.push(one) // bottom, or an added node with no stated place
  }
  const out = { root: layout.root, nodes: { [layout.root]: { ...layout.nodes[layout.root], slots: { default: [] } } } }
  for (const b of blocks) {
    for (const x of b.items) {
      const clean = { ...x.node }
      if (clean.params && !Object.keys(clean.params).length) delete clean.params
      out.nodes[x.key] = clean
    }
    if (b.row && b.items.length >= 2) {
      out.nodes[b.row] = { part: 'row', slots: { default: b.items.map((x) => x.key) } }
      out.nodes[layout.root].slots.default.push(b.row)
    } else for (const x of b.items) out.nodes[layout.root].slots.default.push(x.key)
  }
  return out
}

// ---------- record prefilter (app side, no model) ----------
const words = (t) => (t.toLowerCase().replace(/'s\b/g, '').match(/[a-z0-9]+/g) || [])
/**
 * Narrows each record part to the records the prompt names: every word of the item's `name` (or of
 * one of its `aliases`, e.g. a first name) is in the prompt; at most `max`. A record part with no
 * match is dropped for this prompt (requests by attribute go to list parts). For backends with a
 * small candidate limit (Ollama: 26) or catalogs over 254 records; with it, the group/family choice
 * may force slot 1 (`atLeastOne`). Lexical only: "the billing one" is not found.
 */
export function narrowRecords(catalog, prompt, { max = LIMITS.maxOptions - 1, minShare = 1 } = {}) {
  const have = new Set(words(prompt))
  const parts = []
  for (const part of catalog.parts) {
    if (!part.records) { parts.push(part); continue }
    const scored = part.records.items
      .map((i) => ({ i, s: Math.max(...[i.name ?? i.key, ...(i.aliases || [])].map((n) => { const w = words(n); return w.filter((x) => have.has(x)).length / (w.length || 1) })) }))
      .filter((x) => x.s >= minShare).sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.i)
    if (scored.length) parts.push({ ...part, records: { ...part.records, items: scored } })
  }
  return { ...catalog, parts }
}
