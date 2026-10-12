// Every labelled set the frontier pack carries: { set, cases: [{ id, catalogName, catalog, prompt, want, prev?, text? }] }
import { BASE, EXT, BASE_CASES, EXT_CASES, EDIT_CASES } from './cases.mjs'
import { loadA1 } from './a1.mjs'
import { loadA2 } from './a2.mjs'

export async function allSets() {
  const sets = [
    { set: 'base', edit: false, cases: BASE_CASES.map((k) => ({ ...k, catalogName: 'base', catalog: BASE })) },
  ]
  for (const id of ['dashboard', 'ops']) { const a = await loadA1(id); sets.push({ set: `a1-${id}`, edit: false, cases: a.cases.map((k) => ({ ...k, catalogName: `a1-${id}`, catalog: a.catalog })) }) }
  sets.push({ set: 'ext', edit: false, cases: EXT_CASES.map((k) => ({ ...k, catalogName: 'ext', catalog: EXT })) })
  sets.push({ set: 'a2-params', edit: false, cases: (await loadA2('params')).map((k) => ({ ...k, catalogName: `a2-${k.catalog.name}` })) })
  sets.push({ set: 'edits', edit: true, cases: EDIT_CASES.map((k) => ({ ...k, catalogName: 'ext', catalog: EXT })) })
  sets.push({ set: 'a2-edits', edit: true, cases: (await loadA2('edits')).map((k) => ({ ...k, catalogName: `a2-${k.catalog.name}` })) })
  return sets
}
