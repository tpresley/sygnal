// @vitest-environment jsdom
// PLAN-6 G-640: every chat message has a stable id from when it is made: the user's on SEND, the
// reply's from the driver (the transport's start id, else a new one; a turn's later steps keep the
// id of the message they continue), the app-state message always 'sygnal-app-state'. Tested
// against a real AI SDK 7 route that persists the conversation the documented way: it validates
// the client's messages, sends them all to the model, and keeps only those without
// `metadata.sygnal` (the app state is per request).
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { streamText, tool, jsonSchema, convertToModelMessages, validateUIMessages } from 'ai'
import run from '../src/extra/run.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { chat } from '../src/extra/ai/chat/behavior.ts'
import { makeChatDriver } from '../src/extra/ai/chat/driver.ts'
import { messageId, messageText } from '../src/extra/ai/messages.ts'
import { uiMessageStream } from '../src/extra/ai/transports/uiMessageStream.ts'
import { memoryTransport } from '../src/extra/ai/chat/memoryTransport.ts'
import { steps } from './helpers/p6-ai-sdk-fixture.js'

function Todos({ state }) { return h('ul', null, ...state.todos.map((x) => h('li', null, x))) }
Todos.initialState = { todos: [] }
Todos.model = { ADD: (s, text) => ({ ...s, todos: [...s.todos, text] }) }
Todos.agent = {
  name: 'todos', read: (s) => ({ todos: s.todos }),
  actions: { ADD: { description: 'Add a todo', input: z.string().min(1) } },
}
Todos.uses = { assistant: chat({ instructions: 'You manage todos.' }) }

const sleep = (ms = 5) => new Promise((r) => setTimeout(r, ms))
async function until(f) {
  for (let i = 0; i < 400 && !f(); i++) await sleep()
  if (!f()) throw new Error('timed out')
}

/** an AI SDK route that stores the conversation (`db`), as the guide shows */
function persistingRoute(model, { serverIds = true } = {}) {
  const calls = [], db = new Map()
  let n = 0
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    const messages = await validateUIMessages({ messages: body.messages })
    // the guide's filter: the app state is per request, don't store it
    const stored = messages.filter((m) => !m.metadata?.sygnal)
    const tools = Object.fromEntries(Object.entries(body.tools || {}).map(([k, x]) => [k, tool({ description: x.description, inputSchema: jsonSchema(x.inputSchema) })]))
    const result = streamText({ model, system: body.instructions, tools, messages: await convertToModelMessages(messages, { tools }), abortSignal: init.signal })
    return result.toUIMessageStreamResponse({
      originalMessages: stored,
      ...(serverIds && { generateMessageId: () => 'srv' + n++ }),
      onFinish: ({ messages }) => { db.set(body.id ?? 'chat', messages) },
    })
  }
  return { fetch, calls, db }
}

describe('G-640: stable message ids', () => {
  it('messageId(): 16 characters [0-9a-z], different each time', () => {
    const ids = new Set(Array.from({ length: 200 }, messageId))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[0-9a-z]{16}$/)
  })

  it('a turn with a client tool: ids are stable across requests; the server stores no app state', async () => {
    const model = steps(
      { calls: [{ id: 'c1', name: 'todos_add', input: { value: 'milk' } }] },
      { text: ['Added milk.'] },
      { text: ['You have milk.'] },
    )
    const r = persistingRoute(model)
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(Todos, { LLM: makeChatDriver({ transport: uiMessageStream('/api/chat', { fetch: r.fetch }), coalesce: 'none' }) }, { mountPoint: '#root' })
    const S = () => app.__runtime.getState().assistant
    try {
      await app.__runtime.flushed()
      app.__runtime.dispatch('root', 'assistant.SEND', 'add milk')
      await until(() => S().status === 'ready' && r.calls.length === 2)
      expect(app.__runtime.getState().todos).toEqual(['milk'])
      const [u, a] = S().messages
      expect(u.id).toMatch(/^[0-9a-z]{16}$/)
      // the reply takes the server's id (its start chunk), and the tool step continues it
      expect(a.id).toBe('srv0')
      expect(messageText(a)).toBe('Added milk.')
      const ids = (b) => b.messages.map((m) => m.id)
      expect(ids(r.calls[0])).toEqual(['sygnal-app-state', u.id])
      expect(ids(r.calls[1])).toEqual(['sygnal-app-state', u.id, 'srv0'])
      expect(r.calls[1].messageId).toBe('srv0')
      expect(r.calls[1].messages[0].metadata).toMatchObject({ sygnal: 'sygnal-app-state' })
      // the server kept the conversation without the app state, under the client's ids
      expect(r.db.get('chat').map((m) => m.id)).toEqual([u.id, 'srv0'])
      expect(messageText(r.db.get('chat')[1])).toBe('Added milk.')

      // a new turn: the earlier ids are sent unchanged; the server's store round-trips
      app.__runtime.dispatch('root', 'assistant.SEND', 'what do I have?')
      await until(() => S().status === 'ready' && S().messages.length === 4)
      const u2 = S().messages[2]
      expect(ids(r.calls[2])).toEqual([u.id, 'srv0', 'sygnal-app-state', u2.id])
      expect(S().messages.map((m) => m.id)).toEqual([u.id, 'srv0', u2.id, 'srv1'])
      expect(r.db.get('chat').map((m) => m.id)).toEqual([u.id, 'srv0', u2.id, 'srv1'])
      await expect(validateUIMessages({ messages: r.db.get('chat') })).resolves.toHaveLength(4)
    } finally { app.dispose() }
  })

  it('a server that sends no message id: the driver makes one, and the turn keeps it', async () => {
    const model = steps({ calls: [{ id: 'c1', name: 'todos_add', input: { value: 'eggs' } }] }, { text: ['Done.'] })
    const r = persistingRoute(model, { serverIds: false })
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(Todos, { LLM: makeChatDriver({ transport: uiMessageStream('/api/chat', { fetch: r.fetch }), coalesce: 'none' }) }, { mountPoint: '#root' })
    const S = () => app.__runtime.getState().assistant
    try {
      await app.__runtime.flushed()
      app.__runtime.dispatch('root', 'assistant.SEND', 'add eggs')
      await until(() => S().status === 'ready' && r.calls.length === 2)
      const a = S().messages[1]
      expect(a.id).toMatch(/^[0-9a-z]{16}$/)
      expect(r.calls[1].messageId).toBe(a.id)
      expect(r.calls[1].messages.at(-1).id).toBe(a.id)
      expect(S().messages.length).toBe(2)
      expect(r.db.get('chat').map((m) => m.id)).toEqual([S().messages[0].id, a.id])
    } finally { app.dispose() }
  })

  it('a continued message keeps its id whatever the transport\'s start says (a provider response id)', async () => {
    const streams = []
    const transport = memoryTransport({ onStream: (s) => streams.push(s) })
    function C({ state }) { return h('p', null, state.out ? messageText(state.out) : '') }
    C.initialState = { out: null }
    const prev = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'One.' }] }
    C.model = {
      GO: { LLM: () => ({ messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'x' }] }, prev], continue: true, ok: 'OK' }) },
      NEW: { LLM: () => ({ messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'x' }] }], ok: 'OK' }) },
      OK: (s, d) => ({ ...s, out: d.message }),
    }
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(C, { LLM: makeChatDriver({ transport, coalesce: 'none' }) }, { mountPoint: '#root' })
    const out = () => app.__runtime.getState().out
    try {
      await app.__runtime.flushed()
      app.__runtime.dispatch('root', 'GO')
      await until(() => streams.length === 1)
      streams[0].push({ type: 'start', id: 'resp_2' }, 'Two.').end()
      await until(() => out())
      expect(out().id).toBe('a1')
      // a new message takes the start id
      app.__runtime.dispatch('root', 'NEW')
      await until(() => streams.length === 2)
      streams[1].push({ type: 'start', id: 'resp_3' }, 'Three.').end()
      await until(() => out().id !== 'a1')
      expect(out().id).toBe('resp_3')
    } finally { app.dispose() }
  })
})
