// PLAN-6 L-2 (3-W2): agui() over AG-UI event streams (no network). Every fixture event and the
// RunAgentInput the transport sends are checked against @ag-ui/core's own schemas (an exact
// devDependency). Text, reasoning, client and agent-run tool calls (START/ARGS/END and CHUNK
// forms), STATE_SNAPSHOT / STATE_DELTA as a `data-agui-state` part (RFC 6902 applied), the next
// run sending the latest state, MESSAGES_SNAPSHOT, RUN_ERROR, abort.
import { describe, it, expect } from 'vitest'
import { EventSchemas, RunAgentInputSchema } from '@ag-ui/core/schemas'
import { z } from 'zod'
import { agui, toAgui, applyPatch } from '../src/extra/ai/transports/agui.ts'
import { dataSSE, fixtureFetch, collect } from './helpers/p6-sse-fixture.js'

const user = text => ({ role: 'user', parts: [{ type: 'text', text }] })
const valid = events => { for (const e of events) EventSchemas.parse(e); return events }
const run = (...events) => valid([{ type: 'RUN_STARTED', threadId: 'th', runId: 'r1' }, ...events])
const done = (extra = {}) => ({ type: 'RUN_FINISHED', threadId: 'th', runId: 'r1', ...extra })
const transport = (answer, opts = {}, fx = {}) => {
  const f = fixtureFetch(json => { const ev = typeof answer == 'function' ? answer(json) : answer; return typeof ev == 'string' ? ev : dataSSE(ev, false) }, fx)
  return { f, t: agui('http://localhost:8000/agent', { fetch: f.fetch, ...opts }) }
}

describe('agui: events', () => {
  it('text and reasoning messages, a client tool call (START/ARGS/END) yielded when the run ends', async () => {
    const { t } = transport(run(
      { type: 'REASONING_START', messageId: 'rs1' },
      { type: 'REASONING_MESSAGE_START', messageId: 'rs1', role: 'reasoning' },
      { type: 'REASONING_MESSAGE_CONTENT', messageId: 'rs1', delta: 'thinking' },
      { type: 'REASONING_MESSAGE_END', messageId: 'rs1' },
      { type: 'REASONING_END', messageId: 'rs1' },
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Let me ' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'check.' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'get_weather', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"city":' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '"Hilo"}' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
      done({ usage: [{ inputTokens: 10, outputTokens: 5, totalTokens: 15 }, { inputTokens: 1, outputTokens: 1 }] }),
    ), {}, { split: 31 })
    expect(await collect(t, { messages: [user('weather?')], tools: { get_weather: { inputSchema: { type: 'object', properties: { city: { type: 'string' } } } } } })).toEqual([
      { type: 'reasoning', delta: 'thinking' },
      { type: 'start', id: 'm1' },
      { type: 'text', delta: 'Let me ' },
      { type: 'text', delta: 'check.' },
      { type: 'tool-call', id: 'tc1', name: 'get_weather', input: { city: 'Hilo' } },
      { type: 'finish', reason: 'tool-calls', usage: { inputTokens: 11, outputTokens: 6, totalTokens: 17 } },
    ])
  })

  it('a tool the agent runs (TOOL_CALL_RESULT): an executed call and its result, then more text', async () => {
    const { t } = transport(run(
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'search', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"q":"x"}' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
      { type: 'TOOL_CALL_RESULT', messageId: 'res1', toolCallId: 'tc1', content: '{"hits":2}', role: 'tool' },
      { type: 'TEXT_MESSAGE_START', messageId: 'm2', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'Two hits.' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm2' },
      done({ outcome: { type: 'success' } }),
    ))
    expect(await collect(t, { messages: [user('x')] })).toEqual([
      { type: 'start', id: 'm1' },
      { type: 'tool-call', id: 'tc1', name: 'search', input: { q: 'x' }, executed: true },
      { type: 'tool-result', id: 'tc1', output: { hits: 2 } },
      { type: 'text', delta: 'Two hits.' },
      { type: 'finish', reason: 'stop' },
    ])
  })

  it('CHUNK forms; a non-assistant text message skipped; STEP_FINISHED releases open calls; a stream without RUN_FINISHED', async () => {
    const { t } = transport(run(
      { type: 'TEXT_MESSAGE_CHUNK', messageId: 'm1', role: 'assistant', delta: 'Hi. ' },
      { type: 'TEXT_MESSAGE_CHUNK', messageId: 'dev1', role: 'developer', delta: 'internal' },
      { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: 'hm' },
      { type: 'TOOL_CALL_CHUNK', toolCallId: 'a', toolCallName: 'add', parentMessageId: 'm1', delta: '{"n":' },
      { type: 'TOOL_CALL_CHUNK', delta: '1}' },
      { type: 'TOOL_CALL_CHUNK', toolCallId: 'b', toolCallName: 'add', delta: '{"n":2}' },
      { type: 'STEP_FINISHED', stepName: 's' },
    ))
    expect(await collect(t, { messages: [user('x')] })).toEqual([
      { type: 'start', id: 'm1' },
      { type: 'text', delta: 'Hi. ' },
      { type: 'reasoning', delta: 'hm' },
      { type: 'tool-call', id: 'a', name: 'add', input: { n: 1 } },
      { type: 'tool-call', id: 'b', name: 'add', input: { n: 2 } },
    ])
  })

  it('STATE_SNAPSHOT / STATE_DELTA -> a data-agui-state part with the whole state; the next run sends it', async () => {
    let n = 0
    const { f, t } = transport(() => n++ ? run(done()) : run(
      { type: 'STATE_SNAPSHOT', snapshot: { todos: ['milk'], filter: 'all' } },
      { type: 'STATE_DELTA', delta: [{ op: 'add', path: '/todos/-', value: 'eggs' }, { op: 'replace', path: '/filter', value: 'open' }] },
      { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: 'x' }] },
      { type: 'ACTIVITY_SNAPSHOT', messageId: 'act1', activityType: 'plan', content: { steps: 2 } },
      done(),
    ), { state: { todos: [] } })
    expect((await collect(t, { messages: [user('x')] })).slice(0, -1)).toEqual([
      { type: 'data-agui-state', id: 'state', data: { todos: ['milk'], filter: 'all' } },
      { type: 'data-agui-state', id: 'state', data: { todos: ['milk', 'eggs'], filter: 'open' } },
      { type: 'data-agui-messages', id: 'messages', data: [{ id: 'u1', role: 'user', content: 'x' }] },
      { type: 'data-agui-activity', id: 'act1', data: { activityType: 'plan', content: { steps: 2 } } },
    ])
    expect(f.calls[0].json.state).toEqual({ todos: [] })
    await collect(t, { messages: [user('y')] })
    expect(f.calls[1].json.state).toEqual({ todos: ['milk', 'eggs'], filter: 'open' })
    expect(f.calls[1].json.threadId).toBe(f.calls[0].json.threadId)
    expect(f.calls[1].json.runId).not.toBe(f.calls[0].json.runId)
    // a request's own state wins
    await collect(t, { messages: [user('z')], state: { reset: true } })
    expect(f.calls[2].json.state).toEqual({ reset: true })
  })

  it('RUN_ERROR throws; an interrupt outcome finishes as other; abort cancels the body', async () => {
    await expect(collect(transport(run({ type: 'RUN_ERROR', message: 'agent crashed', code: 'E1' })).t, { messages: [user('x')] })).rejects.toMatchObject({ message: 'agui: agent crashed', code: 'E1' })
    const ev = await collect(transport(run(done({ outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'approval' }] } }))).t, { messages: [user('x')] })
    expect(ev).toEqual([{ type: 'finish', reason: 'other' }])
    const f = fixtureFetch(() => [dataSSE(run({ type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }), false), ...Array.from({ length: 40 }, (_, i) => dataSSE([{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: `w${i} ` }], false))], { gapMs: 2 })
    const ac = new AbortController()
    let n = 0
    await expect((async () => { for await (const _ of agui('/agent', { fetch: f.fetch }).stream({ messages: [user('x')] }, ac.signal)) if (++n == 3) ac.abort() })()).rejects.toThrow()
    expect(n).toBeLessThan(6)
    expect(f.aborted).toBe(1)
  })
})

describe('agui: the request (a valid RunAgentInput)', () => {
  it('instructions, messages (steps, tool results, files), tools, context, forwardedProps, headers', async () => {
    const { f, t } = transport(run(done()), { threadId: 'th-1', context: [{ description: 'user', value: 'Troy' }], headers: { authorization: 'Bearer s' }, body: { extra: 1 } })
    await collect(t, {
      instructions: 'Be brief', model: 'gpt-x', output: z.object({ ok: z.boolean() }),
      tools: { add: { description: 'Add', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } } },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'add milk' }, { type: 'file', mediaType: 'image/png', url: 'https://x/a.png' }] },
        { id: 'a1', role: 'assistant', parts: [
          { type: 'text', text: 'Adding.' },
          { type: 'tool-add', toolCallId: 'c1', state: 'output-available', input: { text: 'milk' }, output: 'ok' },
          { type: 'tool-add', toolCallId: 'c2', state: 'output-error', input: { text: 'x' }, errorText: 'bad' },
          { type: 'text', text: 'Done.' },
        ] },
      ],
    })
    const { url, json, headers } = f.calls[0]
    expect(url).toBe('http://localhost:8000/agent')
    expect(headers).toMatchObject({ accept: 'text/event-stream', authorization: 'Bearer s', 'content-type': 'application/json' })
    expect(() => RunAgentInputSchema.parse(json)).not.toThrow()
    expect(json).toMatchObject({
      threadId: 'th-1', state: {}, extra: 1,
      context: [{ description: 'user', value: 'Troy' }],
      tools: [{ name: 'add', description: 'Add', parameters: { type: 'object', properties: { text: { type: 'string' } } } }],
      forwardedProps: { model: 'gpt-x', output: { schema: expect.objectContaining({ type: 'object' }), wrapped: false } },
      messages: [
        { id: 'instructions', role: 'system', content: 'Be brief' },
        { id: 'u1', role: 'user', content: [{ type: 'text', text: 'add milk' }, { type: 'image', source: { type: 'url', value: 'https://x/a.png', mimeType: 'image/png' } }] },
        { id: 'a1', role: 'assistant', content: 'Adding.', toolCalls: [
          { id: 'c1', type: 'function', function: { name: 'add', arguments: '{"text":"milk"}' } },
          { id: 'c2', type: 'function', function: { name: 'add', arguments: '{"text":"x"}' } },
        ] },
        { id: 'c1_result', role: 'tool', toolCallId: 'c1', content: 'ok' },
        { id: 'c2_result', role: 'tool', toolCallId: 'c2', content: '{"error":"bad"}', error: 'bad' },
        { id: 'a1_1', role: 'assistant', content: 'Done.' },
      ],
    })
    expect(typeof json.runId).toBe('string')
  })

  it('toAgui: plain content messages', () => {
    expect(toAgui({ role: 'user', content: 'hi' }, 3)).toEqual([{ id: 'm3', role: 'user', content: 'hi' }])
    expect(toAgui({ role: 'assistant', content: 'yo' }, 0)).toEqual([{ id: 'm0', role: 'assistant', content: 'yo' }])
  })
})

describe('agui: applyPatch (RFC 6902)', () => {
  it('add / remove / replace / move / copy, array indexes and "-", escaped keys, the input unchanged', () => {
    const doc = { a: [1, 2], 'x/y': { '~t': 1 }, b: { c: 1 } }
    const out = applyPatch(doc, [
      { op: 'add', path: '/a/1', value: 9 },
      { op: 'add', path: '/a/-', value: 3 },
      { op: 'remove', path: '/x~1y/~0t' },
      { op: 'replace', path: '/b/c', value: 2 },
      { op: 'move', from: '/b', path: '/d' },
      { op: 'copy', from: '/a', path: '/e' },
      { op: 'test', path: '/a/0', value: 1 },
    ])
    expect(out).toEqual({ a: [1, 9, 2, 3], 'x/y': {}, d: { c: 2 }, e: [1, 9, 2, 3] })
    expect(doc).toEqual({ a: [1, 2], 'x/y': { '~t': 1 }, b: { c: 1 } })
    expect(applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: { b: 2 } }])).toEqual({ b: 2 })
  })
})
