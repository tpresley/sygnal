// PLAN-6 L-2 (2-T): openResponses() over fixture streams (no network): streams generated with
// encodeOpenResponses (D273) and hand-written in OpenAI's / Ollama's exact shape, the request
// body (messages -> items, tools, structured output), unknown events ignored, errors, abort, and
// the opt-in strict layer (D266, SYG675). Ends with the transport under makeChatDriver + run().
import { describe, it, expect, afterEach, vi } from 'vitest'
import { z } from 'zod'
import { strictSchemas } from '../src/extra/ai/schema/strict.ts'
import { openResponses } from '../src/extra/ai/transports/openResponses.ts'
import { encodeOpenResponses } from '../src/extra/ai/transports/encodeOpenResponses.ts'
import { toSSE, fixtureFetch, collect } from './helpers/p6-sse-fixture.js'
import { configureDiagnostics, getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.ts'
import { setupChecks } from './diagnostics/helpers.js'

const user = text => ({ role: 'user', parts: [{ type: 'text', text }] })
const transport = (events, opts = {}, fx = {}) => {
  const f = fixtureFetch(() => typeof events == 'string' ? events : toSSE(events), fx)
  return { f, t: openResponses({ baseURL: 'http://localhost:11434/v1', model: 'llama3.2', fetch: f.fetch, ...opts }) }
}

afterEach(() => { configureDiagnostics({ mode: 'off' }); clearDiagnostics() })

describe('encodeOpenResponses (D273)', () => {
  it('encodes text, reasoning, tool calls and a finish as Open Responses events', () => {
    const ev = encodeOpenResponses([{ reasoning: 'Think' }, 'Hello ', 'there', { toolCall: { id: 'c1', name: 'add', input: { text: 'milk' } } }, { finish: { reason: 'stop', usage: { inputTokens: 3, outputTokens: 4 } } }], { id: 'resp_x', model: 'm' })
    const types = ev.map(e => e.type)
    expect(types[0]).toBe('response.created')
    expect(types.at(-1)).toBe('response.completed')
    expect(types.filter(t => t == 'response.output_text.delta')).toHaveLength(2)
    expect(types).toContain('response.reasoning_summary_text.delta')
    expect(types).toContain('response.function_call_arguments.done')
    expect(ev.map(e => e.sequence_number)).toEqual(ev.map((_, i) => i))
    const done = ev.at(-1).response
    expect(done).toMatchObject({ id: 'resp_x', model: 'm', status: 'completed', usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } })
    expect(done.output.map(o => o.type)).toEqual(['reasoning', 'message', 'function_call'])
    expect(done.output.map(o => ev.find(e => e.type == 'response.output_item.added' && e.item.id == o.id).output_index)).toEqual([0, 1, 2])
    expect(done.output[1].content[0].text).toBe('Hello there')
    expect(done.output[2]).toMatchObject({ call_id: 'c1', name: 'add', arguments: '{"text":"milk"}' })
  })

  it('takes ChatEvents too, and a length finish is response.incomplete', () => {
    const ev = encodeOpenResponses([{ type: 'text', delta: 'Hi' }, { type: 'finish', reason: 'length' }])
    expect(ev.at(-1)).toMatchObject({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } })
  })
})

describe('openResponses: events', () => {
  it('maps text, reasoning, start and finish (usage in AI SDK names)', async () => {
    const { t } = transport(encodeOpenResponses([{ reasoning: 'Hm' }, 'Hel', 'lo', { finish: { usage: { inputTokens: 2, outputTokens: 3 } } }], { id: 'resp_1' }))
    expect(await collect(t, { messages: [user('hi')] })).toEqual([
      { type: 'start', id: 'resp_1' },
      { type: 'reasoning', delta: 'Hm' },
      { type: 'text', delta: 'Hel' },
      { type: 'text', delta: 'lo' },
      { type: 'finish', reason: 'stop', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } },
    ])
  })

  it('a function call becomes one tool call with parsed input; finish says tool-calls', async () => {
    const { t } = transport(encodeOpenResponses([{ toolCall: { id: 'call_9', name: 'weather', input: { city: 'Hilo' } } }]))
    const ev = await collect(t, { messages: [user('weather?')] })
    expect(ev.filter(e => e.type == 'tool-call')).toEqual([{ type: 'tool-call', id: 'call_9', name: 'weather', input: { city: 'Hilo' } }])
    expect(ev.at(-1)).toMatchObject({ type: 'finish', reason: 'tool-calls' })
  })

  it('reads the stream Ollama 0.40 sends (hand-written: CRLF, comments, no arguments.done, split in 7-byte chunks)', async () => {
    const lines = [
      ': keep-alive',
      'event: response.created\r\ndata: {"response":{"id":"resp_554037","status":"in_progress"},"sequence_number":0,"type":"response.created"}',
      'event: response.in_progress\r\ndata: {"response":{"id":"resp_554037"},"sequence_number":1,"type":"response.in_progress"}',
      'event: response.output_item.added\r\ndata: {"item":{"id":"rs_1","summary":[],"type":"reasoning"},"output_index":0,"sequence_number":2,"type":"response.output_item.added"}',
      'event: response.reasoning_summary_text.delta\r\ndata: {"delta":"Okay","item_id":"rs_1","output_index":0,"sequence_number":3,"summary_index":0,"type":"response.reasoning_summary_text.delta"}',
      'event: response.output_item.added\r\ndata: {"item":{"arguments":"","call_id":"call_9f3as6g3","id":"fc_111804_0","name":"weather","status":"in_progress","type":"function_call"},"output_index":1,"sequence_number":4,"type":"response.output_item.added"}',
      'event: response.function_call_arguments.delta\r\ndata: {"delta":"{\\"city\\":","item_id":"fc_111804_0","output_index":1,"sequence_number":5,"type":"response.function_call_arguments.delta"}',
      'event: response.function_call_arguments.delta\r\ndata: {"delta":"\\"Hilo\\"}","item_id":"fc_111804_0","output_index":1,"sequence_number":6,"type":"response.function_call_arguments.delta"}',
      'event: response.output_item.done\r\ndata: {"item":{"arguments":"{\\"city\\":\\"Hilo\\"}","call_id":"call_9f3as6g3","id":"fc_111804_0","name":"weather","status":"completed","type":"function_call"},"output_index":1,"sequence_number":7,"type":"response.output_item.done"}',
      'event: response.completed\r\ndata: {"response":{"id":"resp_554037","status":"completed","usage":{"input_tokens":152,"output_tokens":18,"total_tokens":170}},"sequence_number":8,"type":"response.completed"}',
    ]
    const { t } = transport(lines.join('\r\n\r\n') + '\r\n\r\n', {}, { split: 7 })
    expect(await collect(t, { messages: [user('weather in Hilo?')] })).toEqual([
      { type: 'start', id: 'resp_554037' },
      { type: 'reasoning', delta: 'Okay' },
      { type: 'tool-call', id: 'call_9f3as6g3', name: 'weather', input: { city: 'Hilo' } },
      { type: 'finish', reason: 'tool-calls', usage: { inputTokens: 152, outputTokens: 18, totalTokens: 170 } },
    ])
  })

  it('ignores unknown and hosted-tool events, as the spec requires', async () => {
    const base = encodeOpenResponses(['a', 'b'])
    const noise = [
      { type: 'response.web_search_call.searching', item_id: 'ws_1' },
      { type: 'response.output_text.annotation.added', annotation: {} },
      { type: 'response.some_future_event', whatever: [1, 2] },
      { type: 'response.content_part.added', part: {} },
    ]
    const { t } = transport([base[0], ...noise, ...base.slice(1)])
    const ev = await collect(t, { messages: [user('x')] })
    expect(ev.filter(e => e.type == 'text').map(e => e.delta)).toEqual(['a', 'b'])
    expect(ev.map(e => e.type)).toEqual(['start', 'text', 'text', 'finish'])
  })

  it('OpenAI reasoning_text deltas and refusals are reasoning and text; incomplete is length', async () => {
    const { t } = transport([
      { type: 'response.reasoning_text.delta', delta: 'r' },
      { type: 'response.refusal.delta', delta: 'No.' },
      { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
    ])
    expect(await collect(t, { messages: [user('x')] })).toEqual([
      { type: 'reasoning', delta: 'r' }, { type: 'text', delta: 'No.' }, { type: 'finish', reason: 'length', usage: undefined },
    ])
  })

  it('response.failed and error events throw; an HTTP error carries status and the provider message', async () => {
    const failed = transport([{ type: 'response.created', response: { id: 'r' } }, { type: 'response.failed', response: { error: { code: 'server_error', message: 'boom' } } }]).t
    await expect(collect(failed, { messages: [user('x')] })).rejects.toThrow('openResponses: boom')
    const err = transport([{ type: 'error', code: 'rate_limit', message: 'slow down' }]).t
    await expect(collect(err, { messages: [user('x')] })).rejects.toMatchObject({ message: 'openResponses: slow down', code: 'rate_limit' })
    const http = transport(JSON.stringify({ error: { message: 'model "nope" not found' } }), {}, { status: 404, headers: { 'content-type': 'application/json' } }).t
    await expect(collect(http, { messages: [user('x')] })).rejects.toMatchObject({ status: 404, message: 'openResponses: HTTP 404: model "nope" not found' })
  })

  it('abort stops the stream and cancels the body', async () => {
    const f = fixtureFetch(() => toSSE(encodeOpenResponses(Array.from({ length: 50 }, (_, i) => `w${i} `))).match(/[\s\S]{1,200}/g), { gapMs: 2 })
    const t = openResponses({ model: 'm', fetch: f.fetch })
    const ac = new AbortController()
    const got = []
    await expect((async () => {
      for await (const e of t.stream({ messages: [user('x')] }, ac.signal)) {
        got.push(e)
        if (got.length == 3) ac.abort()
      }
    })()).rejects.toThrow()
    expect(got.length).toBeLessThan(10)
    expect(f.aborted).toBe(1)
    expect(f.calls[0].init.signal).toBe(ac.signal)
  })
})

describe('openResponses: the request', () => {
  it('posts to baseURL/responses (default /v1) with model, instructions, items, tools and headers', async () => {
    const { f, t } = transport(encodeOpenResponses(['ok']), { headers: { 'x-trace': '1' }, body: { temperature: 0 } })
    await collect(t, {
      model: 'qwen3:8b', instructions: 'Be brief',
      tools: { add_todo: { description: 'Add a todo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }, clear: {} },
      body: { top_p: 0.5 },
      messages: [
        { role: 'system', content: 'sys' },
        user('add milk'),
        { role: 'assistant', parts: [
          { type: 'reasoning', text: 'hidden' },
          { type: 'text', text: 'Adding.' },
          { type: 'tool-add_todo', toolCallId: 'c1', state: 'output-available', input: { text: 'milk' }, output: { ok: true } },
          { type: 'tool-clear', toolCallId: 'c2', state: 'output-error', input: {}, errorText: 'nope' },
          { type: 'data-progress', data: 1 },
          { type: 'text', text: 'Done.' },
        ] },
        { role: 'user', parts: [{ type: 'text', text: 'look' }, { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AA' }] },
      ],
    })
    const { url, json, headers } = f.calls[0]
    expect(url).toBe('http://localhost:11434/v1/responses')
    expect(headers).toMatchObject({ 'content-type': 'application/json', 'x-trace': '1' })
    expect(json).toEqual({
      model: 'qwen3:8b', stream: true, instructions: 'Be brief', temperature: 0, top_p: 0.5,
      input: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'add milk' },
        { role: 'assistant', content: 'Adding.' },
        { type: 'function_call', call_id: 'c1', name: 'add_todo', arguments: '{"text":"milk"}' },
        { type: 'function_call_output', call_id: 'c1', output: '{"ok":true}' },
        { type: 'function_call', call_id: 'c2', name: 'clear', arguments: '{}' },
        { type: 'function_call_output', call_id: 'c2', output: '{"error":"nope"}' },
        { role: 'assistant', content: 'Done.' },
        { role: 'user', content: [{ type: 'input_text', text: 'look' }, { type: 'input_image', image_url: 'data:image/png;base64,AA' }] },
      ],
      tools: [
        { type: 'function', name: 'add_todo', description: 'Add a todo', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, strict: false },
        { type: 'function', name: 'clear', parameters: { type: 'object', properties: {} }, strict: false },
      ],
    })
    expect(openResponses({ model: 'm' })).toHaveProperty('stream')
  })

  it('structured output goes as text.format json_schema (the wrapped input-side schema)', async () => {
    const { f, t } = transport(encodeOpenResponses(['{"value":["a"]}']))
    await collect(t, { messages: [user('x')], output: z.array(z.string()) })
    expect(f.calls[0].json.text).toEqual({ format: { type: 'json_schema', name: 'output', strict: false, schema: { type: 'object', properties: { value: { type: 'array', items: { type: 'string' } } }, required: ['value'], additionalProperties: false } } })
  })

  it('headers may be a function of the request; the default baseURL is /v1', async () => {
    const f = fixtureFetch(() => toSSE(encodeOpenResponses(['ok'])))
    const t = openResponses({ model: 'm', fetch: f.fetch, headers: async r => ({ 'x-user': r.key }) })
    await collect(t, { messages: [user('x')], key: 'k1' })
    expect(f.calls[0].url).toBe('/v1/responses')
    expect(f.calls[0].headers['x-user']).toBe('k1')
  })
})

describe('openResponses: strict (D266)', () => {
  const tools = {
    add: { description: 'Add', inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1 }, due: { type: 'string', format: 'date' }, tag: { type: 'string', enum: ['a', 'b'] } }, required: ['text'] } },
    tags: { description: 'Set tags', inputSchema: { type: 'object', properties: { map: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['map'] } },
  }

  it('sends strict schemas, falls back per tool (SYG675, info, once), and unstricts the arguments', async () => {
    setupChecks()
    configureDiagnostics({ mode: 'collect' })
    const ev = encodeOpenResponses([{ toolCall: { id: 'c1', name: 'add', input: { text: 'milk', due: null, tag: null } } }, { toolCall: { id: 'c2', name: 'tags', input: { map: { a: '1' } } } }])
    const { f, t } = transport(ev, { strict: strictSchemas })
    const got = await collect(t, { messages: [user('x')], tools })
    await collect(t, { messages: [user('y')], tools })
    const [add, tags] = f.calls[0].json.tools
    expect(add).toEqual({ type: 'function', name: 'add', description: 'Add', strict: true, parameters: {
      type: 'object', additionalProperties: false, required: ['text', 'due', 'tag'],
      properties: { text: { type: 'string', minLength: 1 }, due: { type: ['string', 'null'], format: 'date' }, tag: { type: ['string', 'null'], enum: ['a', 'b', null] } },
    } })
    expect(tags).toEqual({ type: 'function', name: 'tags', description: 'Set tags', strict: false, parameters: tools.tags.inputSchema })
    expect(got.filter(e => e.type == 'tool-call').map(e => e.input)).toEqual([{ text: 'milk' }, { map: { a: '1' } }])
    const d = getDiagnostics().filter(x => x.code == 'SYG675')
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ severity: 'info' })
    expect(d[0].message).toContain("the tool 'tags'")
  })

  it('moves unsupported keywords into the description and strictifies the output schema', async () => {
    const { f, t } = transport(encodeOpenResponses(['{}']), { strict: strictSchemas })
    await collect(t, { messages: [user('x')], output: z.object({ title: z.string(), note: z.string().optional(), size: z.number().multipleOf(2).optional() }), tools: { t: { inputSchema: { type: 'object', properties: { n: { type: 'array', uniqueItems: true, items: { type: 'number' } } } } } } })
    const { text, tools: [tool] } = f.calls[0].json
    expect(text.format.strict).toBe(true)
    expect(text.format.schema.required).toEqual(['title', 'note', 'size'])
    expect(text.format.schema.properties.note).toEqual({ type: ['string', 'null'] })
    expect(tool.parameters.properties.n).toEqual({ type: ['array', 'null'], items: { type: 'number' }, description: '{"uniqueItems":true}' })
  })
})
