// Layout step only, from the gold selection (isolates structure from selection errors).
//   node --env-file=... evals/layout-only.mjs [catalog ...] [--rows=beside|index|pairs] [--gate=gold|on]
// --gate=on turns the row gate on for every case (checks that row questions do not invent rows).
import { CATALOGS } from './catalogs.mjs'
import { layoutStep, readLayout, plan, parse, format, partsIn } from '../composer.mjs'
import { decide, MODEL } from '../client.mjs'
import { score } from './score.mjs'

const args = process.argv.slice(2)
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true] }))
const names = args.filter((a) => !a.startsWith('--'))
const rows = flags.rows || 'beside'
async function pool(items, fn) {
  const out = new Array(items.length); let next = 0
  await Promise.all(Array.from({ length: process.env.BACKEND === 'ollama' ? 1 : 6 }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]) } }))
  return out
}
// json-render style: no `in` hints, every part may go in any container slot (or the page)
function unconstrain(c) {
  const all = [c.root.id, ...c.parts.filter((p) => p.slots).map((p) => p.id)]
  return { ...c, parts: c.parts.map((p) => ({ ...p, in: all.filter((d) => d !== p.id) })) }
}
let tot = 0, exact = 0, place = 0, order = 0, qs = 0, toks = 0, sExact = 0, sPlace = 0
const lines = []
for (const name of names.length ? names : Object.keys(CATALOGS)) {
  const catalog = flags.unconstrained ? unconstrain(CATALOGS[name]) : CATALOGS[name]
  const res = await pool(catalog.cases.filter(([, w]) => w), async ([prompt, want]) => {
    const parts = partsIn(parse(want), catalog)
    const seen = {}
    const keys = parts.map((p) => { seen[p] = (seen[p] || 0) + 1; return seen[p] > 1 ? `${p}__${seen[p]}` : p })
    const items = [...catalog.parts.filter((p) => p.required).map((p) => p.id).filter((id) => !keys.includes(id)), ...keys]
    const sel = { items, row: flags.gate === 'on' ? true : /row\(/.test(want), unavailable: false }
    const p = plan(catalog, sel)
    let answers = {}, tokens = 0, n = 0
    if (p.nodes.length > 1) {
      const step = layoutStep(catalog, prompt, sel, { rows, leftRight: !flags.noleft })
      n = Object.keys(step.questions).length
      const r = await decide(step.state, step.questions)
      answers = r.answers; tokens = r.tokens
    }
    const got = readLayout(catalog, sel, answers, { plan: p, rows })
    const strict = score(catalog, readLayout(catalog, sel, answers, { plan: p, rows, rowMean: 0.5 }), want)
    return { name, prompt, n, tokens, answers, strictExact: strict.exact, strictPlace: strict.placeErrors, ...score(catalog, got, want) }
  })
  for (const r of res) {
    tot++; exact += r.exact; sExact += r.strictExact; sPlace += r.strictPlace; place += r.placeErrors; order += r.orderOnly; qs += r.n; toks += r.tokens
    if (!r.exact) lines.push(`MISS [${r.name}] ${r.prompt}\n     ${r.got}\n     want ${r.want}` + (flags.debug ? '\n' + Object.entries(r.answers).map(([k, a]) => `       ${k} ${a.type === 'noul' ? a.noul : JSON.stringify(a.probabilities)}`).join('\n') : ''))
  }
}
console.log(lines.join('\n'))
console.log(`${MODEL} layout-only rows=${rows} gate=${flags.gate || 'gold'}: ${exact}/${tot} exact, ${place} placement errors, ${order} order-only, ${(qs / tot).toFixed(1)} questions, ${Math.round(toks / tot)} tokens per layout call; with rowMean 0.5: ${sExact}/${tot} exact, ${sPlace} placement errors`)
