import * as C from '../llm-composer.mjs'
import { BASE, EXT, BASE_CASES, EXT_CASES, EDIT_CASES } from './cases.mjs'
import { canonicalWant, scoreCase } from './score.mjs'
import { editRequest, readComposition, readOps } from './requests.mjs'
import assert from 'node:assert/strict'
for (const k of [...BASE_CASES]) { const L = C.stringToLayout(k.want); assert.equal(C.layoutToString(L), k.want.replace(/,/g, ',')) }
for (const k of EXT_CASES) console.log(canonicalWant(EXT, k.want))
console.log(JSON.stringify(C.stringToLayout('row(revenue,signups) revenueChart')))
// round trip through each encoding
for (const enc of ['tree', 'blocks']) for (const k of [...BASE_CASES]) {
  const L = C.stringToLayout(k.want); const r = C.layoutToReply(L, enc, BASE)
  const { layout, issues } = C.readLayout(BASE, enc, r); assert.equal(C.layoutToString(layout), C.layoutToString(L), enc + JSON.stringify(r) + JSON.stringify(issues))
}
// repairs
const bad = { children: [ { part: 'revenue' }, { part: 'revenue' }, { part: 'stock' }, { part: 'row', children: [ { part: 'tasks' } ] }, { part: 'row', children: [ { part: 'row', children: [{ part: 'churn' }, { part: 'signups' }] }, { part: 'weather' } ] } ] }
const r = C.readLayout(BASE, 'tree', bad); console.log(C.layoutToString(r.layout), r.issues)
const flat = { page: ['a', 'b', 'zz'], nodes: { a: { part: 'row', children: ['c', 'd', 'a'] }, b: { part: 'tickets' }, c: { part: 'churn' }, d: { part: 'signups' }, e: { part: 'tasks' } } }
const f = C.readLayout(BASE, 'flat', flat); console.log(C.layoutToString(f.layout), f.issues)
console.log(JSON.stringify(C.layoutSchema(EXT, 'blocks')).length, JSON.stringify(C.layoutSchema(EXT, 'tree')).length, JSON.stringify(C.layoutSchema(EXT, 'flat')).length)
console.log(C.systemPrompt(EXT, 'blocks'))
// edits
const e = editRequest(EXT, 'blocks', 'row(tasks,weather) feedback', 'x', 'ops'); console.log(e.messages[0].content)
const o = readOps(EXT, e.prev, JSON.stringify({ ops: [{ op: 'move', node: e.prev.nodes.n0.slots.default[1], to: 'n0', index: 0 }] }))
console.log(C.layoutToString(o.layout), JSON.stringify(o.layout), scoreCase(EXT, EDIT_CASES[8], o.layout, { prev: e.prev }))
const w = editRequest(EXT, 'blocks', 'row(tasks,weather) feedback', 'x', 'whole'); console.log(w.messages[0].content)
const wr = readComposition(EXT, 'blocks', JSON.stringify({ blocks: ['feedback', { row: ['tasks', 'weather'] }] }), { prev: w.prev }); console.log(JSON.stringify(wr.layout), scoreCase(EXT, EDIT_CASES[8], wr.layout, { prev: w.prev }))
// partial
const full = JSON.stringify({ blocks: [{ row: ['revenue', 'signups', 'churn'] }, { part: 'revenueChart', range: 'quarter' }] })
for (let i = 0; i <= full.length; i += 9) { const p = C.previewFromPartial(EXT, 'blocks', full.slice(0, i)); console.log(full.slice(0, i).padEnd(full.length), '→', p ? C.layoutToString(p) : '-') }
