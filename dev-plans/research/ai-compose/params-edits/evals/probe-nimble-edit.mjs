// logs call-1 answers of the edit encoding per case (for threshold/gate decisions on a backend)
import { decideRaw } from './client.mjs'
import * as L from '../params-edits.mjs'
import { EDIT_CASES } from './cases.mjs'
L.LIMITS.maxOptions = 26
const extra = {
  changeGate: L.noul('Does user_request ask to change a setting of an element already on the page (its time range, filter, category, rating, sort order or number of rows)?'),
}
for (const [catalog, prev, prompt] of EDIT_CASES) {
  const layout = L.layoutOf(prev)
  const r = await decideRaw(L.editState(catalog, layout, prompt), { ...L.editQuestions(catalog, layout, { prompt }), ...extra })
  const parts = Object.fromEntries(L.leaves(layout).map((l) => [l.key, l.node.part]))
  const out = []
  for (const [k, a] of Object.entries(r.answers)) {
    const node = parts[k.split('_')[1]?.split('__')[0]]
    if (a.type === 'noul' && a.noul >= 0.3) out.push(`${k}${node ? `(${node})` : ''}=${a.noul}`)
    if (k.startsWith('set_') && a.choice !== 'keep') out.push(`${k}(${node})=${a.choice}:${a.confidence}`)
    if (k.startsWith('add_') && a.choice !== 'omit') out.push(`${k}=${a.choice}:${a.confidence}`)
  }
  console.log(`${prompt}\n   ${out.join('  ')}  [${r.ms} ms]`)
}
