// The structured-output variant: one whole Spec constrained by catalog.jsonSchema() (Ollama `format`).
//   node scripts/llm-structured.mjs qwen3:8b "prompt"
import { writeFileSync } from 'node:fs'
import { validateSpec } from '../vendor/json-render-core.mjs'
import { catalog } from '../src/catalog.js'

const [model = 'qwen3:8b', prompt = 'A feedback form (a message field and a send button that submits it) and a list of 3 tasks for today as checkboxes'] = process.argv.slice(2)
const system = catalog.prompt({ mode: 'standalone' }) + '\n\nOUTPUT OVERRIDE: return ONE JSON object { root, elements, state } (the final spec), not JSONL patches.'
const started = Date.now()
const res = await fetch('http://localhost:11434/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, stream: false, think: false, format: catalog.jsonSchema(), options: { temperature: 0.2 },
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
})
const body = await res.json()
const spec = JSON.parse(body.message.content)
console.log(`${model} structured: ${Date.now() - started} ms, tokens in ${body.prompt_eval_count} out ${body.eval_count}`)
console.log('structural valid:', validateSpec(spec).valid, validateSpec(spec).issues?.map((i) => i.message).slice(0, 5))
console.log('catalog valid:', catalog.validate(spec).success)
console.log(JSON.stringify(spec))
const slug = prompt.toLowerCase().replace(/[^a-z]+/g, '-').slice(0, 30)
writeFileSync(`out/llm-structured-${model.replace(/[^a-z0-9]+/g, '')}-${slug}.json`, JSON.stringify({ model, prompt, spec }, null, 2))
