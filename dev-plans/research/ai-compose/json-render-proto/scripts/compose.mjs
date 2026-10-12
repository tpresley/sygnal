// experimental_composeSpec (json-render core, built from the cloned source) with a CUSTOM evaluator that
// POSTs { model, state, questions } to a decision endpoint (TypeSafe Jev or a local Ollama decision model).
//   node --env-file=$HOME/.config/typesafe/env scripts/compose.mjs typesafe "prompt"
//   node scripts/compose.mjs ollama "prompt"
// Writes out/compose-<backend>-<slug>.json (spec, steps, timings). Never prints the key.
import { writeFileSync } from 'node:fs'
import { experimental_composeSpec } from '../vendor/json-render-core.mjs'
import { catalog } from '../src/catalog.js'
import { candidates, initialState } from '../src/candidates.js'

const [backend = 'ollama', prompt = 'Sales overview: revenue, signups and churn side by side, then a feedback form'] = process.argv.slice(2)
const ENDPOINTS = {
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest', key: () => process.env.TYPESAFE_API_KEY },
  ollama: { url: 'http://localhost:11434/v1/systemone', model: 'nimble', key: () => null },
}
const ep = ENDPOINTS[backend]
if (backend === 'typesafe' && !ep.key()) throw new Error('TYPESAFE_API_KEY not set (use --env-file)')

let calls = 0
/** the evaluator contract: ({ state, questions, signal }) => { answers: { name: { choice, confidence } }, usage } */
const evaluate = async ({ state, questions, signal }) => {
  calls++
  const key = ep.key()
  const res = await fetch(ep.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: ep.model, state, questions }),
    signal,
  })
  if (!res.ok) throw new Error(`decision endpoint: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  const body = await res.json()
  const answers = Object.fromEntries(Object.entries(body.answers).map(([name, a]) => [name, { choice: a.choice, confidence: a.confidence }]))
  return { answers, usage: { inputTokens: body.usage?.input_tokens ?? body.usage?.inputTokens } }
}

const started = Date.now()
let final
for await (const ev of experimental_composeSpec({ catalog, candidates, prompt, evaluate, initialState, maxElements: 12 })) {
  if (ev.type === 'step') console.log(`step ${ev.step.index}: ${ev.step.description} (${ev.step.elapsedMs} ms)`)
  else final = ev
}
const tree = (spec, id, depth = 0) => !spec ? '' : `${'  '.repeat(depth)}${id}: ${spec.elements[id].type} ${JSON.stringify(spec.elements[id].props)}\n` +
  (spec.elements[id].children || []).map((c) => tree(spec, c, depth + 1)).join('')
console.log(`stop: ${final.stopReason}, ${calls} evaluator calls, ${Date.now() - started} ms, input tokens ${final.inputTokens}`)
console.log(final.spec ? tree(final.spec, final.spec.root) : '(no spec)')
const slug = prompt.toLowerCase().replace(/[^a-z]+/g, '-').slice(0, 40)
writeFileSync(`out/compose-${backend}-${slug}.json`, JSON.stringify({ backend, model: ep.model, prompt, ...final, calls }, null, 2))
