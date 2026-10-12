import { decideRaw } from './client.mjs'
import * as L from '../params-edits.mjs'
import { EDIT_CASES, EDIT_HELDOUT } from './cases.mjs'
const pick = process.argv.slice(2)
for (const [catalog, prev, prompt] of [...EDIT_CASES, ...EDIT_HELDOUT].filter((c) => pick.some((p) => c[2].startsWith(p)))) {
  const layout = L.layoutOf(prev)
  const r = await decideRaw(L.editState(catalog, layout, prompt), L.editQuestions(catalog, layout))
  console.log(prompt)
  for (const [k, a] of Object.entries(r.answers)) if (!k.startsWith('add_') && !k.startsWith('param_')) console.log('  ', k, a.choice ?? a.noul, JSON.stringify(a.probabilities ?? ''))
  const plan = L.readEdit(catalog, layout, r.answers)
  console.log('  plan', JSON.stringify(plan))
  const qs = L.editWhereQuestions(catalog, layout, plan)
  if (Object.keys(qs).length) { const r2 = await decideRaw(L.editState(catalog, layout, prompt), qs); for (const [k, a] of Object.entries(r2.answers)) console.log('  ', k, a.choice, a.confidence) }
}
