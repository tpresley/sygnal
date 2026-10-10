// PLAN-6 L-1 / L-4: makeChatDriver's request, reply and event types; the LLM fake's t.stream
import xs from 'xstream'
import { makeChatDriver, messageText, outputJsonSchema, withToolResults } from 'sygnal/ai'
import type { ChatRequest, ChatAbort, ChatDelta, ChatOk, ChatError, ChatToolCall, ChatEvent, ChatTransport, ChatOutputOf, ChatOutputSchema, Message } from 'sygnal/ai'
import { makeChatDriver as fromCore, renderComponent } from 'sygnal'
import type { ChatRequest as CoreRequest, FakeChatChunk } from 'sygnal'

// a transport: an async iterable of ChatEvents
const transport: ChatTransport = {
  async *stream(request, signal) {
    const n: number = request.messages.length
    if (signal.aborted) return
    yield { type: 'text', delta: `${n}` }
    yield { type: 'reasoning', delta: 'hmm' }
    yield { type: 'tool-call', id: 'c1', name: 'weather', input: { city: 'Hilo' } }
    yield { type: 'tool-result', id: 'c1', output: 27 }
    yield { type: 'data', name: 'progress', data: 1 }
    yield { type: 'data-progress', id: 'p', data: 2 }
    yield { type: 'source-url', sourceId: 's', url: 'https://x' }
    yield { type: 'finish', reason: 'stop', usage: { out: 1 } }
  },
}
// @ts-expect-error a text event's delta is a string
export const badEvent: ChatEvent = { type: 'text', delta: 3 }

const messages: Message[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', parts: [{ type: 'text', text: 'yo' }] }]
const request: ChatRequest = { messages, key: 'reply', delta: 'DELTA', ok: 'DONE', error: 'FAILED', tool: 'TOOL', coalesce: 'frame', latest: false, temperature: 0.2 }
const numeric: ChatRequest = { messages, ok: 'DONE', coalesce: 50 }
const stops: ChatAbort[] = [{ abort: 'reply' }, { abort: true }, { abort: true, key: 'reply' }]
// @ts-expect-error messages is required
export const noMessages: ChatRequest = { ok: 'DONE' }
// @ts-expect-error a then key is not allowed (SYG610)
export const thenable: ChatRequest = { messages, then: 'DONE' }
// @ts-expect-error coalesce is 'frame', 'none' or a number
export const badCoalesce: ChatRequest = { messages, coalesce: 'fast' }

const driver = makeChatDriver({ transport, coalesce: 'none' })
const source = driver(xs.of<ChatRequest | ChatAbort>(request, numeric, ...stops))
source.dispose()
// @ts-expect-error a transport is required
makeChatDriver({})
// the same function from 'sygnal' (D253)
const same: typeof makeChatDriver = fromCore
export const core: CoreRequest = request

// reply data
export const onDelta = (d: ChatDelta): [string, string, string, string] => [d.key, d.text, d.reasoning, d.delta]
export const onTool = (d: ChatToolCall): string => d.call.name
export const onError = (d: ChatError) => [d.error.message, d.error.status, d.issues?.[0]?.message, d.request.messages]
type Todo = { title: string; done: boolean }
export const onOk = (d: ChatOk<Todo>): string => (d.value?.title ?? '') + messageText(d.message) + d.text + d.finishReason + d.toolCalls.length

// structured output: the value type follows the schema's output type
declare const TodoSchema: ChatOutputSchema<Todo>
const structured: ChatRequest<Todo> = { messages, output: TodoSchema, ok: 'DONE' }
type Out = ChatOutputOf<typeof TodoSchema>
export const out: Out = { title: 'x', done: false }
// @ts-expect-error the inferred output has a boolean done
export const badOut: Out = { title: 'x', done: 'no' }
const js = outputJsonSchema(TodoSchema)
export const wrapped: boolean | undefined = js?.wrapped

// L-4: the LLM fake
function Chat() { return null as any }
const t = renderComponent(Chat, { llmSink: 'LLM' })
const chunks: FakeChatChunk[] = ['Hi', { reasoning: 'r' }, { toolCall: { name: 'weather', input: {} } }, { toolResult: { id: 'c1', output: 1 } },
  { data: { a: 1 }, name: 'x' }, { finish: 'stop' }, { finish: { reason: 'length', usage: {} } }, { type: 'text', delta: 'raw' }]
t.stream('LLM', chunks)
t.stream('LLM', ['Hi'], { end: false })
t.stream('LLM', ['Hi'], 'reply', { end: false })
t.stream('LLM', ['Hi'], (r: any) => r.key === 'reply')
t.respond('LLM', 'Hi!')
t.fail('LLM', 429)
// @ts-expect-error chunks is an array
t.stream('LLM', 'Hi')

export { structured, same, source }
// 3-F (G-628): a reply that continues the last (assistant) message
export const continued: ChatRequest = { messages, ok: 'DONE', continue: true }
// 4-F: withToolResults keeps the message type; results by function or by key
const asked: Message = { role: 'assistant', parts: [{ type: 'tool-add', toolCallId: 'c1', state: 'input-available', input: {} }] }
export const answeredByKey: Message = withToolResults(asked, { add: { ok: true } })
export const answeredByFn: Message = withToolResults(asked, (call) => (call.name === 'add' ? { ok: true } : new Error('unknown tool')))
// @ts-expect-error results are a function or an object
withToolResults(asked, 42)
