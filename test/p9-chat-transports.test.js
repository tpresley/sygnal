// PLAN-9 H-2 (chat-client-tools.md, "Transports"): a tool part carrying a card (`ui`) on the wire.
// uiMessageStream sends the parts as they are, `ui` included (an AI SDK 7 route validates and
// converts them: a tool call plus a tool result `{ part, answer }`); openResponses and
// chatCompletions send only the call's input and its output.
import { describe, it, expect } from 'vitest'
import { validateUIMessages, convertToModelMessages } from 'ai'
import { uiMessageStream } from '../src/extra/ai/transports/uiMessageStream.ts'
import { openResponses } from '../src/extra/ai/transports/openResponses.ts'
import { chatCompletions } from '../src/extra/ai/transports/chatCompletions.ts'
import { encodeOpenResponses } from '../src/extra/ai/transports/encodeOpenResponses.ts'
import { steps, aiSdkRoute } from './helpers/p6-ai-sdk-fixture.js'
import { dataSSE, fixtureFetch, collect } from './helpers/p6-sse-fixture.js'

const ui = {
  status: 'answered', local: {}, ui: {}, pending: null,
  layout: { root: 'page', nodes: { page: { part: 'page', slots: { default: ['plans'] } }, plans: { part: 'plans' } } },
  answer: { node: 'plans', part: 'plans', value: 'team' },
}
const messages = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Which plan?' }] },
  { id: 'a1', role: 'assistant', parts: [
    { type: 'step-start' },
    { type: 'tool-ask_user', toolCallId: 'call1', state: 'output-available', input: { need: 'Pick a plan' }, output: { part: 'plans', answer: 'team' }, ui },
  ] },
]
const request = { messages, continue: true, tools: { ask_user: { description: 'Ask the user', inputSchema: { type: 'object', properties: { need: { type: 'string' } }, required: ['need'] } } } }

describe('a tool part with a card, per transport', () => {
  it('uiMessageStream keeps `ui`; an AI SDK 7 route validates it and converts the call and its output', async () => {
    const r = aiSdkRoute(() => ({ model: steps({ text: ['Team it is.'] }) }))
    const ev = await collect(uiMessageStream('/api/chat', { fetch: r.fetch }), request)
    expect(ev.filter((e) => e.type == 'text').map((e) => e.delta).join('')).toBe('Team it is.')
    const sent = r.calls[0].body.messages[1].parts[1]
    expect(sent.ui).toEqual(ui)
    await expect(validateUIMessages({ messages: r.calls[0].body.messages })).resolves.toHaveLength(2)
    const model = await convertToModelMessages(r.calls[0].body.messages)
    const flat = JSON.stringify(model)
    expect(flat).toContain('"toolName":"ask_user"')
    expect(flat).toContain('"answer":"team"')
    expect(flat).not.toContain('"layout"')
  })

  it('openResponses sends a function_call and its output, no `ui`', async () => {
    const f = fixtureFetch(() => encodeOpenResponses(['ok']))
    await collect(openResponses({ baseURL: 'http://localhost:11434/v1', model: 'm', fetch: f.fetch }), request)
    const body = f.calls[0].json
    const flat = JSON.stringify(body.input)
    expect(body.input.map((i) => i.type ?? i.role)).toEqual(expect.arrayContaining(['function_call', 'function_call_output']))
    expect(flat).toContain('Pick a plan')
    expect(flat).toContain('team')
    expect(flat).not.toContain('layout')
    expect(flat).not.toContain('"status"')
  })

  it('chatCompletions sends tool_calls and a tool message, no `ui`', async () => {
    const f = fixtureFetch(() => dataSSE([{ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }]))
    await collect(chatCompletions({ baseURL: 'http://localhost:11434/v1/', model: 'm', fetch: f.fetch }), request)
    const msgs = f.calls[0].json.messages
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool'])
    expect(msgs[1].tool_calls[0].function).toMatchObject({ name: 'ask_user' })
    expect(JSON.parse(msgs[2].content)).toEqual({ part: 'plans', answer: 'team' })
    expect(JSON.stringify(msgs)).not.toContain('layout')
  })
})
