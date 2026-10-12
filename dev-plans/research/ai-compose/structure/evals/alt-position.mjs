// Alternative order encoding (json-render's order_<id>): one "Position N among siblings" choice per
// element instead of pairwise "which comes first?". Layout step only, from the gold selection.
//   node --env-file=... evals/alt-position.mjs
import { CATALOGS } from './catalogs.mjs'
import { layoutStep, readLayout, plan, parse, partsIn } from '../composer.mjs'
import { decide, MODEL } from '../client.mjs'
import { score } from './score.mjs'

let tot = 0, exact = 0, orderOnly = 0
for (const catalog of Object.values(CATALOGS)) {
  const res = await Promise.all(catalog.cases.filter(([, w]) => w && !/cta.*cta/.test(w)).map(async ([prompt, want]) => {
    const keys = partsIn(parse(want), catalog)
    const items = [...catalog.parts.filter((p) => p.required).map((p) => p.id).filter((id) => !keys.includes(id)), ...keys]
    const sel = { items, row: /row\(/.test(want), unavailable: false }
    const p = plan(catalog, sel)
    if (p.nodes.length < 2) return null
    const step = layoutStep(catalog, prompt, sel)
    const leaves = p.leaves.filter((k) => !catalog.parts.find((x) => x.id === k)?.pin)
    for (const q of Object.keys(step.questions)) if (q.startsWith('first_')) delete step.questions[q]
    for (const k of leaves) {
      step.questions[`pos_${k}`] = {
        type: 'choice',
        instructions: `Choose the display position on the page for this element: ${catalog.parts.find((x) => x.id === k).description}. Follow explicit ordering in user_request, otherwise use conventional reading order.`,
        criteria: Object.fromEntries(leaves.map((_, i) => [String(i + 1), `Position ${i + 1}.`])),
      }
    }
    const r = await decide(step.state, step.questions)
    const ev = (k) => Object.entries(r.answers[`pos_${k}`]?.probabilities || {}).reduce((a, [g, q]) => a + Number(g) * q, 0)
    const answers = { ...r.answers }
    leaves.forEach((a, i) => leaves.slice(i + 1).forEach((b) => {
      const ab = ev(a) <= ev(b)
      answers[`first_${a}_vs_${b}`] = { probabilities: { [a]: ab ? 1 : 0, [b]: ab ? 0 : 1 } }
    }))
    return score(catalog, readLayout(catalog, sel, answers, { plan: p }), want)
  }))
  for (const s of res.filter(Boolean)) { tot++; exact += s.exact; orderOnly += s.orderOnly; if (!s.exact) console.log(`MISS ${s.got}\n     want ${s.want}`) }
}
console.log(`${MODEL} position-order layout-only: ${exact}/${tot} exact, ${orderOnly} order-only misses`)
