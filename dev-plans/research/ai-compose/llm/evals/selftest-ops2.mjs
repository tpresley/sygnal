import { stringToLayout, layoutToTree, repairTree, treeToLayout, applyOpsV2, layoutToString, describeLayout, opsSchemaV2, checkSchema } from '../llm-composer.mjs'
import { EXT } from './cases.mjs'
import assert from 'node:assert/strict'
const P = (s) => treeToLayout(repairTree(EXT, layoutToTree(stringToLayout(s)), []).tree)
const prev = P('revenue revenueChart orders tickets')
console.log(describeLayout(prev))
const t = (ops, want) => { const r = applyOpsV2(EXT, prev, ops); const sch = opsSchemaV2(EXT, prev); assert.deepEqual(checkSchema(sch, { ops }), []); console.log(layoutToString(r.layout), r.issues); assert.equal(layoutToString(r.layout).replace(/\{[^}]*\}/g, ''), want) }
t([{ op: 'move', node: 'n4', where: 'top' }], 'tickets revenue revenueChart orders')
t([{ op: 'move', node: 'n3', where: 'right of n1' }], 'row(revenue,orders) revenueChart tickets')
t([{ op: 'replace', node: 'n2', part: 'tasks' }], 'revenue tasks orders tickets')
t([{ op: 'move', node: 'n2', where: 'below n3' }], 'revenue orders revenueChart tickets')
t([{ op: 'add', part: 'weather', where: 'bottom' }, { op: 'setParams', node: 'n2', params: { range: 'quarter' } }], 'revenue revenueChart orders tickets weather')
const prev2 = P('row(revenue,signups,churn) revenueChart')
const r = applyOpsV2(EXT, prev2, [{ op: 'remove', node: 'n3' }, { op: 'remove', node: 'n4' }]); console.log(layoutToString(r.layout), JSON.stringify(r.layout))
