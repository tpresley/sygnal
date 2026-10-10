// Operability check, task 47 (the board's WebMCP tools): a local model operates the running app
// through the tools it registered on a fake `document.modelContext`, as a browser agent would.
// Success is judged on the board the user sees, not on the model's words. The user allows every
// card_remove (the harness clicks "Allow" in the dialog).
import { it, afterEach } from 'vitest'
import { mountApp, textOf, waitFor, sleep } from './dom.js'
import { fakeModelContext, installDialogPolyfill } from './aiserver.js'
import { complete, argsOf, summarize, writeOut, RUNS, MAX_STEPS, NO_THINK, MODEL } from './ollama.js'

const TASKS = [
  {
    name: 'add',
    prompt: "Add a card called 'Update the docs' to the Doing column.",
    ok: (b) => b.length === 6 && b.some((c) => /^update the docs$/i.test(c.title) && c.column === 'Doing') && same(b, SEED_COLUMNS),
  },
  {
    name: 'move',
    prompt: "Move the card 'Fix login bug' to Done.",
    ok: (b) => b.length === 5 && col(b, 'Fix login bug') === 'Done' && same(b, { ...SEED_COLUMNS, 'Fix login bug': 'Done' }),
  },
  {
    name: 'remove',
    prompt: "Delete the card 'Old idea' from the board.",
    ok: (b) => b.length === 4 && !col(b, 'Old idea') && same(b, SEED_COLUMNS),
  },
  {
    name: 'move-all',
    prompt: 'Move every card that is in To do to Doing.',
    ok: (b) => b.length === 5 && same(b, { ...SEED_COLUMNS, 'Fix login bug': 'Doing', 'Old idea': 'Doing', 'Design review': 'Doing' }),
  },
]
const SEED_COLUMNS = { 'Fix login bug': 'To do', 'Plan the sprint': 'Doing', 'Old idea': 'To do', 'Ship v2': 'Done', 'Design review': 'To do' }

const board = () => [...document.querySelectorAll('.column .card')].map((c) => ({ title: textOf(c.querySelector('.title') ?? c), column: textOf(c.closest('.column').querySelector('h2')) }))
const col = (b, title) => b.find((c) => c.title === title)?.column
/** every seed card still on the board is where `expected` says */
const same = (b, expected) => Object.entries(expected).every(([t, c]) => !col(b, t) || col(b, t) === c)

let mc
afterEach(() => {
  delete document.modelContext
  delete navigator.modelContext
})

async function episode(task) {
  installDialogPolyfill()
  mc = fakeModelContext()
  Object.defineProperty(document, 'modelContext', { value: mc, configurable: true, writable: true })
  Object.defineProperty(navigator, 'modelContext', { value: mc, configurable: true, writable: true })
  await mountApp()
  await waitFor(() => { if (!mc.names().length) throw new Error('no tools registered') }, { timeout: 3000 }).catch(() => {})
  // the user allows whatever the agent asks for
  const allow = setInterval(() => {
    const d = document.querySelector('dialog[open], [role="alertdialog"]')
    const b = d && [...d.querySelectorAll('button')].find((x) => /^Allow$/i.test(textOf(x)))
    if (b) b.click()
  }, 50)
  const t0 = performance.now()
  const trace = []
  let calls = 0
  let error
  try {
    const messages = [
      { role: 'system', content: 'You operate a web app through its tools. Call tools to do the task, then reply DONE.' + NO_THINK },
      { role: 'user', content: task.prompt },
    ]
    for (let step = 0; step < MAX_STEPS; step++) {
      // the tools as registered now (a page may re-register them as the app changes)
      const tools = mc.names().map((n) => mc.tool(n)).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
      const r = await complete(messages, tools)
      if (r.error) { error = r.error; break }
      messages.push(r.message)
      if (!r.message.tool_calls?.length) break
      for (const c of r.message.tool_calls) {
        calls++
        const name = c.function?.name
        let out
        try {
          const tool = mc.tool(name)
          out = tool ? await Promise.race([Promise.resolve(tool.execute(argsOf(c), { requestUserInteraction: async (cb) => cb() })), sleep(30000).then(() => ({ ok: false, error: 'the tool did not answer within 30 s' }))]) : { ok: false, error: `no tool named ${name}` }
        } catch (e) {
          out = { ok: false, error: `the tool threw: ${e?.message ?? e}` }
        }
        await sleep(60)
        const text = typeof out === 'string' ? out : JSON.stringify(out ?? null)
        trace.push(`${name}(${typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments)}) -> ${text.slice(0, 160)}`)
        messages.push({ role: 'tool', tool_call_id: c.id, content: text })
      }
    }
  } finally {
    clearInterval(allow)
  }
  await sleep(100)
  const end = board()
  return { ok: task.ok(end), calls, ms: performance.now() - t0, trace, end: end.map((c) => `${c.title}: ${c.column}`), error }
}

it(`operability: task 47 on ${MODEL}`, async () => {
  const results = []
  for (const task of TASKS) {
    const episodes = []
    for (let i = 0; i < RUNS; i++) episodes.push(await episode(task))
    results.push(summarize(task.name, episodes))
    console.log(`[operability] 47 ${task.name}: ${results.at(-1).success}/${RUNS}`)
  }
  await writeOut({ task: '47-board-agent-tools', model: MODEL, runs: RUNS, results })
})
