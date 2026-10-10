// Operability check, task 45 (the packing list's in-app assistant): the app's POST /api/chat is
// served by a stand-in for the AI SDK route that asks a local model, with the route's three
// client tools (the server's definitions, from the task's table), and streams the model's text and
// tool calls back as a UI message stream. The harness types a request into the assistant, allows
// every removal the app asks about, and waits until the conversation settles. Success is judged on
// the list the user sees.
import { it, afterEach, vi } from 'vitest'
import { mountApp, click, typeInto, textOf, getByText, sleep } from './dom.js'
import { fieldNamed } from './aiserver.js'
import { complete, summarize, writeOut, RUNS, MAX_STEPS, NO_THINK, MODEL } from './ollama.js'

// what the server route declares (no execute: the app runs them)
const TOOLS = [
  { name: 'packing_add_item', description: 'Add an item to the packing list (not packed)', parameters: { type: 'object', properties: { name: { type: 'string', description: 'What to pack' }, quantity: { type: 'integer', minimum: 1, maximum: 99, description: 'How many' } }, required: ['name', 'quantity'] } },
  { name: 'item_set_packed', description: 'Mark the item with this id as packed (true) or not packed (false)', parameters: { type: 'object', properties: { id: { type: 'number' }, packed: { type: 'boolean' } }, required: ['id', 'packed'] } },
  { name: 'item_remove', description: 'Remove the item with this id from the list', parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
].map((t) => ({ type: 'function', function: t }))
const INSTRUCTIONS = 'You help the user with their packing list. Use the tools to change it; keep replies short.'

const TASKS = [
  {
    name: 'add',
    prompt: 'Add 2 water bottles to my list.',
    ok: (l) => l.length === 4 && l.some((i) => /water bottle/i.test(i.name) && i.quantity === 2 && !i.packed) && seedKept(l),
  },
  {
    name: 'pack',
    prompt: "I've packed the tent and the headlamp.",
    ok: (l) => l.length === 3 && l.every((i) => i.packed),
  },
  {
    name: 'remove',
    prompt: 'Take the socks off the list.',
    ok: (l) => l.length === 2 && !l.some((i) => /socks/i.test(i.name)) && l.every((i) => i.packed === false),
  },
]

const list = () => [...document.querySelectorAll('.items .item')].map((li) => ({
  name: textOf(li.querySelector('label') ?? li),
  quantity: Number((textOf(li.querySelector('.quantity')).match(/\d+/) || [])[0]),
  packed: !!li.querySelector('input[type="checkbox"]')?.checked,
}))
const seedKept = (l) => ['Tent', 'Socks', 'Headlamp'].every((n) => l.some((i) => i.name === n)) && l.find((i) => i.name === 'Socks')?.packed === true

const textParts = (parts) => parts.filter((p) => p.type === 'text').map((p) => p.text).join('')
const isTool = (p) => typeof p?.type === 'string' && (p.type.startsWith('tool-') || p.type === 'dynamic-tool')
const toolName = (p) => (p.type === 'dynamic-tool' ? p.toolName : p.type.slice(5))
const resultOf = (p) => (p.state === 'output-available' ? (typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? null))
  : p.state === 'output-error' ? JSON.stringify({ error: p.errorText }) : p.state === 'output-denied' ? JSON.stringify({ error: 'denied by the user' }) : JSON.stringify({ error: 'no result' }))

/** UI messages -> chat-completions messages (one assistant message per step, then its tool results) */
function toModel(body) {
  const extra = Object.fromEntries(Object.entries(body).filter(([k]) => !['id', 'messages', 'trigger', 'messageId', 'tools', 'instructions', 'model', 'output'].includes(k)))
  const out = [{ role: 'system', content: INSTRUCTIONS + (Object.keys(extra).length ? `\n\nContext from the app (JSON): ${JSON.stringify(extra)}` : '') + NO_THINK }]
  for (const m of body.messages || []) {
    const parts = m.parts || (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [])
    if (m.role !== 'assistant') { out.push({ role: m.role === 'system' ? 'system' : 'user', content: textParts(parts) }); continue }
    const steps = [[]]
    for (const p of parts) p.type === 'step-start' ? steps.push([]) : steps[steps.length - 1].push(p)
    for (const step of steps.filter((s) => s.length)) {
      const calls = step.filter(isTool)
      out.push({ role: 'assistant', content: textParts(step), ...(calls.length && { tool_calls: calls.map((p) => ({ id: p.toolCallId, type: 'function', function: { name: toolName(p), arguments: JSON.stringify(p.input ?? {}) } })) }) })
      for (const p of calls) out.push({ role: 'tool', tool_call_id: p.toolCallId, content: resultOf(p) })
    }
  }
  return out
}

let n = 0
/** the stand-in route: one model call per request, streamed back as UI message chunks */
function server(trace, counters) {
  return vi.fn(async (input, init = {}) => {
    const url = String(typeof input === 'object' && 'url' in input ? input.url : input)
    if (!url.endsWith('/api/chat')) return new Response('not found', { status: 404 })
    counters.inFlight++
    counters.requests++
    try {
      const body = JSON.parse(init.body)
      const r = await complete(toModel(body), TOOLS)
      const chunks = [{ type: 'start', messageId: `m${++n}` }, { type: 'start-step' }]
      if (r.error) {
        trace.push(`model error: ${r.error}`)
        chunks.push({ type: 'error', errorText: r.error })
      } else {
        const text = r.message.content || ''
        if (text) chunks.push({ type: 'text-start', id: `t${n}` }, { type: 'text-delta', id: `t${n}`, delta: text }, { type: 'text-end', id: `t${n}` })
        for (const c of r.message.tool_calls || []) {
          counters.calls++
          let args = c.function?.arguments
          try { args = typeof args === 'string' ? JSON.parse(args || '{}') : args } catch {}
          const id = c.id || `call_${++n}`
          trace.push(`${c.function?.name}(${JSON.stringify(args)})`)
          chunks.push({ type: 'tool-input-start', toolCallId: id, toolName: c.function?.name }, { type: 'tool-input-available', toolCallId: id, toolName: c.function?.name, input: args })
        }
        if (!r.message.tool_calls?.length) trace.push(`reply: ${text.slice(0, 120)}`)
        chunks.push({ type: 'finish-step' }, { type: 'finish', finishReason: r.message.tool_calls?.length ? 'tool-calls' : 'stop' })
      }
      const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } })
    } finally {
      counters.inFlight--
      counters.last = performance.now()
    }
  })
}

afterEach(() => vi.unstubAllGlobals())

async function episode(task) {
  const trace = []
  const counters = { inFlight: 0, requests: 0, calls: 0, last: performance.now() }
  vi.stubGlobal('fetch', server(trace, counters))
  await mountApp()
  const allow = setInterval(() => {
    const d = document.querySelector('[role="alertdialog"], dialog[open]')
    const b = d && [...d.querySelectorAll('button')].find((x) => /^Allow$/i.test(textOf(x)))
    if (b) b.click()
  }, 50)
  const t0 = performance.now()
  let error
  try {
    const field = fieldNamed('Ask the assistant')
    await typeInto(field, task.prompt)
    await click(getByText('button', /^Send$/, field.closest('form')))
    // settled: nothing in flight, no dialog, and quiet for 1.5 s (or the step limit, or 5 minutes)
    for (;;) {
      await sleep(100)
      const dialogOpen = !!document.querySelector('[role="alertdialog"], dialog[open]')
      if (counters.inFlight === 0 && !dialogOpen && performance.now() - counters.last > 1500) break
      if (counters.requests > MAX_STEPS) { error = `more than ${MAX_STEPS} requests`; break }
      if (performance.now() - t0 > 300000) { error = 'timed out'; break }
    }
  } catch (e) {
    error = String(e?.message ?? e)
  } finally {
    clearInterval(allow)
  }
  const end = list()
  return { ok: task.ok(end), calls: counters.calls, ms: performance.now() - t0, trace, end: end.map((i) => `${i.name} x${i.quantity}${i.packed ? ' packed' : ''}`), error }
}

it(`operability: task 45 on ${MODEL}`, async () => {
  const results = []
  for (const task of TASKS) {
    const episodes = []
    for (let i = 0; i < RUNS; i++) episodes.push(await episode(task))
    results.push(summarize(task.name, episodes))
    console.log(`[operability] 45 ${task.name}: ${results.at(-1).success}/${RUNS}`)
  }
  await writeOut({ task: '45-packing-assistant', model: MODEL, runs: RUNS, results })
})
