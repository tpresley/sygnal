// PLAN-6 L-2 (3-W2): anthropicMessages() over hand-written Anthropic Messages SSE (no network).
// The fixtures are checked against @anthropic-ai/sdk's own stream parser (the SDK reads the same
// bytes into a final message), then the transport's events, the request body, strict mode
// (Anthropic's subset, the per-request limits of G-609, D285's SYG672) and a thinking + tool round
// trip that sends the signed thinking block back.
import { describe, it, expect, afterEach } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { anthropicMessages, toAnthropic } from '../src/extra/ai/transports/anthropicMessages.ts'
import { strictSchemas, anthropicCompatible } from '../src/extra/ai/schema/strict.ts'
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema'
import { toJsonSchema } from '../src/extra/ai/schema/index.ts'
import { toSSE, fixtureFetch, collect } from './helpers/p6-sse-fixture.js'
import { configureDiagnostics, getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.ts'
import { setupChecks } from './diagnostics/helpers.js'

const user = text => ({ role: 'user', parts: [{ type: 'text', text }] })
const usage0 = { input_tokens: 12, cache_creation_input_tokens: 0, cache_read_input_tokens: 4, output_tokens: 1, service_tier: 'standard' }
const start = (id = 'msg_01') => ({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: usage0 } })
const block = (index, content_block) => ({ type: 'content_block_start', index, content_block })
const delta = (index, d) => ({ type: 'content_block_delta', index, delta: d })
const stop = index => ({ type: 'content_block_stop', index })
const end = (stop_reason, output_tokens = 20, extra = {}) => [{ type: 'message_delta', delta: { stop_reason, stop_sequence: null }, usage: { output_tokens, ...extra } }, { type: 'message_stop' }]
const transport = (events, opts = {}, fx = {}) => {
  const f = fixtureFetch(() => typeof events == 'string' ? events : toSSE(events), fx)
  return { f, t: anthropicMessages({ baseURL: 'http://localhost:11434/v1/', model: 'claude-opus-5-5', fetch: f.fetch, ...opts }) }
}
// the SDK's own reading of a fixture (proves the fixture is a valid Messages stream)
const sdkRead = async events => {
  const f = fixtureFetch(() => toSSE(events))
  const client = new Anthropic({ apiKey: 'test', baseURL: 'http://localhost:1', fetch: f.fetch, maxRetries: 0 })
  return client.messages.stream({ model: 'claude-opus-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'x' }] }).finalMessage()
}
afterEach(() => { configureDiagnostics({ mode: 'off' }); clearDiagnostics() })

const THINK_TOOL = [
  start(),
  block(0, { type: 'thinking', thinking: '', signature: '' }),
  delta(0, { type: 'thinking_delta', thinking: 'The user wants ' }),
  delta(0, { type: 'thinking_delta', thinking: 'the weather.' }),
  delta(0, { type: 'signature_delta', signature: 'EqQBCkYIARgCKkC' }),
  stop(0),
  block(1, { type: 'text', text: '' }),
  delta(1, { type: 'text_delta', text: 'Checking.' }),
  stop(1),
  block(2, { type: 'tool_use', id: 'toolu_01', name: 'get_weather', input: {} }),
  delta(2, { type: 'input_json_delta', partial_json: '' }),
  delta(2, { type: 'input_json_delta', partial_json: '{"city": "Hi' }),
  delta(2, { type: 'input_json_delta', partial_json: 'lo"}' }),
  stop(2),
  ...end('tool_use', 89, { output_tokens_details: { thinking_tokens: 30 } }),
]

describe('anthropicMessages: the fixtures are valid Messages streams (the SDK reads them)', () => {
  it('thinking + text + tool_use', async () => {
    const m = await sdkRead(THINK_TOOL)
    expect(m.stop_reason).toBe('tool_use')
    expect(m.content.map(b => b.type)).toEqual(['thinking', 'text', 'tool_use'])
    expect(m.content[0]).toMatchObject({ thinking: 'The user wants the weather.', signature: 'EqQBCkYIARgCKkC' })
    expect(m.content[2].input).toEqual({ city: 'Hilo' })
  })
})

describe('anthropicMessages: events', () => {
  it('text, usage (input incl. cache, cumulative output), ping ignored', async () => {
    const { t } = transport([start(), { type: 'ping' }, block(0, { type: 'text', text: '' }), delta(0, { type: 'text_delta', text: 'Hel' }), delta(0, { type: 'text_delta', text: 'lo' }), stop(0), ...end('end_turn', 3)], {}, { split: 17 })
    expect(await collect(t, { messages: [user('hi')] })).toEqual([
      { type: 'start', id: 'msg_01' },
      { type: 'text', delta: 'Hel' },
      { type: 'text', delta: 'lo' },
      { type: 'finish', reason: 'stop', usage: { inputTokens: 16, outputTokens: 3, totalTokens: 19 } },
    ])
  })

  it('thinking with its signature, then a tool call from input_json_delta', async () => {
    const { t } = transport(THINK_TOOL, {}, { split: 23 })
    expect(await collect(t, { messages: [user('weather in Hilo?')] })).toEqual([
      { type: 'start', id: 'msg_01' },
      { type: 'reasoning', delta: 'The user wants ' },
      { type: 'reasoning', delta: 'the weather.' },
      { type: 'reasoning', delta: '', providerMetadata: { anthropic: { signature: 'EqQBCkYIARgCKkC' } } },
      { type: 'text', delta: 'Checking.' },
      { type: 'tool-call', id: 'toolu_01', name: 'get_weather', input: { city: 'Hilo' } },
      { type: 'finish', reason: 'tool-calls', usage: { inputTokens: 16, outputTokens: 89, totalTokens: 105, reasoningTokens: 30 } },
    ])
  })

  it('redacted thinking; a server tool (web_search) as an executed call with its result block', async () => {
    const result = { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_01', content: [{ type: 'web_search_result', title: 'Hilo', url: 'https://x', encrypted_content: 'abc', page_age: null }] }
    const ev = [
      start(),
      block(0, { type: 'redacted_thinking', data: 'ENCRYPTED' }), stop(0),
      block(1, { type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: {} }),
      delta(1, { type: 'input_json_delta', partial_json: '{"query":"hilo weather"}' }), stop(1),
      block(2, result), stop(2),
      block(3, { type: 'text', text: '' }), delta(3, { type: 'text_delta', text: 'Sunny.' }), delta(3, { type: 'citations_delta', citation: { type: 'web_search_result_location', cited_text: 'x', url: 'https://x', title: 'Hilo', encrypted_index: 'i' } }), stop(3),
      ...end('end_turn'),
    ]
    const m = await sdkRead(ev)
    expect(m.content.map(b => b.type)).toEqual(['redacted_thinking', 'server_tool_use', 'web_search_tool_result', 'text'])
    const out = await collect(transport(ev).t, { messages: [user('x')] })
    expect(out.slice(1, -1)).toEqual([
      { type: 'reasoning', delta: '', providerMetadata: { anthropic: { redactedData: 'ENCRYPTED' } } },
      { type: 'tool-call', id: 'srvtoolu_01', name: 'web_search', input: { query: 'hilo weather' }, executed: true, providerExecuted: true },
      { type: 'tool-result', id: 'srvtoolu_01', output: { ...result } },
      { type: 'text', delta: 'Sunny.' },
    ])
  })

  it('stop reasons; a stream without message_stop still finishes; Ollama usage', async () => {
    const reason = async r => (await collect(transport([start(), ...end(r)]).t, { messages: [user('x')] })).at(-1).reason
    expect(await reason('max_tokens')).toBe('length')
    expect(await reason('refusal')).toBe('content-filter')
    expect(await reason('pause_turn')).toBe('stop')
    expect(await reason('model_context_window_exceeded')).toBe('length')
    expect(await reason('something_new')).toBe('other')
    // Ollama 0.40: usage on message_delta carries the real input count
    const raw = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_73a4","type":"message","role":"assistant","model":"llama3.2","content":[],"usage":{"input_tokens":2,"output_tokens":0}}}\n\n' +
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":27,"cache_read_input_tokens":0,"output_tokens":3}}\n\n'
    expect(await collect(transport(raw).t, { messages: [user('x')] })).toEqual([
      { type: 'start', id: 'msg_73a4' }, { type: 'text', delta: 'Hi' }, { type: 'finish', reason: 'stop', usage: { inputTokens: 27, outputTokens: 3, totalTokens: 30 } },
    ])
  })

  it('an error event throws; an HTTP error carries status and the API message', async () => {
    await expect(collect(transport([start(), { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]).t, { messages: [user('x')] }))
      .rejects.toMatchObject({ message: 'anthropicMessages: Overloaded', code: 'overloaded_error' })
    await expect(collect(transport('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', {}, { status: 401 }).t, { messages: [user('x')] }))
      .rejects.toMatchObject({ status: 401, message: 'anthropicMessages: HTTP 401: invalid x-api-key' })
  })

  it('abort stops the stream and cancels the body', async () => {
    const f = fixtureFetch(() => [toSSE([start(), block(0, { type: 'text', text: '' })]), ...Array.from({ length: 40 }, (_, i) => toSSE([delta(0, { type: 'text_delta', text: `w${i} ` })]))], { gapMs: 2 })
    const t = anthropicMessages({ model: 'm', fetch: f.fetch })
    const ac = new AbortController()
    let n = 0
    await expect((async () => { for await (const _ of t.stream({ messages: [user('x')] }, ac.signal)) if (++n == 3) ac.abort() })()).rejects.toThrow()
    expect(n).toBeLessThan(6)
    expect(f.aborted).toBe(1)
  })
})

describe('anthropicMessages: the request', () => {
  it('system, messages (steps, tool_result user messages, files, signed thinking), tools, output, headers', async () => {
    const { f, t } = transport([start(), ...end('end_turn')], { maxTokens: 2048, headers: { 'x-session': 's' }, body: { temperature: 0 }, serverTools: [{ type: 'web_search_20260209', name: 'web_search' }] })
    await collect(t, {
      instructions: 'Be brief',
      tools: { add: { description: 'Add', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
      output: z.object({ ok: z.boolean() }),
      messages: [
        { role: 'system', content: 'House rules.' },
        { role: 'user', parts: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,iVBOR' }, { type: 'file', mediaType: 'application/pdf', url: 'https://x/doc.pdf' }, { type: 'text', text: 'add milk and eggs' }] },
        { role: 'assistant', parts: [
          { type: 'step-start' },
          { type: 'reasoning', text: 'Two items.', providerMetadata: { anthropic: { signature: 'SIG1' } } },
          { type: 'reasoning', text: 'unsigned (another provider)' },
          { type: 'text', text: 'Adding.' },
          { type: 'tool-add', toolCallId: 'c1', state: 'output-available', input: { text: 'milk' }, output: 'added' },
          { type: 'tool-add', toolCallId: 'c2', state: 'output-error', input: { text: 'eggs' }, errorText: 'out of stock' },
          { type: 'step-start' },
          { type: 'tool-web_search', toolCallId: 's1', state: 'output-available', input: { query: 'q' }, output: { type: 'web_search_tool_result', tool_use_id: 's1', content: [] }, providerExecuted: true },
          { type: 'text', text: 'Milk added.' },
          { type: 'tool-add', toolCallId: 'c3', state: 'input-available', input: { text: 'tea' } },
        ] },
        { role: 'user', content: 'thanks' },
        { role: 'user', content: 'and bread' },
      ],
    })
    const { url, json, headers } = f.calls[0]
    expect(url).toBe('http://localhost:11434/v1/messages')
    expect(headers).toMatchObject({ 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-session': 's' })
    expect(headers['anthropic-dangerous-direct-browser-access']).toBeUndefined()
    expect(json).toEqual({
      model: 'claude-opus-5-5', max_tokens: 2048, stream: true, temperature: 0,
      system: 'Be brief\n\nHouse rules.',
      messages: [
        { role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
          { type: 'document', source: { type: 'url', url: 'https://x/doc.pdf' } },
          { type: 'text', text: 'add milk and eggs' },
        ] },
        { role: 'assistant', content: [
          { type: 'thinking', thinking: 'Two items.', signature: 'SIG1' },
          { type: 'text', text: 'Adding.' },
          { type: 'tool_use', id: 'c1', name: 'add', input: { text: 'milk' } },
          { type: 'tool_use', id: 'c2', name: 'add', input: { text: 'eggs' } },
        ] },
        { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'c1', content: 'added' },
          { type: 'tool_result', tool_use_id: 'c2', content: '{"error":"out of stock"}', is_error: true },
        ] },
        { role: 'assistant', content: [
          { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } },
          { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
          { type: 'text', text: 'Milk added.' },
        ] },
        // the open call c3 is not sent; the two user messages are merged
        { role: 'user', content: [{ type: 'text', text: 'thanks' }, { type: 'text', text: 'and bread' }] },
      ],
      tools: [
        { name: 'add', description: 'Add', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
        { type: 'web_search_20260209', name: 'web_search' },
      ],
      // G-635: the compatibility pass adds additionalProperties: false (Anthropic requires it)
      output_config: { format: { type: 'json_schema', schema: { ...toJsonSchema(z.object({ ok: z.boolean() })).schema, additionalProperties: false } } },
    })
  })

  it('defaults: /v1, 16000 max tokens, a request maxTokens / model; the browser header with dangerouslyAllowBrowser', async () => {
    const f = fixtureFetch(() => toSSE([start(), ...end('end_turn')]))
    await collect(anthropicMessages({ model: 'm', fetch: f.fetch, dangerouslyAllowBrowser: true, headers: () => ({ 'x-api-key': 'k' }) }), { messages: [user('x')], model: 'claude-haiku-5-5', maxTokens: 10 })
    await collect(anthropicMessages({ model: 'm', fetch: f.fetch }), { messages: [user('x')] })
    expect(f.calls[0].url).toBe('/v1/messages')
    expect(f.calls[0].json).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 10 })
    expect(f.calls[0].headers).toMatchObject({ 'x-api-key': 'k', 'anthropic-dangerous-direct-browser-access': 'true' })
    expect(f.calls[1].json).toMatchObject({ model: 'm', max_tokens: 16000 })
  })

  it('toAnthropic: a user message with only text is one text block; reasoning from users is dropped', () => {
    expect(toAnthropic({ role: 'user', content: 'hi' })).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
    expect(toAnthropic({ role: 'assistant', parts: [{ type: 'text', text: 'a' }, { type: 'tool-x', toolCallId: 'c', state: 'output-denied', input: {} }, { type: 'text', text: 'b' }] })).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'tool_use', id: 'c', name: 'x', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c', content: '{"error":"The user denied this tool call"}', is_error: true }] },
      { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
    ])
  })
})

describe('anthropicMessages: strict (D266, D285, G-609)', () => {
  const tool = inputSchema => ({ inputSchema })
  it('strict tools in Anthropic’s subset: optional keys stay optional, unsupported keywords move to the description', async () => {
    const { f, t } = transport([start(), block(0, { type: 'tool_use', id: 't', name: 'add', input: {} }), delta(0, { type: 'input_json_delta', partial_json: '{"text":"a"}' }), stop(0), ...end('tool_use')], { strict: strictSchemas })
    const ev = await collect(t, {
      messages: [user('x')], output: z.object({ ok: z.boolean() }),
      tools: { add: tool({ type: 'object', properties: { text: { type: 'string', minLength: 1, format: 'uri' }, n: { type: 'integer', minimum: 0 }, tags: { type: 'array', items: { type: 'string' }, minItems: 2 } }, required: ['text'] }) },
    })
    const { json } = f.calls[0]
    expect(json.tools[0]).toEqual({ name: 'add', strict: true, input_schema: {
      type: 'object', additionalProperties: false, required: ['text'], properties: {
        text: { type: 'string', format: 'uri', description: '{"minLength":1}' },
        n: { type: 'integer', description: '{"minimum":0}' },
        tags: { type: 'array', items: { type: 'string' }, description: '{"minItems":2}' },
      },
    } })
    expect(json.output_config.format.schema).toMatchObject({ type: 'object', additionalProperties: false, required: ['ok'] })
    expect(ev.find(e => e.type == 'tool-call').input).toEqual({ text: 'a' })
  })

  it('per tool fallback: a record, a recursive schema, an any value, and the 21st strict tool (SYG675, once each)', async () => {
    setupChecks()
    configureDiagnostics({ mode: 'collect' })
    const node = z.object({ name: z.string(), get children() { return z.array(node) } })
    const tools = {
      rec: tool({ type: 'object', properties: { m: { type: 'object', additionalProperties: { type: 'string' } } } }),
      tree: tool(toJsonSchema(node).schema),
      anyv: tool({ type: 'object', properties: { v: {} }, required: ['v'] }),
      ...Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`t${i}`, tool({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })])),
    }
    const { f, t } = transport([start(), ...end('end_turn')], { strict: strictSchemas })
    await collect(t, { messages: [user('x')], tools })
    await collect(t, { messages: [user('y')], tools })
    const sent = Object.fromEntries(f.calls[0].json.tools.map(x => [x.name, !!x.strict]))
    expect(sent).toMatchObject({ rec: false, tree: false, anyv: false, t0: true, t19: true, t20: false })
    const d = getDiagnostics().filter(x => x.code == 'SYG675')
    expect(d.map(x => x.data.tool).sort()).toEqual(['anyv', 'rec', 't20', 'tree'])
    expect(d.find(x => x.data.tool == 'tree').data.errors).toEqual(['a recursive schema has no strict form'])
    expect(d.find(x => x.data.tool == 't20').data.errors[0]).toMatch(/per-request strict limits/)
  })

  it('the optional-parameter budget (24) across the strict schemas, the output counted first', async () => {
    const opt = n => ({ type: 'object', properties: Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { type: 'string' }])) })
    const { f, t } = transport([start(), ...end('end_turn')], { strict: strictSchemas })
    await collect(t, { messages: [user('x')], tools: { a: { inputSchema: opt(20) }, b: { inputSchema: opt(5) }, c: { inputSchema: opt(4) } } })
    expect(f.calls[0].json.tools.map(x => !!x.strict)).toEqual([true, false, true])
  })

  it('strict: true without the strict layer is SYG672 (dev, once per transport) and sends non-strict', async () => {
    setupChecks()
    configureDiagnostics({ mode: 'collect' })
    const { f, t } = transport([start(), ...end('end_turn')], { strict: true })
    const tools = { add: tool({ type: 'object', properties: { a: { type: 'string' } } }) }
    await collect(t, { messages: [user('x')], tools })
    await collect(t, { messages: [user('x')], tools })
    expect(f.calls[0].json.tools[0].strict).toBeUndefined()
    const d = getDiagnostics().filter(x => x.code == 'SYG672')
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ severity: 'error', data: { transport: 'anthropicMessages' } })
    expect(d[0].message).toMatch(/strictSchemas/)
  })
})

describe('anthropicMessages: the always-on output compatibility pass (G-635)', () => {
  // keywords outside Anthropic's structured-output subset, at every level
  const wide = {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 3, maxLength: 80, pattern: '^[A-Z]' },
      site: { type: 'string', format: 'uri' },
      slug: { type: 'string', format: 'regex' },
      score: { type: 'number', minimum: 0, maximum: 1, multipleOf: 0.5, exclusiveMaximum: 2 },
      tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] }, minItems: 2, maxItems: 5, uniqueItems: true },
      some: { type: 'array', items: { type: 'integer' }, minItems: 1 },
      kind: { oneOf: [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], minProperties: 1 }, { type: 'null' }] },
      meta: { type: 'object', additionalProperties: { type: 'string' } },
      none: { not: { type: 'string' }, type: 'integer' },
    },
    required: ['title'],
    if: { properties: { score: { const: 1 } } },
    then: { required: ['tags'] },
  }
  const strip = s => JSON.parse(JSON.stringify(s, (k, v) => k == 'description' ? undefined : v))

  it('moves unsupported keywords into the description, oneOf -> anyOf, additionalProperties: false (records kept)', () => {
    const out = anthropicCompatible(wide)
    expect(out.properties.title).toEqual({ type: 'string', description: '{"minLength":3,"maxLength":80,"pattern":"^[A-Z]"}' })
    expect(out.properties.site).toEqual({ type: 'string', format: 'uri' })
    expect(out.properties.slug).toEqual({ type: 'string', description: '{"format":"regex"}' })
    expect(out.properties.score.description).toBe('{"minimum":0,"maximum":1,"multipleOf":0.5,"exclusiveMaximum":2}')
    expect(out.properties.tags).toEqual({ type: 'array', items: { type: 'string', enum: ['a', 'b'] }, description: '{"minItems":2,"maxItems":5,"uniqueItems":true}' })
    expect(out.properties.some).toEqual({ type: 'array', items: { type: 'integer' }, minItems: 1 })
    expect(out.properties.kind.anyOf[0]).toEqual({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false, description: '{"minProperties":1}' })
    expect(out.properties.meta.additionalProperties).toEqual({ type: 'string' })
    expect(out.properties.none.description).toBe('{"not":{"type":"string"}}')
    expect(out.additionalProperties).toBe(false)
    expect(Object.keys(out).sort()).toEqual(['additionalProperties', 'description', 'properties', 'required', 'type'])
    // the original is untouched (the driver validates against it)
    expect(wide.properties.title.minLength).toBe(3)
    expect(wide.properties.kind.oneOf).toBeDefined()
  })

  it('keeps the keywords @anthropic-ai/sdk’s transformJSONSchema keeps (records aside; enum / const too, which the docs list as supported and the SDK moves)', () => {
    const { meta, ...properties } = wide.properties
    const plain = { ...wide, properties }
    const noEnum = s => JSON.parse(JSON.stringify(s, (k, v) => k == 'enum' ? undefined : v))
    expect(strip(noEnum(anthropicCompatible(plain)))).toEqual(strip(transformJSONSchema(noEnum(plain))))
  })

  it('a non-strict output goes through it; a strict one is strictSchemas’; tools stay as they are', async () => {
    const { f, t } = transport([start(), ...end('end_turn')])
    const output = { '~standard': { version: 1, vendor: 'x', validate: v => ({ value: v }), jsonSchema: { input: () => wide, output: () => wide } } }
    await collect(t, { messages: [user('x')], output, tools: { add: { inputSchema: wide } } })
    const { json } = f.calls[0]
    expect(json.output_config.format.schema.properties.title).toEqual({ type: 'string', description: '{"minLength":3,"maxLength":80,"pattern":"^[A-Z]"}' })
    expect(json.output_config.format.schema.if).toBeUndefined()
    expect(json.tools[0].input_schema.properties.title.minLength).toBe(3)
    const s = transport([start(), ...end('end_turn')], { strict: strictSchemas })
    await collect(s.t, { messages: [user('x')], output: z.object({ ok: z.boolean().describe('yes') }) })
    expect(s.f.calls[0].json.output_config.format.schema).toEqual({ type: 'object', properties: { ok: { type: 'boolean', description: 'yes' } }, required: ['ok'], additionalProperties: false })
  })

  it('validation is the original schema’s: a reply the description only hints at fails `output`', async () => {
    const reply = text => [start(), block(0, { type: 'text', text: '' }), delta(0, { type: 'text_delta', text }), stop(0), ...end('end_turn')]
    const { t } = transport(reply('{"title":"no"}'))
    const r = await collect(t, { messages: [user('x')], output: z.object({ title: z.string().min(3) }) })
    expect(r.find(e => e.type == 'text').delta).toBe('{"title":"no"}')
    const { readOutput } = await import('../src/extra/ai/chat/output.ts')
    await expect(readOutput(z.object({ title: z.string().min(3) }), '{"title":"no"}')).rejects.toMatchObject({ issues: expect.any(Array) })
  })
})
