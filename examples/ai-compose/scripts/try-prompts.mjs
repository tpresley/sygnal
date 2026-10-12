#!/usr/bin/env node
// npm run try [-- options] [-- "a prompt" ...]: compose prompts with a real model, through the same
// backends and catalog as the app (no browser), and print each layout. With no prompts, runs the
// labelled cases below and scores them: exact layouts, wrong or missing parts, wrong params.
//
//   npm run try                          compose.decisions() on Ollama's nimble (OLLAMA_URL=...)
//   npm run try -- --model qwen3:8b      a chat model: compose.llm() over Ollama's /v1/chat/completions
//   node --env-file=$HOME/.config/typesafe/env scripts/try-prompts.mjs --jev
//                                        compose.decisions() on TypeSafe's jev-latest; the key
//                                        (TYPESAFE_API_KEY) is read from process.env here and only
//                                        goes in the Authorization header: never printed
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import sygnal from 'sygnal/vite'
import { compose, chatCompletions } from 'sygnal/ai'

// prompt → the expected layout, top to bottom ('row(a,b)': side by side; 'part[name=value]': a
// param that isn't the default; '': nothing fits)
const FLAT = [
  ['Sales overview: revenue, signups and churn side by side, then the revenue chart', 'row(revenue,signups,churn) revenueChart'],
  ['My morning: the weather and my tasks for today', 'weather tasks'],
  ['Support desk: open tickets first, then recent orders', 'tickets orders'],
  ['A feedback form at the top, and the open tickets below it', 'feedback tickets'],
  ['Show me the stock price of Apple', ''],
  ['Put my tasks beside the weather, and a feedback form under them', 'row(tasks,weather) feedback'],
  ['Recent orders, the revenue chart, and below that a feedback form', 'orders revenueChart feedback'],
  ['The revenue chart, with the orders table above it and the tickets at the very bottom', 'orders revenueChart tickets'],
  ['How are sales doing?', 'revenue revenueChart'],
  ['What is on my plate today?', 'tasks'],
  ['Churn and signups next to each other', 'row(churn,signups)'],
]
const PARAMS = [
  ['The revenue chart for this quarter', 'revenueChart[range=quarter]'],
  ['Only the urgent tickets', 'tickets[priority=high]'],
  ['The top 3 pending orders', 'orders[limit=3,status=pending]'],
  ['Revenue over the last 30 days, then the refunded orders', 'revenueChart[range=month] orders[status=refunded]'],
]

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const prompts = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--model'))

const OLLAMA = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')
const jev = flag('--jev')
const key = jev ? process.env.TYPESAFE_API_KEY : undefined
if (jev && !key) {
  console.error('--jev needs TYPESAFE_API_KEY: node --env-file=$HOME/.config/typesafe/env scripts/try-prompts.mjs --jev')
  process.exit(1)
}
const model = option('--model') || process.env.MODEL || (jev ? 'jev-latest' : 'nimble')

// the app's catalog (its parts are JSX components: loaded through Vite with the sygnal plugin)
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, plugins: [sygnal()], logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false } })
const { catalog } = await vite.ssrLoadModule('/src/catalog.js')
const { TASKS } = await vite.ssrLoadModule('/src/data.js')
await vite.close()
const state = { tasks: TASKS, feedback: { draft: '', sent: [] } }

// the backend: a decision model (Jev, or an Ollama model with the 'decision' capability) or a chat model
let kind = 'decisions'
if (!jev) {
  const tags = await fetch(`${OLLAMA}/api/tags`).then((r) => r.json()).catch(() => null)
  if (!tags) { console.error(`Can't reach Ollama at ${OLLAMA}`); process.exit(1) }
  const found = tags.models.find((m) => m.name === model || m.name === `${model}:latest`)
  if (!found) { console.error(`${model} is not installed in Ollama`); process.exit(1) }
  kind = found.capabilities?.includes('decision') ? 'decisions' : 'llm'
}
const backend = kind === 'llm'
  ? compose.llm({ model })
  : compose.decisions({ url: jev ? 'https://api.typesafe.ai/v1/systemone' : `${OLLAMA}/v1/systemone`, model })
const transport = chatCompletions({ baseURL: `${OLLAMA}/v1`, body: { temperature: 0, reasoning_effort: 'none' } })
const names = { ok: 'REPLY', error: 'FAILED', delta: 'DELTA', key: 'compose' }

/** one step's request → the reply body the backend reads */
async function send(request) {
  if (kind === 'llm') {
    let text = ''
    for await (const e of transport.stream(request, new AbortController().signal)) if (e.type === 'text') text += e.delta
    return { text }
  }
  const res = await fetch(request.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
    body: JSON.stringify(request.json),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

/** the layout in compact notation: 'row(a,b) c[name=value]' */
function notation(layout) {
  const nodes = layout?.nodes || {}
  const one = (k) => {
    const n = nodes[k]
    if (n.slots) return `${n.part}(${Object.values(n.slots).flat().map(one).join(',')})`
    const params = Object.entries(n.params || {}).sort(([a], [b]) => a.localeCompare(b)).map(([p, v]) => `${p}=${v}`)
    return params.length ? `${n.part}[${params}]` : n.part
  }
  return (nodes.page?.slots?.default || []).map(one).join(' ')
}

/** prompt → { layout, calls, ms } */
async function run(prompt) {
  const started = performance.now()
  let calls = 0
  let r = backend.start({ catalog, state, prompt, previous: null, names })
  while (r.request) {
    calls++
    const reply = await send(r.request)
    r = backend.reply({ catalog, state, pending: r.pending, reply, names })
  }
  if (r.error) throw new Error(r.error)
  return { layout: r.layout ? notation(r.layout) : '', calls, ms: Math.round(performance.now() - started) }
}

const partsOf = (layout) => layout.match(/[A-Za-z]+(?=[\s,()[]|$)/g)?.filter((w) => w !== 'row') || []
const paramsOf = (layout) => layout.match(/\[[^\]]*\]/g)?.join('') || ''
console.log(`${kind === 'llm' ? 'compose.llm' : 'compose.decisions'}: ${model} at ${jev ? 'api.typesafe.ai' : OLLAMA}\n`)

if (prompts.length) {
  for (const prompt of prompts) {
    const { layout, calls, ms } = await run(prompt)
    console.log(`${prompt}\n  ${layout || '(nothing fits)'}   ${calls} call${calls === 1 ? '' : 's'}, ${ms} ms`)
  }
} else {
  const times = []
  for (const [set, cases] of [['flat dashboard', FLAT], ['enum params', PARAMS]]) {
    let exact = 0
    let partErrors = 0
    let paramErrors = 0
    console.log(`-- ${set}`)
    for (const [prompt, want] of cases) {
      let got
      try { got = await run(prompt) } catch (e) { got = { layout: `(error: ${e.message.slice(0, 120)})`, calls: 0, ms: 0 } }
      times.push(got.ms)
      const have = partsOf(got.layout)
      partErrors += partsOf(want).filter((p) => !have.includes(p)).length + have.filter((p) => !partsOf(want).includes(p)).length
      if (paramsOf(got.layout) !== paramsOf(want)) paramErrors++
      const ok = got.layout === want
      if (ok) exact++
      console.log(`${ok ? 'ok  ' : 'MISS'} ${prompt}\n     ${got.layout || '(nothing fits)'}${ok ? '' : `   (want ${want || 'nothing'})`}   ${got.calls} call${got.calls === 1 ? '' : 's'}, ${got.ms} ms`)
    }
    console.log(`${set}: ${exact}/${cases.length} exact layouts, ${partErrors} wrong or missing parts, ${paramErrors} with wrong params\n`)
  }
  times.sort((a, b) => a - b)
  console.log(`median ${times[times.length >> 1]} ms per composition`)
}
