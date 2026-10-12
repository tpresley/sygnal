// PLAN-9 E-3: the labelled sets of `npm run test:compose-live`, built on the research data copied
// into ./data (dev-plans/research/ai-compose/{structure,params-edits,llm}/evals, unchanged but for
// an import path) and the example's catalog (examples/ai-compose/src/catalog.js, as plain data).
// The catalogs go through the real defineCatalog from the built 'sygnal/ai' (dist). Adapters as in
// test/p9-decisions-catalogs.js and test/p9-llm-helpers.js.
import { defineCatalog, fromTree, toTree } from 'sygnal/ai'
import { CATALOGS } from './data/structure-catalogs.mjs'
import { OPS, SHOP } from './data/params-catalogs.mjs'
import { PARAM_CASES, RECORD_CASES, EDIT_CASES, EDIT_HELDOUT, PM40, PM200 } from './data/params-cases.mjs'
import { BASE, BASE_CASES, EXT, EDIT_CASES as LLM_EDITS } from './data/llm-cases.mjs'

const Stub = () => null

// ---------- notations → trees ----------
/** the structure notation: 'page(a row(b c) tabs[overview: d | billing: e])' → a tree; '' → [] */
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

/** the llm notation: 'row(a,b) c{range=quarter}' → a tree */
export function tree(s) {
  let i = 0
  const ws = () => { while (s[i] === ' ' || s[i] === ',') i++ }
  const ident = () => { const m = /^[A-Za-z0-9_:-]+/.exec(s.slice(i)); i += m[0].length; return m[0] }
  const node = () => {
    const n = { part: ident() }
    if (s[i] === '{') {
      const end = s.indexOf('}', i)
      n.params = Object.fromEntries(s.slice(i + 1, end).split(',').filter(Boolean).map((kv) => kv.split('=')))
      i = end + 1
    }
    if (s[i] === '(') {
      i++
      const kids = []
      while (s[i] !== ')') { ws(); kids.push(node()); ws() }
      i++
      n.children = kids
    }
    return n
  }
  const kids = []
  ws()
  while (i < s.length) { kids.push(node()); ws() }
  return kids
}

// the params-edits blocks: 'part', [row members], { part, params }; a number param's value as a number
const numbers = (params) => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, k === 'limit' && v !== '3' && v !== '30' ? Number(v) : v]))
const block = (b) => (typeof b === 'string' ? { part: b } : Array.isArray(b) ? { part: 'row', children: b.map(block) } : { part: b.part, ...(b.params && Object.keys(b.params).length && { params: numbers(b.params) }) })
const blocks = (list) => (list || []).map(block)

// ---------- catalogs ----------
/** a structure catalog (research format) → a declaration */
function declareStructure(c) {
  const parts = {}
  const containers = {}
  for (const p of c.parts) {
    const { id, slots, auto, arranged, minSlots, resource, ...rest } = p
    void auto
    if (slots) containers[id] = { slots, description: p.description, ...(arranged && { arranged }), ...(minSlots && { minSlots }), ...(p.in && { in: p.in }), render: Stub }
    else parts[id] = { component: Stub, ...rest, ...(resource && { group: resource }) }
  }
  if (!c.rows) containers.row = false
  return { description: c.root.description, guidance: c.guidance, limits: c.limits, categories: c.categories, parts, containers }
}

const asNumber = (p) => (p.label === 'number of rows' ? { type: 'number', label: p.label, ask: p.ask, default: Number(p.default), bins: p.options } : p)
/** a params / records catalog (research format) → a declaration */
function declareParams(c) {
  const parts = {}
  for (const p of c.parts) {
    const { id, records, params, ...rest } = p
    const decl = { component: Stub, ...rest }
    if (params) decl.params = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, asNumber(v)]))
    if (records) {
      decl.params = {
        ...(decl.params || {}),
        [records.param]: { label: records.label, from: () => records.items.map((i) => ({ value: i.key, name: i.name, aliases: i.aliases, description: i.description })) },
      }
    }
    parts[id] = decl
  }
  return defineCatalog({ description: 'A dashboard page', parts })
}

/** an llm research catalog → a catalog (as test/p9-llm-helpers.js fromResearch) */
function fromResearch(rc) {
  const parts = {}, containers = {}
  const paramsOf = (p) => {
    const params = {}
    for (const [n, d] of Object.entries(p.params || {})) {
      if (d.options) params[n] = { options: d.options, default: d.default, label: d.description }
      else if (d.text) params[n] = { type: 'text', maxLength: d.text.maxLength, default: d.default, label: d.description }
    }
    return params
  }
  const boxes = rc.parts.filter((p) => p.container && p.container.direction !== 'row').map((p) => p.id)
  for (const p of rc.parts) {
    if (p.container) {
      const d = p.container.slots.default || {}
      containers[p.id] = {
        description: p.description, slots: Object.fromEntries(Object.keys(p.container.slots).map((s) => [s, null])), direction: p.container.direction,
        params: paramsOf(p),
        ...(p.container.direction !== 'row' && { min: d.min, max: d.max, accepts: d.accepts }),
      }
      continue
    }
    parts[p.id] = { description: p.description, params: paramsOf(p), in: ['page', ...boxes] }
  }
  return defineCatalog({ parts, containers, limits: { maxDepth: (rc.maxDepth ?? 2) - 1 } })
}
/** a params-edits catalog in the llm research format (llm/evals/a2.mjs toCatalog) */
const ROW = { id: 'row', description: 'Row: shows its parts side by side, left to right', container: { direction: 'row', slots: { default: { min: 2, max: 4, accepts: 'leaves' } } } }
const toLlmCatalog = (c) => ({
  root: 'page', maxDepth: 2, name: c.id,
  parts: [...c.parts.map((p) => ({ id: p.id, description: p.description, ...(p.params && { params: Object.fromEntries(Object.entries(p.params).map(([n, d]) => [n, { description: d.label, options: d.options, default: d.default }])) }) })), ROW],
})
const item = (b) => typeof b === 'string' ? b : Array.isArray(b) ? `row(${b.map(item).join(',')})` : `${b.part}${b.params ? `{${Object.entries(b.params).map(([k, v]) => `${k}=${v}`).join(',')}}` : ''}`
const blocksToString = (list) => list.map(item).join(' ')

/** examples/ai-compose/src/catalog.js, as data (stub components) */
const EXAMPLE = defineCatalog({
  parts: {
    revenue: { component: Stub, description: "Revenue (KPI card: this month's revenue total as one number, $48.2k)" },
    signups: { component: Stub, description: 'Signups (KPI card: new signups this week, 312)' },
    churn: { component: Stub, description: 'Churn (KPI card: the customer churn rate this month, 2.1%)' },
    revenueChart: {
      component: Stub,
      description: 'Revenue chart (line chart of the revenue trend over time)',
      params: { range: { label: 'time range', default: 'year', options: { year: 'the last 12 months (this year)', quarter: 'the last 3 months (this quarter)', month: 'the last 30 days (this month)' } } },
    },
    orders: {
      component: Stub,
      description: 'Orders (table of the most recent orders: customer, amount, status)',
      params: {
        status: { label: 'order status', default: 'any', options: { any: 'orders of every status', paid: 'paid orders', pending: 'pending orders (not paid yet)', refunded: 'refunded orders' } },
        limit: { type: 'number', label: 'how many rows', default: 5, min: 1, max: 8, bins: { 3: 'a few (top 3)', 5: 'five (the default)', 8: 'all of the recent orders' } },
      },
    },
    tickets: { component: Stub, description: 'Tickets (list of open support tickets, by priority)', params: { priority: { label: 'priority', default: 'any', options: { any: 'every open ticket', high: 'only high-priority (urgent) tickets' } } } },
    tasks: { component: Stub, description: "Tasks (checklist of the user's tasks for today)" },
    weather: { component: Stub, description: "Weather (today's weather forecast for the office city)" },
    feedback: { component: Stub, description: 'Feedback form (a form to send product feedback: a message and a send button)' },
  },
})
// examples/ai-compose/scripts/try-prompts.mjs FLAT + PARAMS, in the llm notation
const EXAMPLE_CASES = [
  ['Sales overview: revenue, signups and churn side by side, then the revenue chart', 'row(revenue,signups,churn) revenueChart'],
  ['My morning: the weather and my tasks for today', 'weather tasks'],
  ['Support desk: open tickets first, then recent orders', 'tickets orders'],
  ['A feedback form at the top, and the open tickets below it', 'feedback tickets'],
  ['Show me the stock price of Apple', ''],
  ['Put my tasks beside the weather, and a feedback form under them', 'row(tasks,weather) feedback'],
  ['Recent orders, the revenue chart, and below that a feedback form', 'orders revenueChart feedback'],
  ['The revenue chart, with the orders table above it and the tickets at the very bottom', 'orders revenueChart tickets'],
  ['How are sales doing?', 'revenue revenueChart'],
  ['What is on my plate today?', 'tasks'],
  ['Churn and signups next to each other', 'row(churn,signups)'],
  ['The revenue chart for this quarter', 'revenueChart{range=quarter}'],
  ['Only the urgent tickets', 'tickets{priority=high}'],
  ['The top 3 pending orders', 'orders{limit=3,status=pending}'],
  ['Revenue over the last 30 days, then the refunded orders', 'revenueChart{range=month} orders{status=refunded}'],
]

// ---------- scoring ----------
const isDefault = (catalog, part, k, v) => {
  const d = catalog.get(part)?.params?.[k]
  if (!d) return false
  if (d.type === 'text' || d.type === 'list') return true // free text: not scored (enum params only)
  return d.default !== undefined && String(v) === String(d.default)
}
/** a tree's signature: non-default params sorted; `rows: 'sorted'` compares rows order-insensitively; `bag` sorts everything */
export function signature(catalog, t, { rows = 'ordered', bag = false } = {}) {
  const one = (n) => {
    const ps = Object.entries(n.params || {}).filter(([k, v]) => !isDefault(catalog, n.part, k, v)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`)
    const head = n.part + (ps.length ? `{${ps.join(',')}}` : '')
    if (!n.children) return head
    if (Array.isArray(n.children)) {
      const kids = n.children.map(one)
      if (n.part === 'row' && rows === 'sorted') kids.sort()
      return `${head}(${kids.join(' ')})`
    }
    return `${head}[${Object.entries(n.children).map(([s, l]) => `${s}: ${l.map(one).join(' ')}`).join(' | ')}]`
  }
  if (bag) return leafIds(catalog, t).sort().join(' ')
  return t.map(one).join(' ')
}
/** the leaves of a tree: part + its record value (identity across edits), non-default params */
export function leafIds(catalog, t, { params = true } = {}) {
  const out = []
  const walk = (n) => {
    if (n.children) return (Array.isArray(n.children) ? n.children : Object.values(n.children).flat()).forEach(walk)
    if (!catalog.parts[n.part]) return
    const ps = params ? Object.entries(n.params || {}).filter(([k, v]) => !isDefault(catalog, n.part, k, v)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`) : []
    out.push(n.part + (ps.length ? `{${ps.join(',')}}` : ''))
  }
  t.forEach(walk)
  return out
}
/** a target tree as the catalog finishes it (the same normalization a reply gets) */
export const normalize = (catalog, t, previous) => toTree(catalog.finish(fromTree(catalog, t, previous)))
export const layoutOf = (catalog, t, previous) => catalog.finish(fromTree(catalog, t, previous))

/** layout leaves: key → identity (part + record value) */
export function leafKeys(catalog, layout) {
  const out = {}
  for (const [k, n] of Object.entries(layout?.nodes || {})) {
    const p = catalog.parts[n.part]
    if (!p) continue
    out[k] = n.part + (p.record ? `:${n.params?.[p.record]}` : '')
  }
  return out
}
/** the research's key rule: a leaf whose identity was on the previous page keeps its key */
export function keyErrors(catalog, previous, next) {
  const before = new Map(Object.entries(leafKeys(catalog, previous)).map(([k, id]) => [id, k]))
  return Object.entries(leafKeys(catalog, next)).filter(([k, id]) => before.has(id) && before.get(id) !== k).length
}
/** 'simpler': a shorter, non-empty page of previous leaves in the same order */
export function simplerOk(catalog, previous, next) {
  const keysOf = (l) => { const lk = leafKeys(catalog, l); const ord = []; const walk = (k) => { const n = l.nodes[k]; if (!n) return; if (lk[k]) ord.push(k); for (const s of Object.values(n.slots || {})) s.forEach(walk) }; walk(l.root); return ord }
  const a = keysOf(previous), b = keysOf(next)
  return b.length > 0 && b.length < a.length && b.every((k) => a.includes(k)) && b.every((k, i) => i === 0 || a.indexOf(k) > a.indexOf(b[i - 1]))
}

// ---------- the sets ----------
const structure = () => Object.entries(CATALOGS).flatMap(([id, c]) => {
  const catalog = defineCatalog(declareStructure(c))
  return c.cases.map(([prompt, want], i) => ({ id: `${id}-${i + 1}`, catalog, prompt, want: parseTree(want), group: id }))
})
const opsCatalog = () => defineCatalog(declareStructure(CATALOGS.ops))

const paramCats = new Map()
const paramsCatalog = (c) => { if (!paramCats.has(c)) paramCats.set(c, declareParams(c)); return paramCats.get(c) }
const llmCats = new Map()
const llmCatalog = (rc) => { if (!llmCats.has(rc)) llmCats.set(rc, fromResearch(rc)); return llmCats.get(rc) }
const a2Cats = new Map()
const a2 = (c) => { if (!a2Cats.has(c)) a2Cats.set(c, toLlmCatalog(c)); return llmCatalog(a2Cats.get(c)) }

const dashboardRC = () => ({ root: 'page', maxDepth: 2, parts: [...CATALOGS.dashboard.parts.map(({ id, description }) => ({ id, description })), ROW] })
const fromA1 = (s) => !s ? '' : s.replace(/^page\(/, '').replace(/\)$/, '').replace(/\(([^()]*)\)/g, (_, x) => `(${x.trim().split(/\s+/).join(',')})`)

/**
 * Each set: { name, kind: 'compose' | 'edit', score: { rows, bag }, cases: [{ id, catalog, prompt,
 * want (tree, or null with accept), previous? (tree), accept? }] }, per backend kind
 */
export function setsFor(kind) {
  if (kind === 'decisions') {
    const flatCat = defineCatalog(declareStructure({ root: { description: 'A dashboard page' }, rows: true, parts: CATALOGS.dashboard.parts }))
    return [
      { name: 'flat', note: 'the dashboard parts, the example prompts (llm/evals BASE_CASES)', cases: BASE_CASES.map((k) => ({ id: k.id, catalog: flatCat, prompt: k.prompt, want: tree(k.want) })) },
      { name: 'example', note: 'examples/ai-compose catalog: 11 flat + 4 params', cases: EXAMPLE_CASES.map(([prompt, w], i) => ({ id: `example-${i + 1}`, catalog: EXAMPLE, prompt, want: tree(w) })) },
      { name: 'structure', note: '5 catalogs (dashboard, settings, crm, landing, ops)', cases: structure() },
      { name: 'params', note: 'OPS + SHOP enum / number params', score: { rows: 'sorted' }, cases: PARAM_CASES.map(([c, prompt, w], i) => ({ id: `params-${i + 1}`, catalog: paramsCatalog(c), prompt, want: blocks(w) })) },
      { name: 'records', note: 'PM with 40 and 200 projects; the node multiset', score: { bag: true }, cases: [[PM40, 40], [PM200, 200]].flatMap(([c, n]) => RECORD_CASES.map(([prompt, w], i) => ({ id: `records${n}-${i + 1}`, catalog: paramsCatalog(c), prompt, want: blocks(w(c)) }))) },
      { name: 'edits', note: 'tuned (params-edits EDIT_CASES)', edit: true, score: { rows: 'sorted' }, cases: EDIT_CASES.map(([c, prev, prompt, w, accept], i) => ({ id: `edit-${i + 1}`, catalog: paramsCatalog(c), prompt, previous: blocks(prev), want: w ? blocks(w) : null, accept })) },
      { name: 'edits-heldout', note: 'held-out (EDIT_HELDOUT)', edit: true, score: { rows: 'sorted' }, cases: EDIT_HELDOUT.map(([c, prev, prompt, w, accept], i) => ({ id: `heldout-${i + 1}`, catalog: paramsCatalog(c), prompt, previous: blocks(prev), want: w ? blocks(w) : null, accept })) },
    ]
  }
  // compose.llm(): the llm research sets (base, a1 dashboard, a2 params, ops2 edits) + the example
  const dash = llmCatalog(dashboardRC())
  return [
    { name: 'flat', note: 'llm/evals BASE (11)', cases: BASE_CASES.map((k) => ({ id: k.id, catalog: llmCatalog(BASE), prompt: k.prompt, want: tree(k.want) })) },
    { name: 'example', note: 'examples/ai-compose catalog: 11 flat + 4 params', cases: EXAMPLE_CASES.map(([prompt, w], i) => ({ id: `example-${i + 1}`, catalog: EXAMPLE, prompt, want: tree(w) })) },
    { name: 'dashboard', note: 'a1: the structure dashboard (15)', cases: CATALOGS.dashboard.cases.map(([prompt, w], i) => ({ id: `a1-dashboard-${i + 1}`, catalog: dash, prompt, want: tree(fromA1(w)) })) },
    { name: 'params', note: 'a2: OPS + SHOP enum params (20)', cases: PARAM_CASES.map(([c, prompt, w], i) => ({ id: `a2-params-${i + 1}`, catalog: a2(c), prompt, want: tree(blocksToString(w)) })) },
    { name: 'edits', note: 'ops2: EXT edits (10) + a2 edits (21)', edit: true, cases: [
      ...LLM_EDITS.map((k) => ({ id: k.id, catalog: llmCatalog(EXT), prompt: k.prompt, previous: tree(k.prev), want: tree(k.want) })),
      ...EDIT_CASES.filter(([, , , w]) => w).map(([c, prev, prompt, w], i) => ({ id: `a2-edit-${i + 1}`, catalog: a2(c), prompt, previous: tree(blocksToString(prev)), want: tree(blocksToString(w)) })),
    ] },
  ]
}

export { opsCatalog, CATALOGS }
