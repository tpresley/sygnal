import { decideRaw } from './client.mjs'
import * as L from '../params-edits.mjs'
import { OPS, SHOP } from './catalogs.mjs'
for (const [cat, p, keys] of [[SHOP, 'The promo banner above the full list of top customers', ['param_topCustomers__limit']], [SHOP, 'All of our top customers', ['param_topCustomers__limit']], [OPS, 'Revenue, signups and the revenue chart', ['use_tasks', 'use_revenue']]]) {
  const r = await decideRaw({ user_request: p }, L.selectQuestions(cat, { params: 'inline' }))
  for (const k of keys) console.log(p, k, JSON.stringify(r.answers[k].probabilities))
}
