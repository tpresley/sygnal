// @vitest-environment jsdom
// PLAN-6 4-L: the `sygnal/ai` lines of llms.txt and skills/sygnal-dev/SKILL.md run (as PLAN-4 4-A's
// p4-4a1-agent-doc-samples does for its features). Each FRAGMENTS entry is the exact text of the
// file(s) it names (checked first); it is placed in a small module (fixtures around it, the
// fragment unchanged), compiled with the automatic JSX runtime, imported against the built package
// (dist: `npm run build` first) and run with the LLM / HTTP fakes. Every module is also checked
// with `sygnal-check --strict`. No network.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import 'sygnal/diagnostics'
import { renderComponent, form } from 'sygnal'
import { makeChatDriver, openResponses, uiMessageStream, strictSchemas, chat, formTool, answers, messageText, makeMcpAppDriver } from 'sygnal/ai'
import { checkFiles } from '../sygnal-check/src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const FILES = {
  llms: fs.readFileSync(path.join(repo, 'llms.txt'), 'utf8'),
  skill: fs.readFileSync(path.join(repo, 'skills/sygnal-dev/SKILL.md'), 'utf8'),
}

// text → the files that contain it verbatim
const FRAGMENTS = {
  chatSend: [['llms'], "SEND: { STATE: (s) => ({ ...s, messages: [...s.messages, { role: 'user', content: s.prompt }], prompt: '' }), LLM: (s) => ({ messages: s.messages, key: 'reply', delta: 'DELTA', ok: 'DONE', error: 'FAILED' }) }"],
  chatDelta: [['llms'], "DELTA: (s, { text }) => ({ ...s, draft: text })"],
  chatDone: [['llms'], "DONE: (s, { message }) => ({ ...s, messages: [...s.messages, message], draft: '' })"],
  chatAbort: [['llms'], "{ abort: 'reply' }"],
  chatRun: [['llms'], "run(App, { LLM: makeChatDriver({ transport: openResponses({ baseURL: 'http://localhost:11434/v1', model: 'llama3.2' }) }) })"],
  chatProd: [['llms'], "transport: uiMessageStream('/api/chat')"],
  chatStream: [['llms'], "await t.stream('LLM', ['Hel', 'lo'])"],
  chatStreamSkill: [['skill'], "t.stream('LLM', ['Hi'])"],
  chatRequestSkill: [['skill'], "{ messages: [{ role: 'user', content: text }], delta: 'DELTA', ok: 'DONE', error: 'FAILED' }"],
  chatPlain: [['llms', 'skill'], "uses = { chat: chat({ agent: false, form: '.ask', prompt: '.prompt', stop: '.stop', regenerate: '.retry' }) }"],
  chatPrompt: [['llms'], '<input className="prompt" value={state.chat.prompt} />'],
  chatSendNext: [['llms'], "next('chat.SEND', text)"],
  agent: [['llms'], "TodoApp.agent = { name: 'todos', description: 'The todo list', read: (state) => ({ todos: state.todos.map(({ id, text, done }) => ({ id, text, done })) }), actions: { ADD: { description: 'Add a todo', input: z.string().min(1) }, CLEAR_DONE: { description: 'Delete the done todos', consequential: true } } }"],
  callTool: [['llms'], "await t.callTool('todos_add', { value: 'milk' })"],
  refuse: [['llms'], "abort('reason')"],
  questions: [['llms'], "const questions = { topic: choice('What is this ticket about?', { billing: 'Payments, invoices', bug: 'Something is broken' }), urgent: noul('Does it need handling today?'), mood: score('How upset is the customer?', ['calm', 'annoyed', 'angry']) }"],
  decide: [['llms'], "Ticket.resources = { triage: (state) => state.text && decide({ model: 'jev-latest', state: state.text, questions }) }"],
  decideTest: [['llms'], "await t.respond('HTTP', answers(questions, { topic: 'bug', urgent: true }), 'triage')"],
  strict: [['llms'], "openResponses({ baseURL, model, strict: strictSchemas })"],
  assistant: [['llms'], "uses = { assistant: chat({ form: '.ask', prompt: '.prompt', instructions }) }"],
  formTool: [['llms'], "form(schema, { tool: formTool({ name, description }) })"],
  guides: [['llms'], '`node_modules/sygnal/dist/guide/ai-chat.md`'],
}
const F = Object.fromEntries(Object.entries(FRAGMENTS).map(([k, [, text]]) => [k, text]))
// evaluate an expression fragment with the given bindings
const evaluate = (fragment, bindings) => new Function(...Object.keys(bindings), 'return ' + fragment)(...Object.values(bindings))
const evaluateAsync = (fragment, bindings) => new Function(...Object.keys(bindings), 'return (async () => { ' + fragment + ' })()')(...Object.values(bindings))

let dir
let n = 0
const compile = (src, file) => ts.transpileModule(src, { fileName: file, compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'sygnal', module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, allowJs: true,
} }).outputText

async function load(name, src) {
  const file = path.join(dir, 'm' + (n++), name + '.mjs')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, compile(src, name + '.jsx'))
  return import(pathToFileURL(file).href)
}

function check(name, code) {
  const file = path.join(dir, 'check', name + '.jsx')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, code)
  return checkFiles([file], { cwd: path.dirname(file), strict: true }).map((d) => `${d.code} ${d.message}`)
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(here, '.p6-4l-samples-')) })
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })

// ── the modules: fixtures around the fragments ──────────────────────────────

const MODULES = {
  chat: `import { messageText } from 'sygnal/ai'
export function Chat({ state }) {
  return (
    <section>
      <ol>{state.messages.map((m) => <li className={m.role}>{messageText(m)}</li>)}</ol>
      {state.draft && <p className="draft">{state.draft}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      <label>Message <input className="prompt" value={state.prompt} /></label>
      <button className="send">Send</button>
      <button className="stop">Stop</button>
    </section>
  )
}
Chat.initialState = { messages: [], prompt: '', draft: '', error: null }
Chat.intent = ({ DOM }) => ({ TYPE: DOM.input('.prompt').value(), SEND: DOM.click('.send'), STOP: DOM.click('.stop') })
Chat.model = {
  TYPE: (s, prompt) => ({ ...s, prompt }),
  ${F.chatSend},
  STOP: { STATE: (s) => ({ ...s, draft: '' }), LLM: () => (${F.chatAbort}) },
  ${F.chatDelta},
  ${F.chatDone},
  FAILED: (s, { error }) => ({ ...s, draft: '', error: error.message }),
}
`,
  chatPlain: `import { chat, messageText } from 'sygnal/ai'
export function Chat({ state }) {
  const c = state.chat
  return (
    <section>
      <ol>{c.messages.map((m) => <li className={m.role}>{messageText(m)}</li>)}</ol>
      {c.draft && <p className="draft">{c.draft}</p>}
      {c.error && <p role="alert">{c.error} <button type="button" className="retry">Retry</button></p>}
      <form className="ask">
        <label>Message ${F.chatPrompt}</label>
        <button type="submit">Send</button>
        <button type="button" className="stop">Stop</button>
      </form>
      <button type="button" className="example">Ask the example</button>
    </section>
  )
}
Chat.${F.chatPlain}
Chat.intent = ({ DOM }) => ({ ASK_FROM_CODE: DOM.click('.example').map(() => 'From code') })
Chat.model = { ASK_FROM_CODE: { EFFECT: (state, text, next) => ${F.chatSendNext} } }
`,
  agent: `import { z } from 'zod'
export function TodoApp({ state }) {
  return <ul>{state.todos.map((todo) => <li>{todo.text}</li>)}</ul>
}
TodoApp.initialState = { todos: [{ id: 1, text: 'bread', done: true }], nextId: 2 }
TodoApp.model = {
  ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 }),
  CLEAR_DONE: (state) => ({ ...state, todos: state.todos.filter((todo) => !todo.done) }),
}
${F.agent}
`,
  decide: `import { decide, choice, noul, score } from 'sygnal/ai'
export ${F.questions}
export function Ticket({ state }) {
  const r = state.triage
  return <p className="topic">{r.status === 'success' ? r.data.answers.topic.choice : r.status}</p>
}
Ticket.initialState = { text: 'The app crashes on save' }
${F.decide}
`,
}

// ── the fragments are in the files ──────────────────────────────────────────

describe('every fragment is in its agent doc, verbatim', () => {
  for (const [name, [files, text]] of Object.entries(FRAGMENTS)) {
    for (const file of files) it(`${name} (${file})`, () => { expect(FILES[file]).toContain(text) })
  }
  it('the guides llms.txt names are shipped in dist/guide', () => {
    for (const g of ['ai-chat', 'ai-decisions', 'agent', 'webmcp', 'mcp-apps']) {
      expect(FILES.llms).toContain(g + '.md')
      expect(fs.existsSync(path.join(repo, 'dist/guide', g + '.md')), g).toBe(true)
    }
    for (const g of ['ai-chat', 'ai-decisions', 'agent']) expect(FILES.skill).toContain('`' + g + '.md`')
  })
})

// ── static: strict-clean and a11y-clean ─────────────────────────────────────

describe('sygnal-check --strict: no findings', () => {
  for (const [name, code] of Object.entries(MODULES)) {
    it(name, () => { expect(check(name, code)).toEqual([]) })
  }
})

// ── runtime ─────────────────────────────────────────────────────────────────

describe('chat', () => {
  it('SEND builds the request with the new message; DELTA, DONE; t.stream', async () => {
    const { Chat } = await load('Chat', MODULES.chat)
    t = renderComponent(Chat, { strict: true, sinkState: 'after' })
    t.simulateEvent('.prompt', 'input', { value: 'Hi' })
    t.simulateEvent('.send', 'click')
    await t.next((s) => s.messages.length === 1)
    expect(t.requests('LLM')).toHaveLength(1)
    expect(t.requests('LLM')[0]).toMatchObject({ messages: [{ role: 'user', content: 'Hi' }], key: 'reply', delta: 'DELTA', ok: 'DONE', error: 'FAILED' })
    expect(t.state.prompt).toBe('')
    await t.stream('LLM', ['Hel'], { end: false })
    expect(t.state.draft).toBe('Hel')
    await t.stream('LLM', ['lo'])
    expect(t.state.draft).toBe('')
    expect(t.state.messages.map(messageText)).toEqual(['Hi', 'Hello'])
    t.expectNoDiagnostics()
  })

  it("the llms.txt test line: await t.stream('LLM', ['Hel', 'lo'])", async () => {
    const { Chat } = await load('Chat', MODULES.chat)
    t = renderComponent(Chat, { strict: true, sinkState: 'after' })
    t.simulateEvent('.prompt', 'input', { value: 'Hi' })
    t.simulateEvent('.send', 'click')
    await t.next((s) => s.messages.length === 1)
    await evaluateAsync(F.chatStream, { t })
    expect(messageText(t.state.messages[1])).toBe('Hello')
    // the skill's form
    t.simulateEvent('.prompt', 'input', { value: 'Again' })
    t.simulateEvent('.send', 'click')
    await t.next((s) => s.messages.length === 3)
    await evaluate(F.chatStreamSkill, { t })
    expect(messageText(t.state.messages[3])).toBe('Hi')
  })

  it("STOP: { abort: 'reply' } ends the stream; nothing more arrives", async () => {
    const { Chat } = await load('Chat', MODULES.chat)
    t = renderComponent(Chat, { strict: true, sinkState: 'after' })
    t.simulateEvent('.prompt', 'input', { value: 'Hi' })
    t.simulateEvent('.send', 'click')
    await t.next((s) => s.messages.length === 1)
    await t.stream('LLM', ['Hel'], { end: false })
    t.simulateEvent('.stop', 'click')
    await t.settle()
    expect(t.state.draft).toBe('')
    expect(() => t.stream('LLM', ['lo'])).toThrow()
    expect(t.state.messages).toHaveLength(1)
  })

  it('the plain chat behavior: streams, Stop keeps the partial reply, Retry does not repeat the question', async () => {
    const { Chat } = await load('ChatPlain', MODULES.chatPlain)
    t = renderComponent(Chat, { strict: true, sinkState: 'after' })
    t.simulateEvent('.prompt', 'input', { value: 'Hi' })
    t.simulateEvent('.ask', 'submit')
    await t.settle()
    const req = t.requests('LLM').at(-1)
    expect(req.tools).toBeUndefined()
    expect(req.messages.map(messageText)).toEqual(['Hi'])
    await t.stream('LLM', ['Hel'], { end: false })
    t.simulateEvent('.stop', 'click')
    await t.settle()
    expect(t.state.chat.messages.map(messageText)).toEqual(['Hi', 'Hel'])
    t.simulateEvent('.prompt', 'input', { value: 'Again' })
    t.simulateEvent('.ask', 'submit')
    await t.settle()
    await t.fail('LLM', 429)
    expect(t.html()).toContain('HTTP 429')
    t.simulateEvent('.retry', 'click')
    await t.settle()
    expect(t.requests('LLM').at(-1).messages.map(messageText)).toEqual(['Hi', 'Hel', 'Again'])
    await t.respond('LLM', 'Hello')
    expect(t.state.chat.messages.map(messageText)).toEqual(['Hi', 'Hel', 'Again', 'Hello'])
    t.simulateEvent('.example', 'click')
    await t.settle()
    expect(t.requests('LLM').at(-1).messages.map(messageText).at(-1)).toBe('From code')
    t.expectNoDiagnostics()
  })

  it("the skill's one-off request shape", () => {
    expect(evaluate(F.chatRequestSkill.replace(/^\{/, '({').replace(/\}$/, '})'), { text: 'Summarise this' }))
      .toEqual({ messages: [{ role: 'user', content: 'Summarise this' }], delta: 'DELTA', ok: 'DONE', error: 'FAILED' })
  })

  it('a failure reaches FAILED as { error }', async () => {
    const { Chat } = await load('Chat', MODULES.chat)
    t = renderComponent(Chat, { sinkState: 'after' })
    t.simulateEvent('.prompt', 'input', { value: 'Hi' })
    t.simulateEvent('.send', 'click')
    await t.next((s) => s.messages.length === 1)
    await t.fail('LLM', 429)
    expect(t.state.error).toMatch(/429/)
  })

  it('the main.js lines build drivers and transports', () => {
    let drivers
    evaluate(F.chatRun, { run: (_, d) => { drivers = d }, App: () => null, makeChatDriver, openResponses })
    expect(typeof drivers.LLM).toBe('function')
    expect(typeof evaluate(`({ ${F.chatProd} })`, { uiMessageStream }).transport.stream).toBe('function')
    expect(typeof evaluate(F.strict, { openResponses, baseURL: 'http://localhost:11434/v1', model: 'llama3.2', strictSchemas }).stream).toBe('function')
    expect(typeof makeMcpAppDriver()).toBe('function')
  })

  it('the guide pointers construct: chat behavior, formTool', () => {
    const uses = evaluate(F.assistant.replace(/^uses = /, ''), { chat, instructions: 'You manage the todo list.' })
    expect(uses.assistant).toBeTruthy()
    const schema = { '~standard': { version: 1, vendor: 't', validate: (v) => ({ value: v }) } }
    expect(evaluate(F.formTool, { form, schema, formTool, name: 'add_todo', description: 'Add a todo' })).toBeTruthy()
  })
})

describe('the agent static', () => {
  it('declared actions are the tools; t.callTool; consequential needs confirm', async () => {
    const { TodoApp } = await load('TodoApp', MODULES.agent)
    t = renderComponent(TodoApp, { strict: true })
    await t.ready()
    expect(t.tools().map((x) => x.name).sort()).toEqual(['todos_add', 'todos_clear_done', 'todos_read'])
    const result = await evaluateAsync('return ' + F.callTool, { t })
    expect(result).toMatchObject({ ok: true, state: { todos: [{ id: 1, text: 'bread', done: true }, { id: 2, text: 'milk', done: false }] } })
    await expect(t.callTool('todos_clear_done')).rejects.toThrow()
    expect(await t.callTool('todos_clear_done', {}, { confirm: true })).toMatchObject({ ok: true })
    expect(t.state.todos.map((x) => x.text)).toEqual(['milk'])
    expect(t.agentContext()).toEqual({ todos: { todos: [{ id: 2, text: 'milk', done: false }] } })
  })

  it("abort('reason') (from 'sygnal') refuses a call and tells the model why", async () => {
    const src = MODULES.agent.replace("import { z } from 'zod'", "import { z } from 'zod'\nimport { abort } from 'sygnal'")
      .replace('ADD: (state, text) => (', `ADD: (state, text) => state.todos.some((todo) => todo.text === text) ? ${F.refuse} : (`)
    const { TodoApp } = await load('TodoAppRefuse', src)
    t = renderComponent(TodoApp)
    await t.ready()
    expect(await t.callTool('todos_add', { value: 'bread' })).toMatchObject({ ok: false, error: 'ADD was refused: reason' })
  })
})

describe('decisions', () => {
  it('decide() as a resource; answers() in the test', async () => {
    const mod = await load('Ticket', MODULES.decide)
    t = renderComponent(mod.Ticket, { strict: true })
    await t.ready()
    await evaluateAsync(F.decideTest, { t, answers, questions: mod.questions })
    const req = t.requests('HTTP')[0]
    expect(req).toMatchObject({ url: '/api/decide', method: 'POST', resource: 'triage' })
    expect(req.json).toMatchObject({ model: 'jev-latest', state: 'The app crashes on save' })
    expect(t.state.triage.data.answers.topic.choice).toBe('bug')
    expect(t.state.triage.data.answers.urgent.noul).toBeGreaterThan(0.5)
    expect(typeof t.state.triage.data.answers.mood.score).toBe('number')
    expect(t.query('.topic').textContent).toBe('bug')
  })
})
