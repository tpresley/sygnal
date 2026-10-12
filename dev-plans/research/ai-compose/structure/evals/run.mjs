#!/usr/bin/env node
// Labelled evals for composer.mjs.
//   node --env-file=$HOME/.config/typesafe/env evals/run.mjs [catalog ...] [--prefilter] [--repeat=N] [--quiet]
//   BACKEND=ollama node evals/run.mjs ...            (local nimble)
// Prints per case and a summary per catalog: exact layouts, part errors (missing + extra), placement
// errors (a right part in the wrong container/slot/row), order-only misses, calls, tokens, median ms.
import { writeFileSync } from 'node:fs'
import { CATALOGS } from './catalogs.mjs'
import { compose, format, parse, partsIn, places } from '../composer.mjs'
import { decide, BACKEND, MODEL } from '../client.mjs'
import { score } from './score.mjs'

const args = process.argv.slice(2)
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true] }))
const names = args.filter((a) => !a.startsWith('--'))
const selected = names.length ? names : Object.keys(CATALOGS)
const repeat = Number(flags.repeat || 1)
const only = flags.only ? Number(flags.only) : null

async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) } }))
  return out
}

const all = []
console.log(`${MODEL} (${BACKEND})${flags.prefilter ? ' prefilter' : ''} rows=${flags.rows || 'beside'}\n`)
for (const name of selected) {
  const catalog = CATALOGS[name]
  const cases = catalog.cases.filter((_, i) => only === null || i === only)
  const runs = []
  for (let r = 0; r < repeat; r++) {
    const res = await pool(cases, BACKEND === 'jev' ? 4 : 1, async ([prompt, want]) => {
      const out = await compose(catalog, prompt, decide, { prefilter: !!flags.prefilter, rows: flags.rows || 'beside' })
      const r = { prompt, ...score(catalog, out.layout, want), calls: out.calls, tokens: out.tokens, ms: out.ms, steps: out.steps }
      if (flags.progress) console.error(`${r.exact ? 'ok  ' : 'MISS'} [${name}] ${prompt} → ${r.got}  (${r.ms} ms)`)
      return r
    })
    runs.push(...res)
  }
  for (const r of runs) {
    if (!flags.quiet || !r.exact) console.log(`${r.exact ? 'ok  ' : 'MISS'} [${name}] ${r.prompt}\n     ${r.got || '(nothing fits)'}${r.exact ? '' : `\n     want ${r.want || '(nothing fits)'}`}   ${r.calls} calls, ${r.tokens} tok, ${r.ms} ms`)
  }
  const sorted = runs.map((r) => r.ms).sort((a, b) => a - b)
  const sum = {
    catalog: name, cases: runs.length, exact: runs.filter((r) => r.exact).length,
    partErrors: runs.reduce((a, r) => a + r.partErrors, 0), placeErrors: runs.reduce((a, r) => a + r.placeErrors, 0),
    orderOnly: runs.filter((r) => r.orderOnly).length,
    calls: (runs.reduce((a, r) => a + r.calls, 0) / runs.length).toFixed(2),
    tokens: Math.round(runs.reduce((a, r) => a + r.tokens, 0) / runs.length),
    medianMs: sorted[sorted.length >> 1],
  }
  all.push({ sum, runs })
  console.log(`\n== ${name}: ${sum.exact}/${sum.cases} exact, ${sum.partErrors} part errors, ${sum.placeErrors} placement errors, ${sum.orderOnly} order-only misses, ${sum.calls} calls, ${sum.tokens} tokens, median ${sum.medianMs} ms\n`)
}
console.log('| catalog | exact | part err | place err | order-only | calls | tokens | median ms |\n| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const { sum: s } of all) console.log(`| ${s.catalog} | ${s.exact}/${s.cases} | ${s.partErrors} | ${s.placeErrors} | ${s.orderOnly} | ${s.calls} | ${s.tokens} | ${s.medianMs} |`)
const tot = all.reduce((a, { sum: s }) => ({ exact: a.exact + s.exact, cases: a.cases + s.cases, pe: a.pe + s.partErrors, pl: a.pl + s.placeErrors }), { exact: 0, cases: 0, pe: 0, pl: 0 })
console.log(`| **all** | ${tot.exact}/${tot.cases} | ${tot.pe} | ${tot.pl} | | | | |`)
if (flags.out) writeFileSync(flags.out, JSON.stringify(all, null, 1))
