// PLAN-6 G-637: agui() against a real local AG-UI server (an HTTP server on 127.0.0.1, real
// sockets and Node's fetch), built the way AG-UI's TypeScript servers are: the request body parsed
// with @ag-ui/core's RunAgentInputSchema (a 400 when it doesn't parse), the reply encoded with
// @ag-ui/encoder's EventEncoder (exact-pinned devDependency; it picks SSE from the Accept header
// the transport sends), every emitted event checked with @ag-ui/core's EventSchemas. No AG-UI
// package ships a runnable test agent, so the agent here is scripted: turn 1 streams state, text
// and a client tool call; turn 2 (the tool's result sent back) runs a tool of its own and answers.
// Abort closes the connection mid-run.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import { EventEncoder } from '@ag-ui/encoder'
import { EventSchemas, RunAgentInputSchema } from '@ag-ui/core/schemas'
import { agui } from '../src/extra/ai/transports/agui.ts'
import { collect } from './helpers/p6-sse-fixture.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const user = text => ({ role: 'user', parts: [{ type: 'text', text }] })

let server, url
const seen = { inputs: [], closed: 0, accept: [] }

// the scripted agent: a run's events from its RunAgentInput
function agent(input) {
  const { threadId, runId } = input
  const last = input.messages[input.messages.length - 1]
  const events = [{ type: 'RUN_STARTED', threadId, runId }]
  if (last.role == 'tool') {
    const city = JSON.parse(last.content).city
    events.push(
      { type: 'STEP_STARTED', stepName: 'lookup' },
      { type: 'TOOL_CALL_START', toolCallId: 'srv1', toolCallName: 'forecast', parentMessageId: 'a2' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'srv1', delta: JSON.stringify({ city }) },
      { type: 'TOOL_CALL_END', toolCallId: 'srv1' },
      { type: 'TOOL_CALL_RESULT', messageId: 'r1', toolCallId: 'srv1', content: JSON.stringify({ high: 27 }), role: 'tool' },
      { type: 'STEP_FINISHED', stepName: 'lookup' },
      { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/phase', value: 'answered' }, { op: 'add', path: '/cities/-', value: city }] },
      { type: 'TEXT_MESSAGE_START', messageId: 'a2', role: 'assistant' },
      ...['In ', city, ' the high is 27°C.'].map(delta => ({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a2', delta })),
      { type: 'TEXT_MESSAGE_END', messageId: 'a2' },
      { type: 'RUN_FINISHED', threadId, runId, usage: [{ inputTokens: 40, outputTokens: 12, totalTokens: 52 }] },
    )
  } else {
    const tool = input.tools.find(t => t.name == 'pick_city')
    events.push(
      { type: 'STATE_SNAPSHOT', snapshot: { phase: 'asking', cities: [] } },
      { type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'Which city? ' },
      { type: 'TEXT_MESSAGE_END', messageId: 'a1' },
      ...(tool ? [
        { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'pick_city', parentMessageId: 'a1' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{"from":' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '["Hilo","Oslo"]}' },
        { type: 'TOOL_CALL_END', toolCallId: 'c1' },
      ] : []),
      { type: 'RUN_FINISHED', threadId, runId },
    )
  }
  for (const e of events) EventSchemas.parse(e)
  return events
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    let input
    try { input = RunAgentInputSchema.parse(JSON.parse(body)) } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e.message).slice(0, 300) }))
      return
    }
    seen.inputs.push(input)
    seen.accept.push(req.headers.accept)
    const encoder = new EventEncoder({ accept: req.headers.accept })
    res.writeHead(200, { 'content-type': encoder.getContentType(), 'cache-control': 'no-cache' })
    res.on('close', () => { if (!res.writableEnded) seen.closed++ })
    const slow = input.forwardedProps?.slow
    for (const e of agent(input)) {
      if (res.destroyed) return
      res.write(encoder.encode(e))
      await sleep(slow ? 40 : 2)
    }
    res.end()
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${server.address().port}/agent`
})
afterAll(() => new Promise(r => server.close(r)))

describe('agui against a local AG-UI server (EventEncoder, RunAgentInputSchema)', () => {
  it('two runs: state, text, a client tool call; then its result back, an agent-run tool, state delta, answer', async () => {
    const t = agui(url, { threadId: 'thread-1', context: [{ description: 'units', value: 'metric' }] })
    const tools = { pick_city: { description: 'Ask the user to pick a city', inputSchema: { type: 'object', properties: { from: { type: 'array', items: { type: 'string' } } } } } }
    const first = await collect(t, { instructions: 'Be brief', model: 'agent-model', messages: [user('weather?')], tools })
    expect(first).toEqual([
      { type: 'data-agui-state', id: 'state', data: { phase: 'asking', cities: [] } },
      { type: 'start', id: 'a1' },
      { type: 'text', delta: 'Which city? ' },
      { type: 'tool-call', id: 'c1', name: 'pick_city', input: { from: ['Hilo', 'Oslo'] } },
      { type: 'finish', reason: 'tool-calls' },
    ])
    expect(seen.accept[0]).toBe('text/event-stream')
    expect(seen.inputs[0]).toMatchObject({
      threadId: 'thread-1', state: {}, context: [{ description: 'units', value: 'metric' }],
      messages: [{ id: 'instructions', role: 'system', content: 'Be brief' }, { role: 'user', content: 'weather?' }],
      tools: [{ name: 'pick_city', description: 'Ask the user to pick a city' }],
      forwardedProps: { model: 'agent-model' },
    })

    // the app ran pick_city: the assistant message with its result goes back
    const assistant = { id: 'a1', role: 'assistant', parts: [
      { type: 'text', text: 'Which city? ' },
      { type: 'tool-pick_city', toolCallId: 'c1', state: 'output-available', input: { from: ['Hilo', 'Oslo'] }, output: { city: 'Hilo' } },
    ] }
    const second = await collect(t, { messages: [user('weather?'), assistant] })
    expect(second).toEqual([
      // the tool call's parentMessageId starts the message
      { type: 'start', id: 'a2' },
      { type: 'tool-call', id: 'srv1', name: 'forecast', input: { city: 'Hilo' }, executed: true },
      { type: 'tool-result', id: 'srv1', output: { high: 27 } },
      { type: 'data-agui-state', id: 'state', data: { phase: 'answered', cities: ['Hilo'] } },
      { type: 'text', delta: 'In ' },
      { type: 'text', delta: 'Hilo' },
      { type: 'text', delta: ' the high is 27°C.' },
      { type: 'finish', reason: 'stop', usage: { inputTokens: 40, outputTokens: 12, totalTokens: 52 } },
    ])
    // the same thread, a new run, the latest state the transport saw, the tool result as a tool message
    const input = seen.inputs[1]
    expect(input.threadId).toBe('thread-1')
    expect(input.runId).not.toBe(seen.inputs[0].runId)
    expect(input.state).toEqual({ phase: 'asking', cities: [] })
    expect(input.messages.slice(1)).toEqual([
      { id: 'a1', role: 'assistant', content: 'Which city? ', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'pick_city', arguments: '{"from":["Hilo","Oslo"]}' } }] },
      { id: 'c1_result', role: 'tool', toolCallId: 'c1', content: '{"city":"Hilo"}' },
    ])
  })

  it('a body the server can’t parse is the request’s failure (HTTP 400)', async () => {
    const t = agui(url, { body: { messages: 'nope' } })
    await expect(collect(t, { messages: [user('x')] })).rejects.toMatchObject({ status: 400 })
  })

  it('abort closes the connection mid-run', async () => {
    const before = seen.closed
    const ac = new AbortController()
    const t = agui(url)
    const got = []
    await expect((async () => {
      for await (const e of t.stream({ messages: [user('hi')], body: { forwardedProps: { slow: true } } }, ac.signal)) {
        got.push(e)
        if (e.type == 'text') ac.abort()
      }
    })()).rejects.toThrow()
    expect(got.at(-1)).toEqual({ type: 'text', delta: 'Which city? ' })
    for (let i = 0; i < 100 && seen.closed == before; i++) await sleep(10)
    expect(seen.closed).toBe(before + 1)
  })
})
