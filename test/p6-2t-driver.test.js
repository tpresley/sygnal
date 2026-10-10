// @vitest-environment jsdom
// PLAN-6 L-2 (2-T): the transports under makeChatDriver + run() (jsdom, fixture fetches, no
// network): a tool round trip over openResponses, structured output under strict, uiMessageStream
// messages that an AI SDK server accepts back (approvals, server-run tools), chromePrompt over a
// LanguageModel stub, and SYG670 (an auth header from the browser to a hosted endpoint).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'
import { strictSchemas } from '../src/extra/ai/schema/strict.ts'
import { validateUIMessages, convertToModelMessages } from 'ai'
import run from '../src/extra/run.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { makeChatDriver } from '../src/extra/ai/chat/driver.ts'
import { driverFromAsync } from '../src/extra/driverFactories.ts'
import { renderComponent } from '../src/extra/testing.ts'
import { openResponses } from '../src/extra/ai/transports/openResponses.ts'
import { chatCompletions } from '../src/extra/ai/transports/chatCompletions.ts'
import { uiMessageStream } from '../src/extra/ai/transports/uiMessageStream.ts'
import { chromePrompt } from '../src/extra/ai/transports/chromePrompt.ts'
import { encodeOpenResponses } from '../src/extra/ai/transports/encodeOpenResponses.ts'
import { steps, aiSdkRoute, tool, jsonSchema } from './helpers/p6-ai-sdk-fixture.js'
import { toSSE, fixtureFetch, collect } from './helpers/p6-sse-fixture.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (cond, what) => {
  for (const end = Date.now() + 2000; !cond(); await sleep(2)) if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
}
const user = text => ({ role: 'user', parts: [{ type: 'text', text }] })

let app, errorSpy
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  errorSpy.mockRestore()
})

// a component whose GO action sends `request(state)`; every reply action is logged in `got`
function harness(transport, request) {
  const got = []
  function T() { return h('button', { className: 'go' }, 'go') }
  T.initialState = { messages: [] }
  T.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
  T.model = {
    GO: { LLM: request },
    ...Object.fromEntries(['DELTA', 'OK', 'ERR', 'TOOL'].map(a => [a, (s, d) => { got.push([a, d]); return s }])),
  }
  app = run(T, { LLM: makeChatDriver({ transport, coalesce: 'none' }) }, { mountPoint: '#root' })
  const go = async (n = 1) => { await until(() => document.querySelector('.go'), 'the view'); const before = got.filter(g => g[0] == 'OK' || g[0] == 'ERR').length; document.querySelector('.go').click(); await until(() => got.filter(g => g[0] == 'OK' || g[0] == 'ERR').length >= before + n, 'a reply') }
  return { got, go }
}
const ask = extra => s => ({ messages: s.messages, delta: 'DELTA', ok: 'OK', error: 'ERR', tool: 'TOOL', ...extra })

describe('openResponses under the driver', () => {
  it('a tool round trip: the tool reply, the message part, then the result goes back as items', async () => {
    let turn = 0
    const f = fixtureFetch(() => toSSE(encodeOpenResponses(turn++ == 0
      ? ['Let me check. ', { toolCall: { id: 'call_1', name: 'weather', input: { city: 'Hilo' } } }]
      : ['It is 24°C.'])))
    const transport = openResponses({ baseURL: 'http://localhost:11434/v1', model: 'llama3.2', fetch: f.fetch })
    let messages = [user('Weather in Hilo?')]
    const tools = { weather: { description: 'Weather', inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }
    const { got, go } = harness(transport, s => ({ messages, tools, delta: 'DELTA', ok: 'OK', error: 'ERR', tool: 'TOOL' }))
    await go()
    const ok = got.find(g => g[0] == 'OK')[1]
    expect(got.find(g => g[0] == 'TOOL')[1]).toEqual({ key: 'OK', call: { id: 'call_1', name: 'weather', input: { city: 'Hilo' } } })
    expect(ok).toMatchObject({ text: 'Let me check. ', finishReason: 'tool-calls', toolCalls: [{ id: 'call_1', name: 'weather', input: { city: 'Hilo' } }] })
    expect(ok.message.parts).toEqual([
      { type: 'text', text: 'Let me check. ' },
      { type: 'tool-weather', toolCallId: 'call_1', state: 'input-available', input: { city: 'Hilo' } },
    ])
    // the app runs the tool and sends the conversation again
    const answered = { ...ok.message, parts: ok.message.parts.map(p => p.toolCallId ? { ...p, state: 'output-available', output: { temp: 24 } } : p) }
    messages = [...messages, answered]
    got.length = 0
    await go()
    expect(f.calls[1].json.input).toEqual([
      { role: 'user', content: 'Weather in Hilo?' },
      { role: 'assistant', content: 'Let me check. ' },
      { type: 'function_call', call_id: 'call_1', name: 'weather', arguments: '{"city":"Hilo"}' },
      { type: 'function_call_output', call_id: 'call_1', output: '{"temp":24}' },
    ])
    expect(got.find(g => g[0] == 'OK')[1]).toMatchObject({ text: 'It is 24°C.', finishReason: 'stop', usage: undefined })
    expect(got.filter(g => g[0] == 'DELTA').map(g => g[1].delta)).toEqual(['It is 24°C.'])
  })

  it('structured output under strict: the forced nulls are dropped before validation', async () => {
    const f = fixtureFetch(() => toSSE(encodeOpenResponses(['{"title":"Buy milk",', '"note":null,"priority":"high"}'])))
    const output = z.object({ title: z.string(), note: z.string().optional(), priority: z.enum(['low', 'high']) })
    const { got, go } = harness(openResponses({ model: 'm', fetch: f.fetch, strict: strictSchemas }), ask({ messages: [user('x')], output }))
    await go()
    expect(f.calls[0].json.text.format).toMatchObject({ strict: true, schema: { required: ['title', 'note', 'priority'] } })
    expect(got.find(g => g[0] == 'OK')[1].value).toEqual({ title: 'Buy milk', priority: 'high' })
  })

  it('an HTTP failure reaches the error action with its status', async () => {
    const f = fixtureFetch(() => '{"error":{"message":"model not found"}}', { status: 404 })
    const { got, go } = harness(chatCompletions({ model: 'nope', fetch: f.fetch }), ask({ messages: [user('x')] }))
    await go()
    expect(got.find(g => g[0] == 'ERR')[1].error).toMatchObject({ status: 404, message: 'chatCompletions: HTTP 404: model not found' })
  })
})

describe('uiMessageStream under the driver', () => {
  it('builds UIMessages an AI SDK server takes back: server tools, client tool replies, approvals', async () => {
    const obj = jsonSchema({ type: 'object', properties: { city: { type: 'string' } } })
    const model = steps({ text: ['On it.'], calls: [{ id: 'c1', name: 'weather', input: { city: 'Hilo' } }, { id: 'c2', name: 'pick', input: { city: 'Hilo' } }, { id: 'c3', name: 'del', input: { city: 'Hilo' } }] })
    const r = aiSdkRoute(() => ({ model, tools: { weather: tool({ inputSchema: obj, execute: async () => ({ temp: 24 }) }), pick: tool({ inputSchema: obj }), del: tool({ inputSchema: obj, needsApproval: true, execute: async () => 'x' }) } }))
    const { got, go } = harness(uiMessageStream('/api/chat', { fetch: r.fetch }), ask({ messages: [{ id: 'u1', ...user('go') }] }))
    await go()
    expect(got.filter(g => g[0] == 'TOOL').map(g => g[1].call.name)).toEqual(['pick'])
    const ok = got.find(g => g[0] == 'OK')[1]
    expect(ok.toolCalls.map(c => c.id)).toEqual(['c2'])
    const byId = Object.fromEntries(ok.message.parts.filter(p => p.toolCallId).map(p => [p.toolCallId, p]))
    expect(byId.c1).toMatchObject({ type: 'tool-weather', state: 'output-available', output: { temp: 24 } })
    expect(byId.c2).toMatchObject({ type: 'tool-pick', state: 'input-available' })
    expect(byId.c3).toMatchObject({ type: 'tool-del', state: 'approval-requested', approval: { id: expect.any(String) } })
    const messages = [{ id: 'u1', ...user('go') }, { ...ok.message, id: ok.message.id ?? 'a1' }]
    await expect(validateUIMessages({ messages })).resolves.toHaveLength(2)
    await expect(convertToModelMessages(messages)).resolves.toBeTruthy()
  })
})

describe('chromePrompt (LanguageModel stub)', () => {
  const stub = (availability = 'available', chunks = ['Hi', ' there']) => {
    const log = { created: [], prompts: [], destroyed: 0 }
    const LanguageModel = {
      availability: vi.fn(async () => availability),
      create: vi.fn(async opts => {
        // as the Prompt API: a system prompt only as the first initial prompt
        if ((opts.initialPrompts || []).some((p, i) => i > 0 && p.role == 'system')) throw new TypeError('system role is only allowed first')
        log.created.push(opts)
        return {
          promptStreaming: (input, o) => { log.prompts.push([input, o]); return new ReadableStream({ start(c) { chunks.forEach(x => c.enqueue(x)); c.close() } }) },
          destroy: () => { log.destroyed++ },
        }
      }),
    }
    return { LanguageModel, log }
  }

  it('status() is availability(), or unavailable without the API', async () => {
    expect(await chromePrompt({ LanguageModel: stub('downloadable').LanguageModel }).status()).toBe('downloadable')
    expect(await chromePrompt().status()).toBe('unavailable')
  })

  it('streams the last user message over a session built from the rest; output as responseConstraint', async () => {
    const { LanguageModel, log } = stub()
    const t = chromePrompt({ LanguageModel, temperature: 0.2 })
    const ev = await collect(t, { instructions: 'Be brief', output: z.object({ a: z.string() }), messages: [user('one'), { role: 'assistant', content: 'two' }, user('three')] })
    expect(ev).toEqual([{ type: 'text', delta: 'Hi' }, { type: 'text', delta: ' there' }, { type: 'finish', reason: 'stop' }])
    expect(log.created[0]).toMatchObject({ temperature: 0.2, initialPrompts: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'one' }, { role: 'assistant', content: 'two' }] })
    expect(log.prompts[0][0]).toBe('three')
    expect(log.prompts[0][1].responseConstraint).toEqual({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })
    expect(log.destroyed).toBe(1)
  })

  it('G-630: system messages anywhere (and instructions) are joined into the one first system prompt', async () => {
    const { LanguageModel, log } = stub()
    const sys = text => ({ role: 'system', parts: [{ type: 'text', text }] })
    const ev = await collect(chromePrompt({ LanguageModel }), { instructions: 'Be brief', messages: [sys('Rule 1.'), user('one'), { role: 'assistant', content: 'two' }, sys('Now in French.'), user('three'), sys('After.')] })
    expect(ev.at(-1)).toEqual({ type: 'finish', reason: 'stop' })
    expect(log.created[0].initialPrompts).toEqual([{ role: 'system', content: 'Be brief\n\nRule 1.\n\nNow in French.\n\nAfter.' }, { role: 'user', content: 'one' }, { role: 'assistant', content: 'two' }])
    expect(log.prompts[0][0]).toBe('three')
    // no instructions, no system messages: no system prompt
    await collect(chromePrompt({ LanguageModel }), { messages: [user('a')] })
    expect(log.created[1].initialPrompts).toEqual([])
  })

  it('G-647: a component reads status() through driverFromAsync (no awaiting in main.js)', async () => {
    const { LanguageModel } = stub('downloadable')
    const transport = chromePrompt({ LanguageModel })
    const seen = []
    function T({ state }) { return h('p', { className: 'model' }, state.model) }
    T.initialState = { model: 'checking' }
    T.model = {
      BOOTSTRAP: { MODEL: () => ({ ok: 'MODEL_STATUS' }) },
      MODEL_STATUS: (s, status) => { seen.push(status); return { ...s, model: status } },
    }
    app = run(T, { LLM: makeChatDriver({ transport }), MODEL: driverFromAsync(transport.status) }, { mountPoint: '#root' })
    await until(() => document.querySelector('.model')?.textContent == 'downloadable', 'the status')
    expect(seen).toEqual(['downloadable'])
    // in a test (the summarize recipe): the MODEL fake answers it
    const t = renderComponent(T)
    await t.respond('MODEL', 'available')
    expect(t.state.model).toBe('available')
    t.dispose()
  })

  it('under the driver: text reaches ok; unavailable fails with status', async () => {
    const { got, go } = harness(chromePrompt({ LanguageModel: stub().LanguageModel }), ask({ messages: [user('hi')] }))
    await go()
    expect(got.find(g => g[0] == 'OK')[1].text).toBe('Hi there')
    app.dispose()
    const second = harness(chromePrompt({ LanguageModel: stub('unavailable').LanguageModel }), ask({ messages: [user('hi')] }))
    await second.go()
    expect(second.got.find(g => g[0] == 'ERR')[1].error).toMatchObject({ status: 'unavailable', message: expect.stringContaining('unavailable') })
  })
})

describe('SYG670: auth headers from the browser', () => {
  const tryIt = async (opts, baseURL) => {
    const f = fixtureFetch(() => toSSE(encodeOpenResponses(['ok'])))
    const t = openResponses({ model: 'm', fetch: f.fetch, baseURL, ...opts })
    let error
    try { await collect(t, { messages: [user('x')] }) } catch (e) { error = e }
    return { error, sent: f.calls.length }
  }

  it('refuses a hosted endpoint with an auth header (logged, nothing sent)', async () => {
    for (const headers of [{ Authorization: 'Bearer sk-test' }, { 'x-api-key': 'k' }, { 'API-KEY': 'k' }]) {
      const { error, sent } = await tryIt({ headers }, 'https://api.openai.com/v1')
      expect(sent).toBe(0)
      expect(error).toMatchObject({ code: 'SYG670', message: expect.stringContaining('refused to send an auth header from the browser to https://api.openai.com') })
    }
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('SYG670'))).toBe(true)
  })

  it('allows dangerouslyAllowBrowser, local hosts, the page origin and requests with no auth header', async () => {
    const auth = { headers: { Authorization: 'Bearer x' } }
    expect((await tryIt({ ...auth, dangerouslyAllowBrowser: true }, 'https://api.openai.com/v1')).sent).toBe(1)
    for (const local of ['http://localhost:11434/v1', 'http://127.0.0.1:8080/v1', 'http://[::1]:11434/v1', 'http://ollama.localhost/v1']) {
      expect((await tryIt(auth, local)).sent).toBe(1)
    }
    expect((await tryIt(auth, '/api/llm')).sent).toBe(1)
    expect((await tryIt(auth, `${location.origin}/v1`)).sent).toBe(1)
    expect((await tryIt({}, 'https://api.openai.com/v1')).sent).toBe(1)
  })

  it('reaches the error action under the driver; uiMessageStream and chatCompletions refuse too', async () => {
    const f = fixtureFetch(() => '')
    const { got, go } = harness(chatCompletions({ baseURL: 'https://openrouter.ai/api/v1', model: 'm', fetch: f.fetch, headers: { Authorization: 'Bearer x' } }), ask({ messages: [user('x')] }))
    await go()
    expect(got.find(g => g[0] == 'ERR')[1].error.code).toBe('SYG670')
    await expect(collect(uiMessageStream('https://chat.example.com/api', { fetch: f.fetch, headers: () => ({ authorization: 'x' }) }), { messages: [user('x')] })).rejects.toMatchObject({ code: 'SYG670' })
    expect(f.calls).toHaveLength(0)
  })
})
