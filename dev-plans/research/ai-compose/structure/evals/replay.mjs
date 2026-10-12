// Re-read saved answers (results/*.json from run.mjs --out) with other reading parameters: no calls.
//   node evals/replay.mjs results/nimble-final.json
import { readFileSync } from 'node:fs'
import { CATALOGS } from './catalogs.mjs'
import { readSelect, readLayout, plan } from '../composer.mjs'
import { score } from './score.mjs'

const all = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const settings = [
  { rowLink: 'max', rowMean: 0.25 }, { rowLink: 'max', rowMean: 0.35 }, { rowLink: 'max', rowMean: 0.5 },
  { rowLink: 'mean', rowMean: 0.25 }, { rowLink: 'max', rowMean: 0.25, threshold: 0.6 },
]
for (const opt of settings) {
  let exact = 0, n = 0, place = 0
  for (const { sum, runs } of all) {
    const catalog = CATALOGS[sum.catalog]
    const cases = Object.fromEntries(catalog.cases)
    for (const r of runs) {
      if (!(r.prompt in cases)) continue
      const sel = readSelect(catalog, r.steps.find((s) => s.name === 'select').answers, { threshold: opt.threshold ?? 0.5 })
      let got = null
      if (!sel.unavailable) {
        const layout = r.steps.find((s) => s.name === 'layout')?.answers || {}
        got = readLayout(catalog, sel, layout, { plan: plan(catalog, sel), ...opt })
      }
      const sc = score(catalog, got, cases[r.prompt])
      n++; exact += sc.exact; place += sc.placeErrors
    }
  }
  console.log(JSON.stringify(opt), `${exact}/${n} exact, ${place} placement errors`)
}
