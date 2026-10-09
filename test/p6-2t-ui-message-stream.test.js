// PLAN-6 L-2 (2-T): uiMessageStream() against real AI SDK 7 routes (streamText over
// MockLanguageModelV4 -> toUIMessageStreamResponse(); createUIMessageStreamResponse() for data
// parts), no network: the protocol header check, text / reasoning, client tools vs server-run
// tools, approvals (request -> approval-responded -> the server runs it), data-* parts, errors,
// abort, and the request body DefaultChatTransport sends.
import { describe, it, expect } from 'vitest'
import { createUIMessageStream, createUIMessageStreamResponse, validateUIMessages } from 'ai'
import { z } from 'zod'
import { uiMessageStream } from '../src/extra/ai/transports/uiMessageStream.ts'
import { steps, aiSdkRoute, tool, jsonSchema, stepCountIs } from './helpers/p6-ai-sdk-fixture.js'
import { dataSSE, fixtureFetch, collect } from './helpers/p6-sse-fixture.js'

const user = text => ({ id: 'u1', role: 'user', parts: [{ type: 'text', text }] })
const obj = jsonSchema({ type: 'object', properties: { city: { type: 'string' } } })

describe('uiMessageStream: AI SDK 7 routes', () => {
  it('streams text and reasoning; the body is what DefaultChatTransport sends', async () => {
    const r = aiSdkRoute(() => ({ model: steps({ reasoning: 'hm', text: ['Hello ', 'world'] }) }))
    const t = uiMessageStream('/api/chat', { fetch: r.fetch, body: { tenant: 't1' }, headers: { 'x-csrf': 'c' } })
    const ev = await collect(t, { messages: [user('hi'), { role: 'assistant', content: 'earlier' }], instructions: 'Be brief', chatId: 'chat-1' })
    expect(ev).toEqual([
      { type: 'reasoning', delta: 'hm' },
      { type: 'text', delta: 'Hello ' },
      { type: 'text', delta: 'world' },
      { type: 'finish', reason: 'stop' },
    ])
    const { url, body, init } = r.calls[0]
    expect(url).toBe('/api/chat')
    expect(init.headers).toMatchObject({ 'content-type': 'application/json', 'x-csrf': 'c' })
    expect(body).toEqual({
      id: 'chat-1', trigger: 'submit-message', instructions: 'Be brief', tenant: 't1',
      messages: [user('hi'), { id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'earlier' }] }],
    })
    // the server accepts them as UIMessages
    await expect(validateUIMessages({ messages: body.messages })).resolves.toHaveLength(2)
  })

  it('a client tool (no execute) is a tool call; a server tool is executed with its result; finish says tool-calls', async () => {
    const r = aiSdkRoute(() => ({
      model: steps({ text: ['Checking.'], calls: [{ id: 'c1', name: 'weather', input: { city: 'Hilo' } }, { id: 'c2', name: 'pickCity', input: { city: 'Hilo' } }] }),
      tools: { weather: tool({ inputSchema: obj, execute: async () => ({ temp: 24 }) }), pickCity: tool({ inputSchema: obj }) },
    }))
    const ev = await collect(uiMessageStream('/api/chat', { fetch: r.fetch }), { messages: [user('weather?')], tools: { pickCity: { description: 'Pick', inputSchema: { type: 'object' } } } })
    expect(ev).toEqual([
      { type: 'text', delta: 'Checking.' },
      { type: 'tool-call', id: 'c1', name: 'weather', input: { city: 'Hilo' }, executed: true },
      { type: 'tool-result', id: 'c1', output: { temp: 24 } },
      { type: 'tool-call', id: 'c2', name: 'pickCity', input: { city: 'Hilo' } },
      { type: 'finish', reason: 'tool-calls' },
    ])
    expect(r.calls[0].body.tools).toEqual({ pickCity: { description: 'Pick', inputSchema: { type: 'object' } } })
  })

  it('approvals: the request, then the approved call runs on the next request', async () => {
    const del = tool({ inputSchema: obj, needsApproval: true, execute: async ({ city }) => `deleted ${city}` })
    const model = steps({ calls: [{ id: 'c3', name: 'del', input: { city: 'Hilo' } }] }, { text: ['Done.'] })
    const r = aiSdkRoute(() => ({ model, tools: { del }, stopWhen: stepCountIs(3) }))
    const t = uiMessageStream('/api/chat', { fetch: r.fetch })
    const first = await collect(t, { messages: [user('delete Hilo')] })
    const approval = first.find(e => e.type == 'tool-approval')
    expect(first.slice(0, 2)).toEqual([
      { type: 'tool-call', id: 'c3', name: 'del', input: { city: 'Hilo' }, executed: true },
      { type: 'tool-approval', id: 'c3', approval: { id: approval.approval.id } },
    ])
    expect(approval.approval.id).toMatch(/\w/)
    // the app answers as useChat's addToolApprovalResponse does, and sends again
    const answered = { id: 'a1', role: 'assistant', parts: [{ type: 'tool-del', toolCallId: 'c3', state: 'approval-responded', input: { city: 'Hilo' }, approval: { id: approval.approval.id, approved: true } }] }
    const second = await collect(t, { messages: [user('delete Hilo'), answered] })
    expect(second).toEqual([
      { type: 'tool-call', id: 'c3', name: 'del', input: { city: 'Hilo' }, executed: true },
      { type: 'tool-result', id: 'c3', output: 'deleted Hilo' },
      { type: 'text', delta: 'Done.' },
      { type: 'finish', reason: 'stop' },
    ])
  })

  it('a denied approval comes back as tool-denied', async () => {
    const del = tool({ inputSchema: obj, needsApproval: true, execute: async () => 'x' })
    const r = aiSdkRoute(() => ({ model: steps({ text: ['Ok, not deleting.'] }), tools: { del }, stopWhen: stepCountIs(3) }))
    const denied = { id: 'a1', role: 'assistant', parts: [{ type: 'tool-del', toolCallId: 'c3', state: 'approval-responded', input: { city: 'Hilo' }, approval: { id: 'ap', approved: false, reason: 'no' } }] }
    const ev = await collect(uiMessageStream('/api/chat', { fetch: r.fetch }), { messages: [user('delete'), denied] })
    expect(ev.slice(0, 2)).toEqual([
      { type: 'tool-call', id: 'c3', name: 'del', input: { city: 'Hilo' }, executed: true },
      { type: 'tool-denied', id: 'c3' },
    ])
  })

  it('data-* parts pass through (transient ones are skipped), with sources, files, start ids and errors', async () => {
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'start', messageId: 'msg-7' })
        writer.write({ type: 'data-weather', id: 'w1', data: { status: 'loading' } })
        writer.write({ type: 'data-notice', data: 'just so you know', transient: true })
        writer.write({ type: 'source-url', sourceId: 's1', url: 'https://example.com', title: 'Ex' })
        writer.write({ type: 'file', url: 'data:text/plain;base64,aGk=', mediaType: 'text/plain' })
        writer.write({ type: 'data-weather', id: 'w1', data: { status: 'done', temp: 24 } })
        writer.write({ type: 'text-start', id: 't' })
        writer.write({ type: 'text-delta', id: 't', delta: 'Sunny.' })
        writer.write({ type: 'text-end', id: 't' })
        writer.write({ type: 'message-metadata', messageMetadata: { a: 1 } })
        writer.write({ type: 'finish', finishReason: 'stop' })
      },
    })
    const t = uiMessageStream('/api/chat', { fetch: async () => createUIMessageStreamResponse({ stream }) })
    expect(await collect(t, { messages: [user('x')] })).toEqual([
      { type: 'start', id: 'msg-7' },
      { type: 'data-weather', id: 'w1', data: { status: 'loading' } },
      { type: 'source-url', sourceId: 's1', url: 'https://example.com', title: 'Ex' },
      { type: 'file', url: 'data:text/plain;base64,aGk=', mediaType: 'text/plain' },
      { type: 'data-weather', id: 'w1', data: { status: 'done', temp: 24 } },
      { type: 'text', delta: 'Sunny.' },
      { type: 'finish', reason: 'stop' },
    ])
    const failing = createUIMessageStream({ execute: () => { throw new Error('db down') }, onError: e => `Sorry: ${e.message}` })
    await expect(collect(uiMessageStream('/api/chat', { fetch: async () => createUIMessageStreamResponse({ stream: failing }) }), { messages: [user('x')] }))
      .rejects.toThrow('uiMessageStream: Sorry: db down')
  })

  it('structured output: the output schema goes in the body', async () => {
    const r = aiSdkRoute(() => ({ model: steps({ text: ['{"a":1}'] }) }))
    await collect(uiMessageStream('/api/chat', { fetch: r.fetch }), { messages: [user('x')], output: z.object({ a: z.number() }) })
    expect(r.calls[0].body.output).toEqual({ schema: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] }, wrapped: false })
  })
})

describe('uiMessageStream: the protocol', () => {
  it('fails clearly on a protocol version it does not speak', async () => {
    const f = fixtureFetch(() => dataSSE([{ type: 'text-delta', id: 't', delta: 'x' }]), { headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v2' } })
    await expect(collect(uiMessageStream('/api/chat', { fetch: f.fetch }), { messages: [user('x')] }))
      .rejects.toMatchObject({ version: 'v2', message: expect.stringContaining('speaks UI message stream v2; this transport speaks v1') })
    expect(f.aborted).toBe(1)
  })

  it('accepts a stream without the header (a proxy stripped it); an abort chunk finishes with abort; unknown chunks are ignored', async () => {
    const f = fixtureFetch(() => dataSSE([{ type: 'start-step' }, { type: 'custom', kind: 'x.y' }, { type: 'text-delta', id: 't', delta: 'par' }, { type: 'reasoning-file', url: 'u', mediaType: 'm' }, { type: 'future-thing' }, { type: 'abort', reason: 'stop' }]))
    expect(await collect(uiMessageStream('/api/chat', { fetch: f.fetch }), { messages: [user('x')] })).toEqual([{ type: 'text', delta: 'par' }, { type: 'finish', reason: 'abort' }])
  })

  it('a tool call still open when the stream ends is a client tool call; an HTTP error carries status', async () => {
    const f = fixtureFetch(() => dataSSE([{ type: 'tool-input-available', toolCallId: 'c', toolName: 't', input: { a: 1 } }], false))
    expect(await collect(uiMessageStream('/api/chat', { fetch: f.fetch }), { messages: [user('x')] })).toEqual([{ type: 'tool-call', id: 'c', name: 't', input: { a: 1 } }])
    const e = fixtureFetch(() => 'Unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } })
    await expect(collect(uiMessageStream('/api/chat', { fetch: e.fetch }), { messages: [user('x')] })).rejects.toMatchObject({ status: 401, message: 'uiMessageStream: HTTP 401: Unauthorized' })
  })

  it('abort cancels the body', async () => {
    const f = fixtureFetch(() => Array.from({ length: 40 }, (_, i) => dataSSE([{ type: 'text-delta', id: 't', delta: `w${i}` }], false)), { gapMs: 2 })
    const ac = new AbortController()
    let n = 0
    await expect((async () => { for await (const _ of uiMessageStream('/api/chat', { fetch: f.fetch }).stream({ messages: [user('x')] }, ac.signal)) if (++n == 2) ac.abort() })()).rejects.toThrow()
    expect(n).toBeLessThan(5)
    expect(f.aborted).toBe(1)
  })
})
