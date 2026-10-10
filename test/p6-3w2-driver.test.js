// @vitest-environment jsdom
// PLAN-6 L-2 (3-W2): the wave-2 transports under makeChatDriver + run() (jsdom, fixture fetches,
// no network): an Anthropic thinking + tool round trip (the signed reasoning part goes back as a
// thinking block), an AG-UI agent's state as a data part, fromAISDK's tool loop over the AI SDK's
// mock model, and SYG670 for anthropicMessages.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { streamText } from 'ai'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'
import run from '../src/extra/run.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { makeChatDriver } from '../src/extra/ai/chat/driver.ts'
import { anthropicMessages } from '../src/extra/ai/transports/anthropicMessages.ts'
import { agui } from '../src/extra/ai/transports/agui.ts'
import { fromAISDK } from '../src/extra/ai/transports/fromAISDK.ts'
import { toSSE, dataSSE, fixtureFetch } from './helpers/p6-sse-fixture.js'

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

// a component whose GO action sends `request(state)`; reply actions are logged in `got`, and OK
// appends the message (plus the tool results the test provides) to the conversation
function harness(transport, request, results = {}) {
  const got = []
  function T() { return h('button', { className: 'go' }, 'go') }
  T.initialState = { messages: [user('weather in Hilo?')] }
  T.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
  T.model = {
    GO: { LLM: request },
    OK: (s, d) => {
      got.push(['OK', d])
      const message = { ...d.message, parts: d.message.parts.map(p => results[p.toolCallId] !== undefined ? { ...p, state: 'output-available', output: results[p.toolCallId] } : p) }
      return { ...s, messages: [...s.messages, message] }
    },
    ...Object.fromEntries(['DELTA', 'ERR', 'TOOL'].map(a => [a, (s, d) => { got.push([a, d]); return s }])),
  }
  app = run(T, { LLM: makeChatDriver({ transport, coalesce: 'none' }) }, { mountPoint: '#root' })
  const go = async () => {
    await until(() => document.querySelector('.go'), 'the view')
    const before = got.filter(g => g[0] == 'OK' || g[0] == 'ERR').length
    document.querySelector('.go').click()
    await until(() => got.filter(g => g[0] == 'OK' || g[0] == 'ERR').length > before, 'a reply')
  }
  return { got, go }
}
const ask = s => ({ messages: s.messages, delta: 'DELTA', ok: 'OK', error: 'ERR', tool: 'TOOL' })

describe('anthropicMessages under the driver', () => {
  it('thinking + tool call, then the signed thinking block and the tool result go back', async () => {
    let turn = 0
    const f = fixtureFetch(() => toSSE(turn++ == 0 ? [
      { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 5, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Use the tool.' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":"Hilo"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
      { type: 'message_stop' },
    ] : [
      { type: 'message_start', message: { id: 'msg_2', usage: { input_tokens: 9, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '24°C.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
      { type: 'message_stop' },
    ]))
    const tools = { get_weather: { description: 'Weather', inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }
    const { got, go } = harness(anthropicMessages({ model: 'claude-opus-5-5', fetch: f.fetch }), s => ({ ...ask(s), tools }), { toolu_1: { tempC: 24 } })
    await go()
    const ok = got.find(g => g[0] == 'OK')[1]
    expect(ok.message.id).toBe('msg_1')
    expect(ok.message.parts).toEqual([
      { type: 'reasoning', text: 'Use the tool.', providerMetadata: { anthropic: { signature: 'SIG' } } },
      { type: 'tool-get_weather', toolCallId: 'toolu_1', state: 'input-available', input: { city: 'Hilo' } },
    ])
    expect(ok.finishReason).toBe('tool-calls')
    expect(got.find(g => g[0] == 'TOOL')[1].call).toEqual({ id: 'toolu_1', name: 'get_weather', input: { city: 'Hilo' } })
    await go()
    expect(f.calls[1].json.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'weather in Hilo?' }] },
      { role: 'assistant', content: [
        { type: 'thinking', thinking: 'Use the tool.', signature: 'SIG' },
        { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Hilo' } },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"tempC":24}' }] },
    ])
    expect(got.filter(g => g[0] == 'OK')[1][1].text).toBe('24°C.')
  })

  it('two thinking blocks stay two reasoning parts (a signed part is closed)', async () => {
    const think = (i, text, sig) => [
      { type: 'content_block_start', index: i, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: i, delta: { type: 'thinking_delta', thinking: text } },
      { type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: sig } },
      { type: 'content_block_stop', index: i },
    ]
    const f = fixtureFetch(() => toSSE([{ type: 'message_start', message: { id: 'm' } }, ...think(0, 'one', 'S1'), { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'R' } }, { type: 'content_block_stop', index: 1 }, ...think(2, 'two', 'S2'), { type: 'message_stop' }]))
    const { got, go } = harness(anthropicMessages({ model: 'm', fetch: f.fetch }), ask)
    await go()
    expect(got.find(g => g[0] == 'OK')[1].message.parts).toEqual([
      { type: 'reasoning', text: 'one', providerMetadata: { anthropic: { signature: 'S1' } } },
      { type: 'reasoning', text: '', providerMetadata: { anthropic: { redactedData: 'R' } } },
      { type: 'reasoning', text: 'two', providerMetadata: { anthropic: { signature: 'S2' } } },
    ])
  })

  it('SYG670: an x-api-key to a hosted endpoint from the browser is refused', async () => {
    const f = fixtureFetch(() => '')
    const { got, go } = harness(anthropicMessages({ baseURL: 'https://api.anthropic.com/v1', model: 'm', fetch: f.fetch, headers: { 'x-api-key': 'sk' } }), ask)
    await go()
    expect(got.find(g => g[0] == 'ERR')[1].error.message).toMatch(/SYG670|refused/)
    expect(f.calls).toHaveLength(0)
  })
})

describe('agui under the driver', () => {
  it("the agent's state as a data-agui-state part (replaced, not appended), then text", async () => {
    const f = fixtureFetch(() => dataSSE([
      { type: 'RUN_STARTED', threadId: 't', runId: 'r' },
      { type: 'STATE_SNAPSHOT', snapshot: { step: 1 } },
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Working.' },
      { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/step', value: 2 }] },
      { type: 'RUN_FINISHED', threadId: 't', runId: 'r' },
    ], false))
    const { got, go } = harness(agui('/agent', { fetch: f.fetch }), ask)
    await go()
    const ok = got.find(g => g[0] == 'OK')[1]
    expect(ok.message.parts).toEqual([
      { type: 'data-agui-state', id: 'state', data: { step: 2 } },
      { type: 'text', text: 'Working.' },
    ])
    expect(ok.message.id).toBe('m1')
  })
})

describe('fromAISDK under the driver', () => {
  it('a tool loop: the call, then the result goes back to the model as a tool message', async () => {
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
    let i = 0
    const model = new MockLanguageModelV4({
      doStream: async () => ({ stream: convertArrayToReadableStream(i++ == 0
        ? [{ type: 'tool-call', toolCallId: 'c1', toolName: 'get_weather', input: '{"city":"Hilo"}' }, { type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_use' } }]
        : [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: '24°C.' }, { type: 'text-end', id: 't' }, { type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } }]) }),
    })
    const tools = { get_weather: { inputSchema: { type: 'object', properties: { city: { type: 'string' } } } } }
    const { got, go } = harness(fromAISDK({ streamText, model }), s => ({ ...ask(s), tools }), { c1: { tempC: 24 } })
    await go()
    expect(got.find(g => g[0] == 'TOOL')[1].call).toEqual({ id: 'c1', name: 'get_weather', input: { city: 'Hilo' } })
    await go()
    const prompt = model.doStreamCalls[1].prompt
    expect(prompt.map(p => p.role)).toEqual(['user', 'assistant', 'tool'])
    expect(prompt[2].content[0]).toMatchObject({ type: 'tool-result', toolCallId: 'c1', toolName: 'get_weather', output: { type: 'json', value: { tempC: 24 } } })
    expect(got.filter(g => g[0] == 'OK')[1][1].text).toBe('24°C.')
  })
})
