// No-model checks of the pure functions: node evals/unit.mjs
import assert from 'node:assert/strict'
import * as L from '../params-edits.mjs'
import { OPS, PM } from './catalogs.mjs'

const A = L.layoutOf(['revenue', 'revenueChart', 'orders', 'tickets']) // n1..n4
const noul = (v) => ({ type: 'noul', noul: v })
const ch = (c, conf = 1) => ({ type: 'choice', choice: c, confidence: conf })

// param change keeps the key; swap in place gets a fresh key at the old place
{
  const plan = L.readEdit(OPS, A, { change: noul(0.9), set_n2__range: ch('quarter'), remove_n2: noul(0.9) })
  assert.deepEqual(plan.removed, []) // a node whose settings change is kept
  const out = L.applyEdit(OPS, A, plan, {})
  assert.equal(L.signature(out), 'revenue revenueChart(range=quarter) orders tickets')
  assert.deepEqual(out.nodes.n0.slots.default, ['n1', 'n2', 'n3', 'n4'])
}
{
  const plan = L.readEdit(OPS, A, { remove_n2: noul(0.95), add_tasks: ch('use'), swap: noul(0.9) })
  const out = L.applyEdit(OPS, A, plan, {})
  assert.equal(L.signature(out), 'revenue tasks orders tickets')
  assert.deepEqual(out.nodes.n0.slots.default, ['n1', 'n5', 'n3', 'n4'])
}
// move below another node; beside makes a row at the anchor; the anchor flagged as moved stays
{
  const plan = L.readEdit(OPS, A, { moved_1: ch('n2'), moved_2: ch('none') })
  assert.equal(L.signature(L.applyEdit(OPS, A, plan, { where_n2: ch('below:n3') })), 'revenue orders revenueChart tickets')
}
{
  const plan = L.readEdit(OPS, A, { move_n3: noul(0.95), move_n1: noul(0.6) }, { moveSlots: 0 })
  const out = L.applyEdit(OPS, A, plan, { where_n3: ch('beside:n1', 0.9), where_n1: ch('beside:n2', 0.4) })
  assert.equal(L.signature(out), 'row(orders,revenue) revenueChart tickets')
  assert.deepEqual(out.nodes[out.nodes.n0.slots.default[0]].slots.default, ['n1', 'n3'])
}
// removing from a row of three keeps the row (and its key); from a row of two unwraps it
{
  const B = L.layoutOf([['revenue', 'signups', 'churn'], 'tasks']) // row n1: n2 n3 n4; n5
  const out = L.applyEdit(OPS, B, L.readEdit(OPS, B, { remove_n4: noul(0.9) }), {})
  assert.equal(L.signature(out), 'row(revenue,signups) tasks')
  assert.ok(out.nodes.n1 && out.nodes.n1.part === 'row')
}
// without the change gate, set_ answers are ignored
{
  const plan = L.readEdit(OPS, A, { change: noul(0.1), set_n2__range: ch('week'), remove_n2: noul(0.99) })
  assert.deepEqual(plan.removed, ['n2'])
  assert.deepEqual(plan.params, {})
}
// record nodes: slots, dedupe, none stops
{
  const part = PM.parts.find((p) => p.id === 'project')
  const qs = L.slotQuestions(part, 3)
  assert.equal(Object.keys(qs).length, 3)
  const sel = L.readSelection(PM, { use_g_projects: ch('project'), rec_project__1: ch('atlas'), rec_project__2: ch('atlas'), rec_project__3: ch('cedar') }, { records: 'slots', groups: true })
  assert.deepEqual(sel.nodes.map((n) => n.params.project), ['atlas', 'cedar'])
}
// params: not_stated → default (omitted); a value equal to the default is omitted
{
  const part = OPS.parts.find((p) => p.id === 'orders')
  assert.deepEqual(L.readParams(part, { param_orders__status: ch('not_stated'), param_orders__limit: ch('25') }), { limit: '25' })
  assert.deepEqual(L.readParams(part, { param_orders__status: ch('all') }), {})
}
console.log('unit: ok')
