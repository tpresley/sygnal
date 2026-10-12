#!/usr/bin/env node
// Writes frontier/pack.json: the exact requests the local runner sends, for a frontier-LLM reference run.
//   node evals/frontier-pack.mjs [--enc tree+plan] [--edit whole|ops]
// pack: { encoding, editMode, systemPrompt, schema (the base catalog), catalogs: { name: { systemPrompt, schema, editSystemPrompt? } },
//         cases: [{ id, set, catalog, userMessage, expected, previous?, text?, systemPrompt?, schema? }] }
// A composition case uses catalogs[case.catalog].systemPrompt / .schema; an edit case (whole) uses
// catalogs[case.catalog].editSystemPrompt and the same schema; an ops edit carries its own systemPrompt / schema.
import { mkdirSync, writeFileSync } from 'node:fs'
import { composeRequest, editRequest } from './requests.mjs'
import { allSets } from './sets.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]); return acc }, []))
const ENC = args.enc || 'tree+plan'
const EDIT = args.edit || 'whole'
const catalogs = {}
const cases = []
for (const { set, edit, cases: list } of await allSets()) for (const k of list) {
  if (!catalogs[k.catalogName]) { const r = composeRequest(k.catalog, ENC, 'x'); catalogs[k.catalogName] = { systemPrompt: r.system, schema: r.schema } }
  if (!edit) { cases.push({ id: k.id, set, catalog: k.catalogName, userMessage: k.prompt, expected: k.want, ...(k.text && { text: k.text }) }); continue }
  const r = editRequest(k.catalog, ENC, k.prev, k.prompt, EDIT)
  if (EDIT === 'whole') catalogs[k.catalogName].editSystemPrompt = r.system
  cases.push({ id: k.id, set, catalog: k.catalogName, userMessage: r.messages[0].content, expected: k.want, previous: k.prev, ...(EDIT !== 'whole' && { systemPrompt: r.system, schema: r.schema }) })
}
const dir = new URL('../frontier/', import.meta.url)
mkdirSync(dir, { recursive: true })
writeFileSync(new URL('pack.json', dir), JSON.stringify({
  encoding: ENC, editMode: EDIT,
  note: 'Send the system prompt as the system message and userMessage as the only user message; the reply must be JSON matching the schema (structured output). Composition cases: catalogs[case.catalog].systemPrompt + .schema. Edit cases (set edits / a2-edits): catalogs[case.catalog].editSystemPrompt + .schema (whole mode), or the case\'s own systemPrompt + schema (ops mode). Top-level systemPrompt/schema = the base catalog. Answers file for score-frontier.mjs: { answers: [{ id, output, ms? }] }, output = the raw JSON text (or object) the model produced.',
  systemPrompt: catalogs.base.systemPrompt, schema: catalogs.base.schema, catalogs, cases,
}, null, 1))
console.log(`frontier/pack.json: ${cases.length} cases in ${Object.keys(catalogs).length} catalogs, encoding ${ENC}, edits ${EDIT}`)
