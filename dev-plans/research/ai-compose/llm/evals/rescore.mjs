#!/usr/bin/env node
// node evals/rescore.mjs <results.jsonl> <set> : re-reads the recorded raw replies through the current
// read / repair / apply code (no model calls) and prints the score table per config.
import { readFileSync } from 'node:fs'
import { editRequest, readComposition, readOps } from './requests.mjs'
import { scoreCase, summarize, printTable } from './score.mjs'
import { allSets } from './sets.mjs'
const [file, set] = process.argv.slice(2)
const cases = Object.fromEntries((await allSets()).find((s) => s.set === set).cases.map((k) => [k.id, k]))
const by = {}
for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
  const row = JSON.parse(line)
  const k = cases[row.id]
  if (!k) continue
  const [model, enc, em] = row.config.split(' ')
  let r
  if (k.prev) {
    const req = editRequest(k.catalog, enc, k.prev, k.prompt, em)
    r = em.startsWith('ops') ? readOps(k.catalog, req.prev, row.raw, em) : readComposition(k.catalog, enc, row.raw, { prev: req.prev })
    Object.assign(r, scoreCase(k.catalog, k, r.layout, { prev: req.prev }))
  } else { r = readComposition(k.catalog, enc, row.raw); Object.assign(r, scoreCase(k.catalog, k, r.layout)) }
  r.ms = row.ms; r.tokens = row.tokens
  ;(by[row.config] ||= []).push(r)
  if (!r.exact || r.keyKept === false) console.error(`${r.exact ? 'ok  ' : 'MISS'} ${row.config} ${row.id} ${r.got}${r.keyKept === false ? ' KEYS✗' : ''}`)
}
printTable(Object.entries(by).map(([n, rows]) => [`${n} (re-read)`, summarize(rows)]))
