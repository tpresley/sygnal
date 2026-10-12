// json-render's main (LLM) path on a local Ollama chat model: catalog.prompt() as the system prompt,
// streamed JSONL patches → createSpecStreamCompiler → a Spec, saved for src/composed.test.js to render.
//   node scripts/llm.mjs qwen3:8b "prompt"
import { writeFileSync } from 'node:fs'
import { createSpecStreamCompiler, validateSpec, autoFixSpec } from '../vendor/json-render-core.mjs'
import { catalog } from '../src/catalog.js'

const [model = 'qwen3:8b', prompt = 'A feedback form (a message field and a send button that submits it) and a list of 3 tasks for today as checkboxes'] = process.argv.slice(2)
const system = catalog.prompt()
const started = Date.now()
const res = await fetch('http://localhost:11434/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, stream: true, ...(model.startsWith('qwen3') ? { think: false } : {}), options: { temperature: 0.2 }, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
})
if (!res.ok) throw new Error(`HTTP ${res.status}`)
const compiler = createSpecStreamCompiler({ root: '', elements: {} })
let text = '', patches = 0, firstPatchMs = null, usage = {}
const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
let buf = ''
for (;;) {
  const { value, done } = await reader.read()
  if (done) break
  buf += value
  const lines = buf.split('\n'); buf = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    const msg = JSON.parse(line)
    const delta = msg.message?.content || ''
    text += delta
    const { newPatches } = compiler.push(delta)
    if (newPatches.length && firstPatchMs === null) firstPatchMs = Date.now() - started
    patches += newPatches.length
    if (msg.done) usage = { prompt_eval_count: msg.prompt_eval_count, eval_count: msg.eval_count }
  }
}
compiler.push('\n')
let spec = compiler.getResult()
const structural = validateSpec(spec)
const catalogOk = catalog.validate(spec)
let fixed = null
if (!structural.valid || !catalogOk.success) fixed = autoFixSpec(spec)
console.log(`${model}: ${patches} patches, first patch ${firstPatchMs} ms, total ${Date.now() - started} ms, tokens ${JSON.stringify(usage)}`)
console.log('structural valid:', structural.valid, structural.issues?.map((i) => i.message).slice(0, 5))
console.log('catalog valid:', catalogOk.success, catalogOk.success ? '' : JSON.stringify(catalogOk.error?.issues?.slice(0, 3)))
const slug = prompt.toLowerCase().replace(/[^a-z]+/g, '-').slice(0, 30)
writeFileSync(`out/llm-${model.replace(/[^a-z0-9]+/g, '')}-${slug}.json`, JSON.stringify({ model, prompt, spec, raw: text, fixed }, null, 2))
console.log(text)
