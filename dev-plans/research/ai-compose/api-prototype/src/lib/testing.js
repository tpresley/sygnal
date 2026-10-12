// PROTOTYPE: a test fixture for a whole composition, the same for both backends.
//
//   await composeWith(t, catalog, [{ part: 'tasks' }, { part: 'row', children: [{ part: 'revenue' }, { part: 'churn' }] }])
//
// answers the pending composition request(s) as a model would to produce that tree: with a decision
// backend it builds each step's answers() from the request's questions (1–3 requests); with an LLM
// it responds the tree as the structured output (or streams it in chunks: { stream: n }).
import { answers } from 'sygnal/ai'

const qname = (s) => s.replace(/[^A-Za-z0-9_]/g, '_')

function leavesOf(catalog, tree, inside = 'page', out = []) {
  for (const n of tree) {
    const p = catalog.get(n.part)
    if (p.kind === 'container') leavesOf(catalog, n.children || [], n.part, out)
    else {
      const rp = Object.keys(p.params).find((k) => p.params[k].from)
      out.push({ ...n, option: qname(rp ? `${n.part}:${n.params[rp]}` : n.part), inside })
    }
  }
  return out
}

function picksFor(catalog, tree, questions) {
  const leaves = leavesOf(catalog, tree)
  const by = Object.fromEntries(leaves.map((l, i) => [l.option, { ...l, i }]))
  const containers = new Set(leaves.map((l) => l.inside))
  const picks = {}
  for (const q in questions) {
    let m
    if ((m = /^use_(.+)$/.exec(q))) picks[q] = by[m[1]] ? 'use' : 'omit'
    else if ((m = /^layout_(.+)$/.exec(q))) picks[q] = containers.has(m[1])
    else if ((m = /^place_(.+)$/.exec(q))) picks[q] = by[m[1]]?.inside ?? 'page'
    else if ((m = /^above_(.+)__(.+)$/.exec(q))) picks[q] = (by[m[1]]?.i ?? 0) <= (by[m[2]]?.i ?? 0) ? 'a' : 'b'
    else if ((m = /^param_(.+)_([^_]+)$/.exec(q))) { const v = by[m[1]]?.params?.[m[2]]; if (v !== undefined) picks[q] = String(v) }
  }
  return picks
}

export async function composeWith(t, catalog, tree, { key = 'compose', stream } = {}) {
  const pending = () => t.requests('HTTP').concat(t.requests('LLM')).filter((r) => r.key === key)
  for (let step = 0; step < 3; step++) {
    const http = t.requests('HTTP').filter((r) => r.key === key).at(-1)
    const llmReq = t.requests('LLM').filter((r) => r.key === key).at(-1)
    if (llmReq && !http) {
      const text = JSON.stringify({ page: tree })
      if (stream) {
        const size = Math.ceil(text.length / stream)
        const chunks = Array.from({ length: stream }, (_, i) => text.slice(i * size, (i + 1) * size))
        for (let i = 0; i < chunks.length; i++) await t.stream('LLM', [chunks[i]], key, { end: i === chunks.length - 1 })
      } else await t.respond('LLM', text, key)
      return
    }
    const before = pending().length
    await t.respond('HTTP', answers(http.json.questions, picksFor(catalog, tree, http.json.questions)), key)
    await t.settle()
    if (pending().length === before) return   // no further step was sent
  }
}
