// PLAN-6 L-2 (2-T): chatCompletions() over hand-written Chat Completions SSE in OpenAI's and
// Ollama's exact shapes (no network): `[DONE]`, tool_calls deltas by index (interleaved parallel
// calls), stream_options.include_usage, reasoning fields, errors, abort, the request body
// (messages, tools, response_format) and strict mode.
import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { strictSchemas } from '../src/extra/ai/schema/strict.ts'
import { chatCompletions } from '../src/extra/ai/transports/chatCompletions.ts'
import { dataSSE, fixtureFetch, collect } from './helpers/p6-sse-fixture.js'
import { configureDiagnostics, getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.ts'
import { setupChecks } from './diagnostics/helpers.js'

const user = text => ({ role: 'user', parts: [{ type: 'text', text }] })
const chunk = (delta, finish_reason = null, extra = {}) => ({ id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason }], ...extra })
const transport = (body, opts = {}, fx = {}) => {
  const f = fixtureFetch(() => body, fx)
  return { f, t: chatCompletions({ baseURL: 'http://localhost:11434/v1/', model: 'llama3.2', fetch: f.fetch, ...opts }) }
}
afterEach(() => { configureDiagnostics({ mode: 'off' }); clearDiagnostics() })

describe('chatCompletions: events', () => {
  it('text, usage chunk and [DONE] (OpenAI shape)', async () => {
    const { t } = transport(dataSSE([
      chunk({ role: 'assistant', content: '' }),
      chunk({ content: 'Hel' }),
      chunk({ content: 'lo' }),
      chunk({}, 'stop'),
      { id: 'chatcmpl-1', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11, completion_tokens_details: { reasoning_tokens: 0 } } },
    ]))
    expect(await collect(t, { messages: [user('hi')] })).toEqual([
      { type: 'start', id: 'chatcmpl-1' },
      { type: 'text', delta: 'Hel' },
      { type: 'text', delta: 'lo' },
      { type: 'finish', reason: 'stop', usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11, reasoningTokens: 0 } },
    ])
  })

  it('accumulates interleaved tool_calls deltas by index and yields them in order on finish', async () => {
    const { t } = transport(dataSSE([
      chunk({ role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'add', arguments: '' } }] }),
      chunk({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'remove', arguments: '{"id"' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"text":' } }] }),
      chunk({ tool_calls: [{ index: 1, function: { arguments: ':"3"}' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"milk"}' } }] }),
      chunk({}, 'tool_calls'),
    ]), {}, { split: 13 })
    const ev = await collect(t, { messages: [user('x')] })
    expect(ev.filter(e => e.type != 'start')).toEqual([
      { type: 'tool-call', id: 'call_a', name: 'add', input: { text: 'milk' } },
      { type: 'tool-call', id: 'call_b', name: 'remove', input: { id: '3' } },
      { type: 'finish', reason: 'tool-calls', usage: undefined },
    ])
  })

  it('reads Ollama 0.40 (reasoning field, a whole tool call in one chunk, usage with timings)', async () => {
    const raw = [
      'data: {"id":"chatcmpl-140","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","system_fingerprint":"fp_ollama","choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning":"Okay"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-140","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","system_fingerprint":"fp_ollama","choices":[{"index":0,"delta":{"content":"","tool_calls":[{"id":"call_mmmf8pcj","index":0,"type":"function","function":{"name":"weather","arguments":"{\\"city\\":\\"Hilo\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-140","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","system_fingerprint":"fp_ollama","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      'data: {"id":"chatcmpl-140","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","system_fingerprint":"fp_ollama","choices":[],"usage":{"prompt_tokens":133,"completion_tokens":91,"total_tokens":224},"timings":{"prompt_n":133}}',
      'data: [DONE]',
    ].join('\n\n') + '\n\n'
    const { t } = transport(raw, {}, { split: 50 })
    expect(await collect(t, { messages: [user('x')] })).toEqual([
      { type: 'start', id: 'chatcmpl-140' },
      { type: 'reasoning', delta: 'Okay' },
      { type: 'tool-call', id: 'call_mmmf8pcj', name: 'weather', input: { city: 'Hilo' } },
      { type: 'finish', reason: 'tool-calls', usage: { inputTokens: 133, outputTokens: 91, totalTokens: 224 } },
    ])
  })

  it('reasoning_content (vLLM, DeepSeek), length, a stream with no [DONE], unknown fields ignored', async () => {
    const { t } = transport(dataSSE([chunk({ reasoning_content: 'hm', foo: 1 }), chunk({ content: 'x', audio: {} }, 'length', { service_tier: 'x' })], false))
    expect(await collect(t, { messages: [user('x')] })).toEqual([
      { type: 'start', id: 'chatcmpl-1' }, { type: 'reasoning', delta: 'hm' }, { type: 'text', delta: 'x' }, { type: 'finish', reason: 'length', usage: undefined },
    ])
  })

  it('an error chunk throws; an HTTP error carries status', async () => {
    await expect(collect(transport(dataSSE([chunk({ content: 'a' }), { error: { message: 'overloaded', code: 'busy' } }])).t, { messages: [user('x')] }))
      .rejects.toMatchObject({ message: 'chatCompletions: overloaded', code: 'busy' })
    await expect(collect(transport('{"error":"bad key"}', {}, { status: 401 }).t, { messages: [user('x')] }))
      .rejects.toMatchObject({ status: 401, message: 'chatCompletions: HTTP 401: bad key' })
  })

  it('abort stops the stream and cancels the body', async () => {
    const f = fixtureFetch(() => Array.from({ length: 40 }, (_, i) => dataSSE([chunk({ content: `w${i} ` })], false)), { gapMs: 2 })
    const t = chatCompletions({ model: 'm', fetch: f.fetch })
    const ac = new AbortController()
    let n = 0
    await expect((async () => { for await (const _ of t.stream({ messages: [user('x')] }, ac.signal)) if (++n == 3) ac.abort() })()).rejects.toThrow()
    expect(n).toBeLessThan(6)
    expect(f.aborted).toBe(1)
  })
})

describe('chatCompletions: the request', () => {
  it('maps instructions, messages (one assistant message per step, tool results after it), tools and options', async () => {
    const { f, t } = transport(dataSSE([chunk({ content: 'ok' }, 'stop')]))
    await collect(t, {
      instructions: 'Be brief',
      tools: { add: { description: 'Add', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } } },
      messages: [
        user('add milk and eggs'),
        { role: 'assistant', parts: [
          { type: 'step-start' },
          { type: 'text', text: 'Adding.' },
          { type: 'tool-add', toolCallId: 'c1', state: 'output-available', input: { text: 'milk' }, output: 'added' },
          { type: 'tool-add', toolCallId: 'c2', state: 'output-available', input: { text: 'eggs' }, output: { ok: 1 } },
          { type: 'text', text: 'Both added.' },
        ] },
        { role: 'assistant', content: 'plain' },
        { role: 'user', parts: [{ type: 'file', mediaType: 'image/jpeg', url: 'https://x/y.jpg' }, { type: 'text', text: 'what is it?' }] },
      ],
    })
    const { url, json } = f.calls[0]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    expect(json).toEqual({
      model: 'llama3.2', stream: true, stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: 'Be brief' },
        { role: 'user', content: 'add milk and eggs' },
        { role: 'assistant', content: 'Adding.', tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'add', arguments: '{"text":"milk"}' } },
          { id: 'c2', type: 'function', function: { name: 'add', arguments: '{"text":"eggs"}' } },
        ] },
        { role: 'tool', tool_call_id: 'c1', content: 'added' },
        { role: 'tool', tool_call_id: 'c2', content: '{"ok":1}' },
        { role: 'assistant', content: 'Both added.' },
        { role: 'assistant', content: 'plain' },
        { role: 'user', content: [{ type: 'text', text: 'what is it?' }, { type: 'image_url', image_url: { url: 'https://x/y.jpg' } }] },
      ],
      tools: [{ type: 'function', function: { name: 'add', description: 'Add', parameters: { type: 'object', properties: { text: { type: 'string' } } } } }],
    })
  })

  it('structured output as response_format; strict tools and output with unstricted arguments', async () => {
    setupChecks()
    configureDiagnostics({ mode: 'collect' })
    const { f, t } = transport(dataSSE([chunk({ tool_calls: [{ index: 0, id: 'c', function: { name: 'add', arguments: '{"text":"a","due":null}' } }] }, 'tool_calls')]), { strict: strictSchemas })
    const ev = await collect(t, {
      messages: [user('x')], output: z.enum(['low', 'high']),
      tools: { add: { inputSchema: { type: 'object', properties: { text: { type: 'string' }, due: { type: 'string' } }, required: ['text'] } } },
    })
    const { json } = f.calls[0]
    expect(json.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'output', strict: true, schema: { type: 'object', properties: { value: { type: 'string', enum: ['low', 'high'] } }, required: ['value'], additionalProperties: false } } })
    expect(json.tools[0].function).toMatchObject({ name: 'add', strict: true, parameters: { required: ['text', 'due'], additionalProperties: false } })
    expect(ev.find(e => e.type == 'tool-call').input).toEqual({ text: 'a' })
    expect(getDiagnostics().filter(d => d.code == 'SYG675')).toEqual([])
  })
})
