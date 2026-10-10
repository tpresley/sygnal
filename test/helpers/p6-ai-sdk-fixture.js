// PLAN-6 2-T: real AI SDK 7 servers for uiMessageStream()'s fixture tests (no network): streamText
// over MockLanguageModelV4 (`ai/test`) answered with toUIMessageStreamResponse(), the Response an
// AI SDK route returns. `ai` is an exact-pinned devDependency (never a runtime dependency).
import { streamText, tool, jsonSchema, convertToModelMessages, stepCountIs } from 'ai'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'

const usage = { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } }

/** the model's stream parts for one step: text pieces, then tool calls ({ id, name, input }) */
export function steps(...each) {
  let i = 0
  return new MockLanguageModelV4({
    doStream: async () => {
      const step = each[Math.min(i++, each.length - 1)]
      const parts = [{ type: 'stream-start', warnings: [] }]
      if (step.reasoning) parts.push({ type: 'reasoning-start', id: 'r' }, { type: 'reasoning-delta', id: 'r', delta: step.reasoning }, { type: 'reasoning-end', id: 'r' })
      if (step.text?.length) parts.push({ type: 'text-start', id: 't' }, ...step.text.map(delta => ({ type: 'text-delta', id: 't', delta })), { type: 'text-end', id: 't' })
      for (const c of step.calls || []) parts.push({ type: 'tool-call', toolCallId: c.id, toolName: c.name, input: JSON.stringify(c.input) })
      parts.push({ type: 'finish', usage, finishReason: { unified: step.calls?.length ? 'tool-calls' : 'stop', raw: undefined } })
      return { stream: convertArrayToReadableStream(parts) }
    },
  })
}

/**
 * fetch for an AI SDK route: `handler({ messages, body })` returns the streamText options (model,
 * tools, ...); the route converts the UIMessages with convertToModelMessages, as a real one does
 */
export function aiSdkRoute(handler) {
  const calls = []
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, init, body })
    const opts = await handler(body)
    const result = streamText({ messages: await convertToModelMessages(body.messages), abortSignal: init.signal, ...opts })
    return result.toUIMessageStreamResponse(opts.response)
  }
  return { fetch, calls }
}

export { tool, jsonSchema, stepCountIs }
