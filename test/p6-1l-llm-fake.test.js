// PLAN-6 L-4: renderComponent's LLM fake. A driverless 'LLM' sink runs the real makeChatDriver
// over an in-memory transport: t.requests('LLM'), await t.stream('LLM', chunks, target?, { end }),
// t.respond('LLM', text), t.fail('LLM', error) (chat wording, G-585), the llmSink option, and fake
// timers. Its streams share the HTTP fake's pending list and target rules.
import { it, expect, afterEach, describe, vi } from 'vitest'
import { z } from 'zod'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { Collection } from '../src/collection.ts'
import { ABORT } from '../src/shared.ts'
import { messageText } from '../src/extra/ai/messages.ts'

function Chat({ state }) {
  return h('section', { className: 'chat' },
    h('ol', { className: 'messages' },
      ...state.messages.map((m, i) => h('li', { key: i, className: m.role }, messageText(m))),
      state.draft ? h('li', { className: 'assistant streaming' }, state.draft) : null),
    state.error ? h('p', { role: 'alert' }, state.error) : null,
    h('form', { className: 'ask' },
      h('input', { className: 'prompt', value: state.prompt }),
      h('button', { type: 'submit', disabled: state.status === 'streaming' }, 'Send'),
      h('button', { type: 'button', className: 'stop', hidden: state.status !== 'streaming' }, 'Stop')))
}
Chat.initialState = { messages: [], prompt: '', draft: '', status: 'ready', error: null, calls: [] }
Chat.intent = ({ DOM }) => ({
  TYPE: DOM.input('.prompt').value(),
  SEND: DOM.select('.ask').events('submit', { preventDefault: true }),
  STOP: DOM.click('.stop'),
})
const withPrompt = (state) => [...state.messages, { role: 'user', parts: [{ type: 'text', text: state.prompt }] }]
Chat.model = {
  TYPE: (state, prompt) => ({ ...state, prompt }),
  SEND: {
    STATE: (state) => state.prompt.trim()
      ? { ...state, messages: withPrompt(state), prompt: '', status: 'streaming', error: null }
      : ABORT,
    LLM: (state) => state.prompt.trim()
      ? { messages: withPrompt(state), key: 'reply', delta: 'DELTA', ok: 'DONE', error: 'FAILED', tool: 'TOOL' }
      : ABORT,
  },
  STOP: {
    STATE: (state) => ({ ...state, status: 'ready', draft: '' }),
    LLM: () => ({ abort: 'reply' }),
  },
  DELTA: (state, { text }) => ({ ...state, draft: text }),
  TOOL: (state, { call }) => ({ ...state, calls: [...state.calls, call] }),
  DONE: (state, { message }) => ({ ...state, messages: [...state.messages, message], draft: '', status: 'ready' }),
  FAILED: (state, { error }) => ({ ...state, draft: '', status: 'error', error: error.message }),
}

let t
afterEach(() => { t?.dispose(); t = null; vi.useRealTimers() })

const ask = (text) => {
  t.simulateEvent('.prompt', 'input', { value: text })
  t.simulateEvent('.ask', 'submit')
}

describe('the LLM fake', () => {
  it('streams a reply: one frame, one delta, then ok', async () => {
    t = renderComponent(Chat)
    ask('Hello')
    await t.settle()
    expect(t.requests('LLM')[0].messages.at(-1).parts[0].text).toBe('Hello')
    await t.stream('LLM', ['Hi', ' there'])
    expect(t.state.messages.at(-1)).toEqual({ id: expect.stringMatching(/^[0-9a-z]{16}$/), role: 'assistant', parts: [{ type: 'text', text: 'Hi there' }] })
    expect(t.state.status).toBe('ready')
    expect(t.actions.filter(a => a.type === 'DELTA').length).toBe(1)
  })

  it('streams across calls (end: false), then stops mid-stream: the request is no longer pending', async () => {
    t = renderComponent(Chat)
    ask('Tell me a story')
    await t.stream('LLM', ['Once'], { end: false })
    expect(t.state).toMatchObject({ draft: 'Once', status: 'streaming' })
    expect(t.html()).toContain('Once')
    await t.stream('LLM', [' upon', ' a'], undefined, { end: false })   // a second frame; the options as the last argument
    expect(t.state.draft).toBe('Once upon a')
    t.simulateEvent('.stop', 'click')
    await t.settle()
    expect(t.state).toMatchObject({ draft: '', status: 'ready', messages: [{ role: 'user' }] })
    expect(() => t.stream('LLM', [' time'])).toThrow(/no pending LLM request/)
    expect(t.requests('LLM').length).toBe(1)                            // { abort } isn't listed
    expect(t.actions.filter(a => a.type === 'DELTA').map(a => a.data.text)).toEqual(['Once', 'Once upon a'])
  })

  it('t.fail: the error action; a status number is Error "HTTP 429" with status', async () => {
    t = renderComponent(Chat)
    ask('Hello')
    await t.stream('LLM', ['Hi'], { end: false })
    await t.fail('LLM', new Error('rate limited'))
    expect(t.state).toMatchObject({ status: 'error', error: 'rate limited', draft: '' })
    expect(t.html()).toContain('rate limited')
    ask('Again')
    await t.fail('LLM', 429)
    const failed = t.actions.filter(a => a.type === 'FAILED').at(-1).data
    expect(failed.error.message).toBe('HTTP 429')
    expect(failed.error.status).toBe(429)
    expect(failed).toMatchObject({ key: 'reply', request: { ok: 'DONE' } })
    ask('Once more')
    await t.fail('LLM', 'offline')
    expect(t.state.error).toBe('offline')
  })

  it('t.fail on a request with no error action throws with chat wording (G-585)', async () => {
    function C() { return h('p', null, 'x') }
    C.initialState = {}
    C.model = { GO: { LLM: () => ({ messages: [], ok: 'DONE' }) }, DONE: (s) => s }
    t = renderComponent(C)
    t.simulateAction('GO')
    await t.settle()
    t.fail('LLM', new Error('x'))
    const err = await t.settle().then(() => null, e => e)
    expect(err.message).toMatch(/names no error action, so the chat driver would only log the failure \(SYG678\)/)
    expect(err.message).not.toMatch(/errors\(\)/)
  })

  it('tool calls, tool results, reasoning and data parts; finish reason', async () => {
    t = renderComponent(Chat)
    ask('Weather in Hilo?')
    await t.stream('LLM', [{ reasoning: 'need weather' }, { toolCall: { id: 'c1', name: 'weather', input: { city: 'Hilo' } } },
      { toolResult: { id: 'c1', output: { temp: 27 } } }, { data: { temp: 27 }, name: 'weather' }, { finish: 'tool-calls' }])
    expect(t.state.calls).toEqual([{ id: 'c1', name: 'weather', input: { city: 'Hilo' } }])
    expect(t.state.messages.at(-1).parts).toEqual([
      { type: 'reasoning', text: 'need weather' },
      { type: 'tool-weather', toolCallId: 'c1', state: 'output-available', input: { city: 'Hilo' }, output: { temp: 27 } },
      { type: 'data-weather', data: { temp: 27 } },
    ])
    const ok = t.actions.find(a => a.type === 'DONE').data
    expect(ok.finishReason).toBe('tool-calls')
    expect(ok.toolCalls).toEqual([{ id: 'c1', name: 'weather', input: { city: 'Hilo' } }])
  })

  it('raw ChatEvents and { finish: { reason, usage } } chunks', async () => {
    t = renderComponent(Chat)
    ask('Hi')
    await t.stream('LLM', [{ type: 'start', id: 'm9' }, { type: 'text', delta: 'Yo' }, { finish: { reason: 'length', usage: { out: 1 } } }])
    const ok = t.actions.find(a => a.type === 'DONE').data
    expect(ok).toMatchObject({ finishReason: 'length', usage: { out: 1 }, message: { id: 'm9' } })
  })

  it('latest: a second SEND supersedes the first; the first is no longer a target', async () => {
    t = renderComponent(Chat)
    ask('one')
    await t.stream('LLM', ['a'], { end: false })
    ask('two')
    await t.settle()
    expect(t.requests('LLM').length).toBe(2)
    expect(() => t.stream('LLM', ['x'], { nth: 0 })).toThrow(/not pending/)
    await t.stream('LLM', ['b'], 'reply')                   // a key target
    expect(t.state.messages.map(messageText)).toEqual(['one', 'two', 'b'])
  })

  it('t.respond: the whole reply as one chunk', async () => {
    t = renderComponent(Chat)
    ask('Hello')
    await t.respond('LLM', 'Hi!')
    expect(messageText(t.state.messages.at(-1))).toBe('Hi!')
  })

  it('t.respond with an object: JSON for structured output (ok.value)', async () => {
    const Todo = z.object({ title: z.string() })
    function C({ state }) { return h('p', null, state.todo?.title ?? '') }
    C.initialState = {}
    C.model = {
      GO: { LLM: () => ({ messages: [{ role: 'user', content: 'a todo' }], output: Todo, ok: 'DONE', error: 'FAILED' }) },
      DONE: (s, { value }) => ({ ...s, todo: value }),
      FAILED: (s, { issues }) => ({ ...s, issues }),
    }
    t = renderComponent(C)
    t.simulateAction('GO')
    await t.respond('LLM', { title: 'Buy milk' })
    expect(t.state.todo).toEqual({ title: 'Buy milk' })
    t.simulateAction('GO')
    await t.respond('LLM', { title: 3 })
    expect(t.state.issues[0].path).toEqual(['title'])
  })

  it('works the same under fake timers (no timer is involved)', async () => {
    vi.useFakeTimers()
    t = renderComponent(Chat)
    ask('Hello')
    await t.stream('LLM', ['Hi'], { end: false })
    expect(t.state.draft).toBe('Hi')
    await t.stream('LLM', [' there'])
    expect(messageText(t.state.messages.at(-1))).toBe('Hi there')
  })

  it("coalesce: 'none' requests get one delta per chunk", async () => {
    function C({ state }) { return h('p', null, state.d) }
    C.initialState = { d: '' }
    C.model = { GO: { LLM: () => ({ messages: [], delta: 'D', ok: 'OK', coalesce: 'none' }) }, D: (s, { text }) => ({ d: text }), OK: s => s }
    t = renderComponent(C)
    t.simulateAction('GO')
    await t.stream('LLM', ['a', 'b', 'c'])
    expect(t.actions.filter(a => a.type === 'D').map(a => a.data.text)).toEqual(['a', 'ab', 'abc'])
  })

  it('llmSink names the sink; t.stream on another sink, or on a real driver, throws', async () => {
    function C({ state }) { return h('p', null, state.out ?? '') }
    C.initialState = {}
    C.model = { GO: { AI: () => ({ messages: [], ok: 'OK' }) }, OK: (s, { text }) => ({ out: text }) }
    t = renderComponent(C, { llmSink: 'AI' })
    t.simulateAction('GO')
    await t.stream('AI', ['hey'])
    expect(t.state.out).toBe('hey')
    expect(() => t.stream('HTTP', ['x'])).toThrow(/only the LLM fake streams/)
    expect(() => t.stream('AI', 'x')).toThrow(/chunks must be an array/)
  })
})

describe('the LLM fake: Collection items', () => {
  function Item({ state }) { return h('li', { className: `it i${state.id}` }, h('button', { className: 'go' }, 'go'), h('span', { className: 'out' }, state.out ?? '')) }
  Item.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
  Item.model = {
    GO: { LLM: (s) => ({ messages: [{ role: 'user', content: `summarise ${s.id}` }], key: 'sum', ok: 'DONE' }) },
    DONE: (s, { text }) => ({ ...s, out: text }),
  }
  function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
  List.initialState = { items: [{ id: 1 }, { id: 2 }] }

  it('each item gets its own reply; targets pick by request content', async () => {
    t = renderComponent(List)
    await t.ready()
    t.simulateEvent('.i1 .go', 'click')
    t.simulateEvent('.i2 .go', 'click')
    await t.settle()
    expect(t.requests('LLM').map(r => r.messages[0].content)).toEqual(['summarise 1', 'summarise 2'])
    await t.stream('LLM', ['two'], (r) => r.messages[0].content === 'summarise 2')
    await t.stream('LLM', ['one'], { request: { messages: [{ role: 'user', content: 'summarise 1' }] } })
    expect(t.state.items.map(i => i.out)).toEqual(['one', 'two'])
  })
})
