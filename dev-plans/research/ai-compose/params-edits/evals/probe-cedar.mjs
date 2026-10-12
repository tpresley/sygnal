import { decideRaw } from './client.mjs'
import * as L from '../params-edits.mjs'
import { PM } from './catalogs.mjs'
const lay = L.layoutOf([{ part: 'project', params: { project: 'atlas' } }, { part: 'project', params: { project: 'borealis' } }, 'burndown'])
for (const prompt of ['Add the Cedar project', 'Swap Borealis for Juniper']) for (const narrow of [true, false]) {
  const r = await decideRaw(L.editState(PM, lay, prompt), L.editQuestions(PM, lay, { prompt: narrow ? prompt : null }))
  console.log(prompt, narrow, JSON.stringify(r.answers.add_g_projects.probabilities), r.answers.rec_project__1.choice, JSON.stringify(r.answers.rec_project__1.probabilities).slice(0, 80))
}
