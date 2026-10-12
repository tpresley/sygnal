import { decide } from './client.mjs'
const r = await decide({ user_request: 'revenue and churn side by side' }, {
  a: { type: 'choice', instructions: 'Does user_request ask for this?', criteria: { omit: 'not needed', use: 'KPI: churn rate' } },
  b: { type: 'noul', instructions: 'Does user_request ask for side by side?' },
  c: { type: 'score', instructions: 'How many KPIs?', criteria: ['zero', 'one', 'two', 'three'] },
})
console.log(JSON.stringify(r, null, 1))
