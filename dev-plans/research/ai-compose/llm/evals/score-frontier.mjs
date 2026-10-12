#!/usr/bin/env node
// node evals/score-frontier.mjs <answers.json> [--pack frontier/pack.json] [--label name]
// answers.json: { answers: [{ id, output, ms? }] } (output: the raw JSON text or object the model produced).
// Runs every output through the same parse / validate / repair path as the Ollama runner (readComposition,
// readOps, scoreCase) and prints the same score table, per set.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { editRequest, readComposition, readOps } from './requests.mjs'
import { scoreCase, summarize, printTable } from './score.mjs'
import { allSets } from './sets.mjs'

const argv = process.argv.slice(2)
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d)
const file = argv.find((a, i) => !a.startsWith('--') && !['--pack', '--label'].includes(argv[i - 1]))
if (!file) { console.error('usage: node evals/score-frontier.mjs <answers.json> [--pack frontier/pack.json] [--label name]'); process.exit(2) }
const pack = JSON.parse(readFileSync(resolve(opt('pack', new URL('../frontier/pack.json', import.meta.url).pathname)), 'utf8'))
const label = opt('label', 'frontier')
const answers = Object.fromEntries(JSON.parse(readFileSync(resolve(file), 'utf8')).answers.map((a) => [a.id, a]))
const byId = {}
for (const s of await allSets()) for (const k of s.cases) byId[k.id] = { ...k, edit: s.edit }

const bySet = {}
let missing = 0
for (const c of pack.cases) {
  const a = answers[c.id]
  const k = byId[c.id]
  const text = a ? (typeof a.output === 'string' ? a.output : JSON.stringify(a.output)) : null
  let r
  if (!a) { missing++; r = { invalid: 1, exact: false, partErrors: 0, issues: [] } }
  else if (k.edit) {
    const req = editRequest(k.catalog, pack.encoding, k.prev, k.prompt, pack.editMode)
    r = pack.editMode.startsWith('ops') ? readOps(k.catalog, req.prev, text, pack.editMode) : readComposition(k.catalog, pack.encoding, text, { prev: req.prev })
    Object.assign(r, scoreCase(k.catalog, k, r.layout, { prev: req.prev }))
  } else {
    r = readComposition(k.catalog, pack.encoding, text)
    Object.assign(r, scoreCase(k.catalog, k, r.layout))
  }
  r.ms = a?.ms ?? null
  ;(bySet[c.set] ||= []).push(r)
  if (!r.exact) console.error(`MISS ${c.id} ${k.prompt}\n     got ${r.got ?? '(no answer)'}  (want ${r.want})${r.textOk === false ? '  TEXT✗' : ''}${r.keyKept === false ? '  KEYS✗' : ''}${r.issues?.length ? `  repairs: ${r.issues.map((i) => i.kind).join(',')}` : ''}`)
}
console.log(`${label}: encoding ${pack.encoding}, edits ${pack.editMode}${missing ? `, ${missing} cases without an answer (counted invalid)` : ''}`)
printTable(Object.entries(bySet).map(([set, rows]) => [`${label} ${set}`, summarize(rows)]))
