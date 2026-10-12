// PLAN-9 worker B: the research catalogs (test/p9-decisions-fixtures.js) in the PLAN-9 declaration
// format, normalized by the stand-in defineCatalog (test/p9-decisions-helpers.js; A's real one at
// merge), plus their labelled cases as Trees.
import * as F from './p9-decisions-fixtures.js'
import { defineCatalog, parseTree } from './p9-decisions-helpers.js'

const Stub = () => null

/** a structure catalog (research format) → a declaration: `slots` parts become containers, `resource` → `group` */
export function declareStructure(c) {
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

// 'number of rows' params are counts: declared as number params with bins (the same option keys
// and wording the research measured as an enum), so the number path is covered
const asNumber = (p) => (p.label === 'number of rows' ? { type: 'number', label: p.label, ask: p.ask, default: Number(p.default), bins: p.options } : p)

/** a params / records catalog (research format) → a declaration; `records` → a `from` param, maxUses 4 (the research's maxRecords) */
export function declareParams(c) {
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
      decl.maxUses = 4
    }
    parts[id] = decl
  }
  return { description: 'A dashboard page', parts }
}

export const STRUCTURE = Object.fromEntries(Object.entries(F.CATALOGS).map(([id, c]) => [id, {
  id,
  catalog: defineCatalog(declareStructure(c)),
  cases: c.cases.map(([prompt, want]) => ({ prompt, want: parseTree(want), text: want })),
}]))

const block = (b) => (typeof b === 'string' ? { part: b } : Array.isArray(b) ? { part: 'row', children: b.map(block) } : { part: b.part, ...(b.params && Object.keys(b.params).length && { params: numbers(b.params) }) })
const numbers = (params) => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, k === 'limit' && v !== '3' && v !== '30' ? Number(v) : v]))

export const OPS = defineCatalog(declareParams(F.OPS))
export const SHOP = defineCatalog(declareParams(F.SHOP))
export const PM40 = defineCatalog(declareParams(F.pm({ nProjects: 40 })))
export const PM200 = defineCatalog(declareParams(F.pm({ nProjects: 200 })))

export const PARAM_CASES = F.PARAM_CASES.map(([c, prompt, want]) => ({ catalog: c === F.OPS ? OPS : SHOP, prompt, want: want.map(block) }))
// records: reportList's limit is a plain enum ('3' / '10' / '30'), kept as strings
export const RECORD_CASES = F.RECORD_CASES.map(([prompt, want]) => ({ prompt, want: want().map(block) }))
