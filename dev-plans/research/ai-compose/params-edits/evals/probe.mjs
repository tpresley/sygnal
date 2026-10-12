import { decideRaw } from './client.mjs'
const r = await decideRaw({ user_request: 'Show the revenue chart for last quarter' }, {
  range: { type: 'choice', instructions: 'Which time range does user_request ask for the revenue chart?', criteria: { unspecified: 'user_request does not say', week: 'the last 7 days', month: 'the last 30 days', quarter: 'the last 3 months', year: 'the last 12 months' } },
  g: { type: 'noul', instructions: 'Does user_request mention a time range?' },
  g2: { type: 'noul', instructions: 'Does user_request mention a time range?', criteria: { true: 'it names a period', false: 'no period named' } },
  s: { type: 'score', instructions: 'How many rows does user_request want?', criteria: ['a few', 'some', 'many'] },
})
console.log(JSON.stringify(r, null, 1))
