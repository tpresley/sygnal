// PLAN-9 H-1: client tools in the chat behavior (dev-plans/research/ai-compose/chat-client-tools.md,
// D469). The app answers their calls with TOOL_OUTPUT; the 12 rules: tools in the request, the
// split of a reply's calls, when the next request goes, status, TOOL_OUTPUT's guard, STOP, SEND,
// REGENERATE, APPROVE / DENY, maxSteps, and the reload (rule 12, which also fixes a restored busy
// slice locking SEND in apps without client tools).
import { it, expect, afterEach, describe } from 'vitest'
import { z } from 'zod'
import { renderComponent } from '../src/extra/testing.ts'
import { persist } from '../src/extra/persist.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { chat, openToolCalls } from '../src/extra/ai/chat/behavior.ts'
import { messageText } from '../src/extra/ai/messages.ts'
import * as sygnal from '../src/index.ts'

const clientTools = {
  pick_date: { description: 'Ask the user to pick a date', inputSchema: z.object({ label: z.string().min(1), days: z.number().int().max(30) }) },
  confirm: { description: 'Ask the user to confirm', inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
}

function makeApp(opts = {}, extra = {}) {
  function App({ state }) {
    const a = state.assistant
    return h('main', null,
      h('ol', { className: 'conversation' }, ...a.messages.map((m) => h('li', { className: m.role }, messageText(m)))),
      h('p', { className: 'x' }, String(state.x)),
      h('form', { className: 'ask' }, h('input', { className: 'prompt', value: a.prompt }), h('button', { type: 'submit' }, 'Send')),
      h('button', { type: 'button', className: 'stop' }, 'Stop'),
      h('button', { type: 'button', className: 'again' }, 'Again'),
      h('button', { type: 'button', className: 'approve' }, 'Allow'),
      h('button', { type: 'button', className: 'deny' }, 'Deny'))
  }
  App.initialState = { x: 0, calls: [], done: 0 }
  App.model = {
    SET_X: (state, x) => ({ ...state, x }),
    'assistant.TOOL_CALL': (state, call) => ({ ...state, calls: [...state.calls, call] }),
    'assistant.DONE': (state) => ({ ...state, done: state.done + 1 }),
  }
  App.agent = { name: 'app', description: 'The app', read: (s) => ({ x: s.x }), actions: { SET_X: { description: 'Set x', input: z.number() } } }
  App.uses = { assistant: chat({ form: '.ask', prompt: '.prompt', stop: '.stop', regenerate: '.again', approve: '.approve', deny: '.deny', clientTools, ...opts }) }
  Object.assign(App, extra)
  return App
}

let t
afterEach(() => { t?.dispose(); t = null })
const S = () => t.state.assistant
const ask = async (text) => {
  t.simulateEvent('.prompt', 'input', { value: text })
  t.simulateEvent('.ask', 'submit')
  await t.settle()
}
const last = () => t.requests('LLM').at(-1)
const parts = (m) => m.parts.filter((p) => p.type.startsWith('tool-'))
const lastParts = () => parts(S().messages.at(-1))
async function waitUntil(f, tries = 50) {
  for (let i = 0; i < tries && !f(); i++) await t.settle()
  if (!f()) throw new Error('timed out')
}
const codes = () => t.diagnostics.map((d) => d.code)

describe('H-1 client tools', () => {
  it('a client call stays open (status ready, TOOL_CALL once, no DONE); TOOL_OUTPUT sends the next request', async () => {
    t = renderComponent(makeApp())
    await ask('When?')
    const first = last()
    // rule 1: the client tools go with the agent tools; a Standard Schema as its JSON Schema
    expect(Object.keys(first.tools).sort()).toEqual(['app_read', 'app_set_x', 'confirm', 'pick_date'])
    expect(first.tools.pick_date).toMatchObject({ description: 'Ask the user to pick a date', inputSchema: { type: 'object', properties: { label: { type: 'string' }, days: { type: 'integer' } } } })
    expect(first.tools.confirm.inputSchema).toEqual(clientTools.confirm.inputSchema)

    await t.stream('LLM', ['Let me ask.', { toolCall: { id: 'c1', name: 'pick_date', input: { label: 'Arrival', days: '3' } } }])
    await t.settle()
    expect(lastParts()).toMatchObject([{ type: 'tool-pick_date', toolCallId: 'c1', state: 'input-available', input: { label: 'Arrival', days: '3' } }])
    // rule 4: only the user's answer is outstanding
    expect(S().status).toBe('ready')
    expect(t.state.done).toBe(0)
    // rule 2: TOOL_CALL with the validated (repaired) input, once
    expect(t.state.calls).toEqual([{ id: 'c1', name: 'pick_date', input: { label: 'Arrival', days: 3 } }])
    expect(openToolCalls(S()).map((p) => p.toolCallId)).toEqual(['c1'])
    expect(t.requests('LLM')).toHaveLength(1)

    t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'c1', output: { date: '2026-11-02' } })
    await t.settle()
    expect(t.requests('LLM')).toHaveLength(2)
    const req = last()
    expect(req.continue).toBe(true)
    expect(parts(req.messages.at(-1))).toMatchObject([{ toolCallId: 'c1', state: 'output-available', output: { date: '2026-11-02' } }])
    expect(S().status).toBe('submitted')
    expect(openToolCalls(S())).toEqual([])
    await t.stream('LLM', ['Booked for Nov 2.'])
    await t.settle()
    expect(S().status).toBe('ready')
    expect(t.state.done).toBe(1)
    expect(S().messages).toHaveLength(2)
    expect(t.state.calls).toHaveLength(1)
    t.expectNoDiagnostics()
  })

  it('several open calls: the request goes once the last one is answered (errorText: output-error)', async () => {
    t = renderComponent(makeApp())
    await ask('Plan it')
    await t.stream('LLM', [{ toolCall: { id: 'a', name: 'pick_date', input: { label: 'From', days: 1 } } }, { toolCall: { id: 'b', name: 'confirm', input: { question: 'Sure?' } } }])
    await t.settle()
    expect(openToolCalls(S()).map((p) => p.toolCallId)).toEqual(['a', 'b'])
    expect(t.state.calls.map((c) => c.id)).toEqual(['a', 'b'])
    t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'b', errorText: 'the user closed the dialog' })
    await t.settle()
    expect(t.requests('LLM')).toHaveLength(1)
    expect(S().status).toBe('ready')
    t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'a', output: '2026-11-02' })
    await t.settle()
    expect(t.requests('LLM')).toHaveLength(2)
    expect(parts(last().messages.at(-1))).toMatchObject([
      { toolCallId: 'a', state: 'output-available', output: '2026-11-02' },
      { toolCallId: 'b', state: 'output-error', errorText: 'the user closed the dialog' },
    ])
  })

  it('rule 2: an input that fails its Standard Schema closes at once with the issues, and the model gets it', async () => {
    t = renderComponent(makeApp())
    await ask('When?')
    await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'pick_date', input: { label: '', days: 99 } } }])
    await t.settle()
    expect(t.state.calls).toEqual([])
    expect(t.requests('LLM')).toHaveLength(2)
    const p = parts(last().messages.at(-1))[0]
    expect(p.state).toBe('output-error')
    expect(p.errorText).toMatch(/^Invalid input: label: .*; days: /)
    expect(last().continue).toBe(true)
  })

  it('rule 5: TOOL_OUTPUT for a call that is not open does nothing (SYG685)', async () => {
    t = renderComponent(makeApp())
    await ask('Go')
    await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'confirm', input: { question: 'Sure?' } } }])
    await t.settle()
    const before = S()
    t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'nope', output: 1 })
    await t.settle()
    expect(S()).toBe(before)
    expect(codes()).toEqual(['SYG685'])
    t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'c1', output: true })
    await t.settle()
    // answered: a second answer is late
    t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'c1', output: false })
    await t.settle()
    expect(codes()).toEqual(['SYG685', 'SYG685'])
    expect(parts(S().messages.at(-1))[0].output).toBe(true)
  })

  it('rule 6: STOP closes open calls as not answered; nothing is sent; a late answer is dropped', async () => {
    t = renderComponent(makeApp())
    await ask('Go')
    await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'confirm', input: { question: 'Sure?' } } }])
    await t.settle()
    t.simulateEvent('.stop', 'click')
    await t.settle()
    expect(lastParts()).toMatchObject([{ state: 'output-error', errorText: 'not answered: stopped by the user' }])
    expect(S().status).toBe('ready')
    expect(t.requests('LLM')).toHaveLength(1)
    expect(t.state.done).toBe(0)
    t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'c1', output: true })
    await t.settle()
    expect(t.requests('LLM')).toHaveLength(1)
    expect(codes()).toEqual(['SYG685'])
  })

  it('rule 7: SEND closes open calls ("the user sent a new message") and sends the new turn', async () => {
    t = renderComponent(makeApp())
    await ask('Go')
    await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'confirm', input: { question: 'Sure?' } } }])
    await t.settle()
    await ask('Actually, never mind')
    expect(t.requests('LLM')).toHaveLength(2)
    const msgs = last().messages.filter((m) => m.id !== 'sygnal-app-state')
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(parts(msgs[1])).toMatchObject([{ state: 'output-error', errorText: 'not answered: the user sent a new message' }])
    expect(last().continue).toBeUndefined()
  })

  it('rule 8: REGENERATE drops the message with its open call; a late answer is dropped', async () => {
    t = renderComponent(makeApp())
    await ask('Go')
    await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'confirm', input: { question: 'Sure?' } } }])
    await t.settle()
    t.simulateEvent('.again', 'click')
    await t.settle()
    expect(S().messages.map((m) => m.role)).toEqual(['user'])
    expect(S().status).toBe('submitted')
    expect(t.requests('LLM')).toHaveLength(2)
    t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'c1', output: true })
    await t.settle()
    expect(t.requests('LLM')).toHaveLength(2)
    expect(codes()).toEqual(['SYG685'])
  })

  it('rule 3 with agent calls: the agent call runs, the client call waits, whichever finishes last sends', async () => {
    t = renderComponent(makeApp())
    await ask('Set x to 5 and confirm')
    await t.stream('LLM', [{ toolCall: { id: 'g', name: 'app_set_x', input: { value: 5 } } }, { toolCall: { id: 'c', name: 'confirm', input: { question: 'OK?' } } }])
    await waitUntil(() => t.state.x === 5 && lastParts()[0].state === 'output-available')
    expect(t.requests('LLM')).toHaveLength(1)
    expect(S().status).toBe('ready')
    expect(lastParts().map((p) => p.state)).toEqual(['output-available', 'input-available'])
    t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'c', output: 'yes' })
    await t.settle()
    expect(t.requests('LLM')).toHaveLength(2)
    expect(parts(last().messages.at(-1)).map((p) => p.state)).toEqual(['output-available', 'output-available'])
  })

  it('rule 9: a server approval and a client call: APPROVE answers the approval, the call still waits', async () => {
    t = renderComponent(makeApp())
    await ask('Delete it and confirm')
    await t.stream('LLM', [
      { type: 'tool-call', id: 's1', name: 'del', input: { what: 'it' }, executed: true },
      { type: 'tool-approval', id: 's1', approval: { id: 'ap1' } },
      { toolCall: { id: 'c', name: 'confirm', input: { question: 'Also this?' } } },
    ])
    await t.settle()
    expect(S().pending).toMatchObject({ approvalId: 'ap1', component: 'server' })
    expect(S().status).toBe('streaming')
    t.simulateEvent('.approve', 'click')
    await t.settle()
    expect(t.requests('LLM')).toHaveLength(1)
    expect(S()).toMatchObject({ status: 'ready', pending: null })
    t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'c', output: 'fine' })
    await t.settle()
    expect(t.requests('LLM')).toHaveLength(2)
    expect(parts(last().messages.at(-1)).map((p) => p.state)).toEqual(['approval-responded', 'output-available'])
  })

  it('rule 11: past maxSteps a client call is closed as not run and the turn ends; the request after an answer is a step', async () => {
    t = renderComponent(makeApp({ maxSteps: 2 }))
    await ask('Go')
    await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'confirm', input: { question: '1?' } } }])
    await t.settle()
    t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'c1', output: true })
    await t.settle()
    expect(t.requests('LLM')).toHaveLength(2)
    await t.stream('LLM', [{ toolCall: { id: 'c2', name: 'confirm', input: { question: '2?' } } }])
    await t.settle()
    expect(lastParts().at(-1)).toMatchObject({ toolCallId: 'c2', state: 'output-error', errorText: 'not run: the step limit (maxSteps 2) was reached' })
    expect(S().status).toBe('ready')
    expect(t.state.done).toBe(1)
    expect(t.state.calls.map((c) => c.id)).toEqual(['c1'])
  })

  it('rule 1: a client tool with an agent tool\'s name wins (SYG684)', async () => {
    t = renderComponent(makeApp({ clientTools: { ...clientTools, app_set_x: { description: 'Mine', inputSchema: { type: 'object' } } } }))
    await ask('Go')
    expect(last().tools.app_set_x.description).toBe('Mine')
    expect(codes()).toContain('SYG684')
    await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'app_set_x', input: { value: 3 } } }])
    await t.settle()
    // the app answers it: the agent action doesn't run
    expect(t.state.x).toBe(0)
    expect(openToolCalls(S()).map((p) => p.toolCallId)).toEqual(['c1'])
  })

  it('exports: openToolCalls from sygnal; an empty or non-assistant state has none', () => {
    expect(sygnal.openToolCalls).toBe(openToolCalls)
    expect(openToolCalls({ messages: [] })).toEqual([])
    expect(openToolCalls({ messages: [{ role: 'user', parts: [] }] })).toEqual([])
    expect(openToolCalls(undefined)).toEqual([])
  })
})

describe('rule 12: reload (persist restores the whole slice)', () => {
  it('a slice saved mid-reply is usable again: status ready, the partial reply kept, SEND works (was locked)', async () => {
    const App = makeApp({}, { persist: persist({ key: 'c', pick: ['assistant'] }) })
    t = renderComponent(App)
    await ask('Hi')
    await t.stream('LLM', ['Hel'], { end: false })
    await t.settle()
    expect(S().status).toBe('streaming')
    const saved = t.storage('c')
    t.dispose()
    t = renderComponent(App, { storage: { c: saved } })
    await t.ready()
    expect(S()).toMatchObject({ status: 'ready', draft: '' })
    expect(S().messages.map(messageText)).toEqual(['Hi', 'Hel'])
    await ask('Again')
    expect(S().status).toBe('submitted')
    expect(t.requests('LLM')).toHaveLength(1)
  })

  it('also without client tools; a fresh app gets no RESUME', async () => {
    function Plain({ state }) { return h('form', { className: 'ask' }, h('input', { className: 'prompt', value: state.assistant.prompt })) }
    Plain.uses = { assistant: chat({ form: '.ask', prompt: '.prompt' }) }
    Plain.persist = persist({ key: 'p', pick: ['assistant'] })
    t = renderComponent(Plain)
    await t.ready()
    expect(t.actions.map((a) => a.type)).not.toContain('assistant.RESUME')
    await ask('Hi')
    const saved = t.storage('p')
    expect(saved.state.assistant.status).toBe('submitted')
    t.dispose()
    t = renderComponent(Plain, { storage: { p: saved } })
    await t.ready()
    expect(t.actions.map((a) => a.type)).toContain('assistant.RESUME')
    expect(S().status).toBe('ready')
    await ask('Again')
    expect(t.requests('LLM')).toHaveLength(1)
  })

  it('an open client call stays answerable after a reload; an agent call left open is closed as not run', async () => {
    const App = makeApp({}, { persist: persist({ key: 'c', pick: ['assistant'] }) })
    t = renderComponent(App)
    await ask('Go')
    await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'confirm', input: { question: 'Sure?' } } }])
    await t.settle()
    const saved = t.storage('c')
    // a saved slice whose agent call was still running
    const running = structuredClone(saved)
    const m = running.state.assistant.messages.at(-1)
    m.parts.push({ type: 'tool-app_set_x', toolCallId: 'g1', state: 'input-available', input: { value: 1 } })
    running.state.assistant.status = 'streaming'
    t.dispose()

    t = renderComponent(App, { storage: { c: saved } })
    await t.ready()
    expect(S().status).toBe('ready')
    t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'c1', output: true })
    await t.settle()
    expect(t.requests('LLM')).toHaveLength(1)
    expect(parts(last().messages.at(-1))).toMatchObject([{ toolCallId: 'c1', state: 'output-available', output: true }])
    t.dispose()

    t = renderComponent(App, { storage: { c: running } })
    await t.ready()
    expect(S().status).toBe('ready')
    expect(lastParts().map((p) => [p.toolCallId, p.state, p.errorText])).toEqual([['c1', 'input-available', undefined], ['g1', 'output-error', 'not run: the page was reloaded']])
  })
})
