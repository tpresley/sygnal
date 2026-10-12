// Alternative: ONE decide() call per composition. The select questions plus the layout questions for
// every catalog part (parent, together pairs, first pairs over the whole catalog), read for the parts
// that were selected. Only for small catalogs without repeatable parts (pairs grow as n²).
//   node --env-file=... evals/alt-onecall.mjs dashboard crm
import { CATALOGS } from './catalogs.mjs'
import { selectStep, readSelect, layoutStep, readLayout, plan } from '../composer.mjs'
import { decide, MODEL } from '../client.mjs'
import { score } from './score.mjs'

const names = process.argv.slice(2)
for (const name of names) {
  const catalog = CATALOGS[name]
  const everything = { items: catalog.parts.filter((p) => !p.auto).map((p) => p.id), row: true }
  const res = await Promise.all(catalog.cases.map(async ([prompt, want]) => {
    const s = selectStep(catalog, prompt)
    const l = layoutStep(catalog, prompt, everything, { rows: 'pairs' })
    const questions = { ...s.questions, ...l.questions }
    const r = await decide({ user_request: prompt }, questions)
    const sel = readSelect(catalog, r.answers)
    const got = sel.unavailable ? null : readLayout(catalog, sel, r.answers, { plan: plan(catalog, sel), rows: 'pairs' })
    return { prompt, q: Object.keys(questions).length, tokens: r.tokens, ms: r.ms, ...score(catalog, got, want) }
  }))
  for (const r of res) if (!r.exact) console.log(`MISS ${r.prompt}\n     ${r.got}\n     want ${r.want}`)
  const ms = res.map((r) => r.ms).sort((a, b) => a - b)
  console.log(`${MODEL} one-call [${name}]: ${res.filter((r) => r.exact).length}/${res.length} exact, ${res.reduce((a, r) => a + r.partErrors, 0)} part errors, ${res.reduce((a, r) => a + r.placeErrors, 0)} placement errors, ${res[0].q} questions, ${Math.round(res.reduce((a, r) => a + r.tokens, 0) / res.length)} tokens, median ${ms[ms.length >> 1]} ms`)
}
