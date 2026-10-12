#!/usr/bin/env node
// Writes evals/cases.json: the labelled cases as plain data, for scoring other backends (an LLM with
// structured output) on the same cases. Layouts are in the shared format; `expected: null` with
// `accept: 'simpler'` means any non-empty, strictly shorter page keeping the remaining nodes' keys
// and order. Record cases: `expected` is the node multiset (order not scored), as a layout.
import { writeFileSync } from 'node:fs'
import { OPS, SHOP, PM } from './catalogs.mjs'
import { PARAM_CASES, RECORD_CASES, EDIT_CASES, EDIT_HELDOUT, PM40, PM200 } from './cases.mjs'
import { layoutOf, leaves } from '../params-edits.mjs'

// the expected layout with the previous layout's keys: a node with the same identity (part + record)
// keeps its key, a row keeps its key when it keeps a member of the old row; new nodes get fresh keys
const ident = (n) => n.part + (n.params?.project ?? n.params?.member ?? n.params?.report ?? '')
function keyed(prev, want) {
  const prevLeaves = leaves(prev)
  const byId = new Map(prevLeaves.map((l) => [ident(l.node), l]))
  let next = Math.max(...Object.keys(prev.nodes).map((k) => Number(k.slice(1)))) + 1
  const fresh = () => `n${next++}`
  const out = { root: prev.root, nodes: { [prev.root]: { part: 'page', slots: { default: [] } } } }
  const put = (n) => { const k = byId.get(ident(n))?.key ?? fresh(); out.nodes[k] = n; return k }
  for (const k of want.nodes[want.root].slots.default) {
    const n = want.nodes[k]
    if (n.part !== 'row') { out.nodes[prev.root].slots.default.push(put(n)); continue }
    const members = n.slots.default.map((c) => want.nodes[c])
    const oldRow = members.map((m) => byId.get(ident(m))?.row).find(Boolean)
    const rk = oldRow ?? fresh()
    out.nodes[rk] = { part: 'row', slots: { default: members.map(put) } }
    out.nodes[prev.root].slots.default.push(rk)
  }
  return out
}

const nameOf = new Map([[OPS, 'ops'], [SHOP, 'shop'], [PM, 'pm'], [PM40, 'pm'], [PM200, 'pm200']])
const json = {
  note: 'Catalogs: parts with description, optional params { name: { label, default, ask?, options: { value: description } } }, optional records { param, label, items: [{ key, name, description }] }, optional group (alternatives for the same content: at most one per group is chosen per request). Layouts: { root, nodes: { key: { part, params?, slots? } } }; part "page" is the root container, part "row" a side-by-side container. A record node is { part, params: { [records.param]: key } }. Params equal to their default are omitted. Edits: nodes kept from previousLayout must keep their keys (a param change keeps the key; an add or a replacement gets a new key). Rows compare order-insensitively.',
  catalogs: { ops: OPS, shop: SHOP, pm: PM40, pm200: PM200 },
  params: PARAM_CASES.map(([cat, prompt, want]) => ({ catalog: nameOf.get(cat), prompt, expected: layoutOf(want) })),
  records: ['pm', 'pm200'].flatMap((c) => RECORD_CASES.map(([prompt, f]) => ({ catalog: c, prompt, expected: layoutOf(f(c === 'pm' ? PM40 : PM200)), orderScored: false }))),
  edits: [...EDIT_CASES.map((c) => ['tuned', ...c]), ...EDIT_HELDOUT.map((c) => ['heldout', ...c])].map(([set, cat, prev, prompt, want, accept]) => {
    const previousLayout = layoutOf(prev)
    return { catalog: nameOf.get(cat), set, previousLayout, prompt, expected: want ? keyed(previousLayout, layoutOf(want)) : null, ...(accept && { accept }) }
  }),
}
writeFileSync(new URL('./cases.json', import.meta.url), JSON.stringify(json, null, 1))
console.log(`cases.json: ${json.params.length} params, ${json.records.length} records, ${json.edits.length} edits`)
