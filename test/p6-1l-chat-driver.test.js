// @vitest-environment jsdom
// PLAN-6 L-1: makeChatDriver under run() (jsdom) over the in-memory transport: reply actions to
// exactly the sender with the documented data, UIMessage parts (D252), reasoning deltas (D251),
// latest per (sender, key ?? ok ?? error), { abort: key | true } and { abort: true, key } (G-587),
// sender / app dispose mid-stream, isolation, structured output (G-604), and the diagnostics
// SYG610, SYG673, SYG677, SYG678, SYG679.
import { it, expect, beforeEach, afterEach, vi, describe } from 'vitest'
import xs from 'xstream'
import { z } from 'zod'
import run from '../src/extra/run.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { Collection } from '../src/collection.ts'
import { makeChatDriver, chatScopeOf } from '../src/extra/ai/chat/driver.ts'
import { outputJsonSchema } from '../src/extra/ai/chat/output.ts'
import { memoryTransport } from '../src/extra/ai/chat/memoryTransport.ts'
import { messageText } from '../src/extra/ai/messages.ts'
import { configureDiagnostics, getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.ts'
import { setupChecks } from './diagnostics/helpers.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (cond, what) => {
  for (const end = Date.now() + 2000; !cond(); await sleep(2)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
  }
}
const text = sel => document.querySelector(sel)?.textContent
const click = sel => document.querySelector(sel).click()
const logged = code => errorSpy.mock.calls.filter(c => String(c[0]).includes(code))

let app, errorSpy
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  errorSpy.mockRestore()
  configureDiagnostics({ mode: 'off' })
  clearDiagnostics()
})
const start = (App, drivers, opts) => { app = run(App, drivers, { mountPoint: '#root', ...opts }); return app }
// a one-button component whose GO entry sends `request(state)` and whose actions log their data
const oneShot = (request, extra = {}) => {
  const got = []
  function T({ state }) { return h('div', null, h('button', { className: 'go' }, 'go'), h('p', { className: 'out' }, state.out ?? '')) }
  T.initialState = {}
  T.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
  T.model = {
    GO: { LLM: request },
    ...Object.fromEntries(['D', 'OK', 'ERR', 'TOOL'].map(a => [a, (s, d) => { got.push([a, d]); return { ...s, out: a } }])),
    ...extra,
  }
  return { T, got }
}

// One chat; every reply action is logged
const log = []
function Chat({ state }) {
  return h('div', { className: `chat c${state.id ?? 0}` },
    h('button', { className: 'send' }, 'send'),
    h('button', { className: 'send2' }, 'send2'),
    h('button', { className: 'stop' }, 'stop'),
    h('button', { className: 'stopk' }, 'stopk'),
    h('button', { className: 'stopall' }, 'stopall'),
    h('p', { className: 'draft' }, state.draft),
    h('p', { className: 'status' }, state.status),
    h('ol', null, ...state.messages.map(m => h('li', null, messageText(m)))))
}
Chat.initialState = { messages: [], draft: '', status: 'ready', tools: [], n: 0 }
Chat.intent = ({ DOM }) => ({
  SEND: DOM.click('.send'), SEND2: DOM.click('.send2'), STOP: DOM.click('.stop'), STOPK: DOM.click('.stopk'), STOPALL: DOM.click('.stopall'),
})
const req = (s, extra) => ({ messages: [...s.messages, { role: 'user', parts: [{ type: 'text', text: `q${s.n}` }] }], key: 'reply', delta: 'DELTA', ok: 'DONE', error: 'FAILED', tool: 'TOOL', coalesce: 'none', ...extra })
Chat.model = {
  SEND: { STATE: s => ({ ...s, status: 'streaming', n: s.n + 1 }), LLM: s => req(s) },
  SEND2: { LLM: s => req(s, { key: 'side', ok: 'SIDE_DONE' }) },
  STOP: { STATE: s => ({ ...s, status: 'ready' }), LLM: () => ({ abort: 'reply' }) },
  STOPK: { LLM: () => ({ abort: true, key: 'side' }) },
  STOPALL: { LLM: () => ({ abort: true }) },
  DELTA: (s, d) => { log.push(['DELTA', s.id ?? 0, d.text]); return { ...s, draft: d.text } },
  TOOL: (s, d) => { log.push(['TOOL', s.id ?? 0, d.call.name]); return { ...s, tools: [...s.tools, d.call] } },
  DONE: (s, d) => { log.push(['DONE', s.id ?? 0, d.text]); return { ...s, messages: [...s.messages, d.message], draft: '', status: 'ready', ok: d } },
  SIDE_DONE: (s, d) => { log.push(['SIDE_DONE', s.id ?? 0, d.text]); return s },
  FAILED: (s, d) => { log.push(['FAILED', s.id ?? 0, d.error.message]); return { ...s, status: 'error', draft: '', failed: d } },
}

const setup = (App = Chat) => {
  log.length = 0
  const tr = memoryTransport()
  start(App, { LLM: makeChatDriver({ transport: tr }) })
  return tr
}
const ready = sel => until(() => document.querySelector(sel), 'render')

describe('reply actions', () => {
  it('delta / tool / ok reach the sender with the documented data; real UIMessage parts', async () => {
    const tr = setup()
    await ready('.send')
    click('.send')
    await until(() => tr.streams.length === 1, 'the stream')
    const s0 = tr.streams[0]
    expect(s0.request.messages.at(-1).parts[0].text).toBe('q0')   // sinks see the pre-action state
    s0.push({ type: 'start', id: 'm1' }, 'Hel', 'lo')
    await until(() => text('.draft') === 'Hello', 'deltas')
    s0.push({ type: 'reasoning', delta: 'hmm' }, { type: 'tool-call', id: 'c1', name: 'weather', input: { city: 'Hilo' } },
      { type: 'tool-result', id: 'c1', output: { temp: 27 } }, { type: 'data', name: 'source', data: { url: '/x' } },
      { type: 'source-url', sourceId: 's1', url: 'https://a.b' }, { type: 'file', mediaType: 'image/png', url: 'data:,' })
    s0.end({ reason: 'tool-calls', usage: { out: 3 } })
    await until(() => text('.status') === 'ready', 'DONE')
    expect(log).toEqual([['DELTA', 0, 'Hel'], ['DELTA', 0, 'Hello'], ['DELTA', 0, 'Hello'], ['TOOL', 0, 'weather'], ['DONE', 0, 'Hello']])
    const st = app.__runtime.getState()
    expect(st.messages[0]).toEqual({ id: 'm1', role: 'assistant', parts: [
      { type: 'text', text: 'Hello' }, { type: 'reasoning', text: 'hmm' },
      { type: 'tool-weather', toolCallId: 'c1', state: 'output-available', input: { city: 'Hilo' }, output: { temp: 27 } },
      { type: 'data-source', data: { url: '/x' } },
      { type: 'source-url', sourceId: 's1', url: 'https://a.b' },
      { type: 'file', mediaType: 'image/png', url: 'data:,' }] })
    expect(st.tools).toEqual([{ id: 'c1', name: 'weather', input: { city: 'Hilo' } }])
    expect(st.ok).toMatchObject({ key: 'reply', text: 'Hello', finishReason: 'tool-calls', usage: { out: 3 }, toolCalls: [{ id: 'c1', name: 'weather', input: { city: 'Hilo' } }] })
    expect('value' in st.ok).toBe(false)
    expect(text('ol')).toBe('Hello')
  })

  it('delta data: { key, text, reasoning, delta, message }; reasoning fires a delta too (D251), delta is only the new text', async () => {
    const { T, got } = oneShot(() => ({ messages: [], delta: 'D', ok: 'OK', coalesce: 'none' }))
    const tr = memoryTransport()
    start(T, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.go')
    click('.go')
    await until(() => tr.streams.length === 1, 'stream')
    tr.streams[0].push({ type: 'reasoning', delta: 'think' }, 'A', 'B').end()
    await until(() => got.some(g => g[0] === 'OK'), 'ok')
    const ds = got.filter(g => g[0] === 'D').map(g => g[1])
    expect(ds.map(d => [d.text, d.reasoning, d.delta])).toEqual([['', 'think', ''], ['A', 'think', 'A'], ['AB', 'think', 'B']])
    expect(ds[0]).toMatchObject({ key: 'OK', message: { role: 'assistant', parts: [{ type: 'reasoning', text: 'think' }] } })
    // each delta's message is a snapshot: later growth doesn't change it
    expect(ds[1].message.parts).toEqual([{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'A' }])
    expect(got.find(g => g[0] === 'OK')[1]).toMatchObject({ key: 'OK', text: 'AB', finishReason: 'stop', toolCalls: [] })
  })

  it('a data part with the id of an earlier one replaces it; a tool-error completes the tool part', async () => {
    const { T, got } = oneShot(() => ({ messages: [], ok: 'OK' }))
    const tr = memoryTransport()
    start(T, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.go')
    click('.go')
    await until(() => tr.streams.length === 1, 'stream')
    tr.streams[0].push({ type: 'data-progress', id: 'p', data: 1 }, { type: 'tool-call', name: 'look' }, { type: 'data', name: 'progress', id: 'p', data: 2 },
      { type: 'tool-error', id: 'call_1', error: 'nope' }).end()
    await until(() => got.length, 'ok')
    expect(got[0][1].message.parts).toEqual([
      { type: 'data-progress', id: 'p', data: 2 },
      { type: 'tool-look', toolCallId: 'call_1', state: 'output-error', input: {}, errorText: 'nope' }])
    expect(got[0][1].finishReason).toBe('tool-calls')
  })

  it('error: { key, error, request }', async () => {
    const tr = setup()
    await ready('.send')
    click('.send')
    await until(() => tr.streams.length === 1, 'the stream')
    tr.streams[0].push('par').fail(new Error('boom'))
    await until(() => text('.status') === 'error', 'FAILED')
    const { failed } = app.__runtime.getState()
    expect(failed.key).toBe('reply')
    expect(failed.error.message).toBe('boom')
    expect(failed.request.ok).toBe('DONE')
    expect('issues' in failed).toBe(false)
  })

  it('a transport whose stream() throws fails the request', async () => {
    log.length = 0
    start(Chat, { LLM: makeChatDriver({ transport: { stream: () => { throw new Error('no key') } } }) })
    await ready('.send')
    click('.send')
    await until(() => text('.status') === 'error', 'FAILED')
    expect(log).toEqual([['FAILED', 0, 'no key']])
  })
})

describe('diagnostics', () => {
  it('SYG610: a request with a then key is refused', async () => {
    const tr = memoryTransport()
    const { T } = oneShot(() => ({ messages: [], ok: 'OK', then: () => {} }))
    start(T, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.go')
    click('.go')
    await sleep(10)
    expect(tr.streams.length).toBe(0)
    expect(logged('SYG610').length).toBe(1)
  })

  it('SYG679: no messages, a bad coalesce, an output that is not a Standard Schema, a non-object: not sent', async () => {
    const tr = memoryTransport()
    let i = 0
    const bad = [{ ok: 'OK' }, { messages: [], ok: 'OK', coalesce: 'fast' }, { messages: [], ok: 'OK', output: { type: 'object' } }, 'hello']
    const { T } = oneShot(() => bad[i++])
    start(T, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.go')
    for (const _ of bad) { click('.go'); await sleep(5) }
    expect(tr.streams.length).toBe(0)
    const msgs = logged('SYG679').map(c => String(c[0]))
    expect(msgs.length).toBe(4)
    expect(msgs[0]).toMatch(/no messages array/)
    expect(msgs[1]).toMatch(/coalesce is not frame, none or ms/)
    expect(msgs[2]).toMatch(/output is not a Standard Schema/)
    expect(msgs[3]).toMatch(/not sent: not an object/)
  })

  it('SYG678: a failure with no error action is logged (also with diagnostics off)', async () => {
    const tr = memoryTransport()
    const { T, got } = oneShot(() => ({ messages: [], key: 'sum', ok: 'OK' }))
    start(T, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.go')
    click('.go')
    await until(() => tr.streams.length === 1, 'stream')
    tr.streams[0].fail(new Error('rate limited'))
    await until(() => logged('SYG678').length, 'SYG678')
    expect(String(logged('SYG678')[0][0])).toMatch(/request 'sum' failed with no error action/)
    expect(logged('SYG678')[0][1].message).toBe('rate limited')
    expect(got).toEqual([])
  })

  it('an aborted stream is not a failure: nothing logged', async () => {
    const tr = memoryTransport()
    const { T } = oneShot(() => ({ messages: [], ok: 'OK' }))
    start(T, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.go')
    click('.go'); click('.go')
    await until(() => tr.streams.length === 2, 'both')
    app.dispose(); app = null
    await sleep(10)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('SYG677 (dev): a request from outside a component is dropped', async () => {
    setupChecks()
    const tr = memoryTransport()
    const sink$ = xs.create()
    const src = makeChatDriver({ transport: tr })(sink$)
    sink$.shamefullySendNext({ messages: [], ok: 'OK' })
    expect(tr.streams.length).toBe(0)
    expect(getDiagnostics().map(d => d.code)).toEqual(['SYG677'])
    expect(getDiagnostics()[0].message).toMatch(/outside a component/)
    src.dispose()
  })

  it('SYG673 (dev): malformed events are skipped; unknown types are ignored silently', async () => {
    setupChecks()
    const tr = memoryTransport()
    const { T, got } = oneShot(() => ({ messages: [], ok: 'OK' }))
    start(T, { LLM: makeChatDriver({ transport: tr }) }, { diagnostics: 'collect' })
    await ready('.go')
    click('.go')
    await until(() => tr.streams.length === 1, 'stream')
    tr.streams[0].push('a', 42, { type: 'text', delta: 3 }, { type: 'tool-call', input: {} }, { type: 'tool-result', id: 'x' },
      { type: 'response.weird' }, 'b').end()
    await until(() => got.length, 'ok')
    expect(got[0][1].text).toBe('ab')
    const found = getDiagnostics().filter(d => d.code === 'SYG673')
    expect(found.map(d => d.data.reason)).toEqual(['type', 'delta', 'name', 'id'])
    expect(found[2].message).toMatch(/'tool-call' event \(a tool call with no tool name\)/)
    expect(found[0].component).toBe('T')
  })

  it('makeChatDriver without a transport throws', () => {
    expect(() => makeChatDriver({})).toThrow(/transport/)
  })
})

describe('latest and abort', () => {
  it('latest (default): a second SEND under the same key aborts the first; nothing of it arrives', async () => {
    const tr = setup()
    await ready('.send')
    click('.send')
    await until(() => tr.streams.length === 1, 'first')
    tr.streams[0].push('one')
    await until(() => text('.draft') === 'one', 'first delta')
    click('.send')
    await until(() => tr.streams.length === 2, 'second')
    expect(tr.streams[0].signal.aborted).toBe(true)
    tr.streams[0].push('LATE').end()           // ignored: not live
    tr.streams[1].push('two').end()
    await until(() => log.some(l => l[0] === 'DONE'), 'DONE')
    await sleep(10)
    expect(log).toEqual([['DELTA', 0, 'one'], ['DELTA', 0, 'two'], ['DONE', 0, 'two']])
  })

  it('another key runs alongside; { abort: key }, { abort: true, key } and { abort: true }', async () => {
    const tr = setup()
    await ready('.send')
    click('.send'); click('.send2')
    await until(() => tr.streams.length === 2, 'both')
    expect(tr.streams.map(s => s.signal.aborted)).toEqual([false, false])
    click('.stop')                                          // { abort: 'reply' }
    await until(() => tr.streams[0].signal.aborted, 'abort reply')
    expect(tr.streams[1].signal.aborted).toBe(false)
    click('.stopk')                                         // { abort: true, key: 'side' }
    await until(() => tr.streams[1].signal.aborted, 'abort side')
    click('.send'); click('.send2')
    await until(() => tr.streams.length === 4, 'again')
    click('.stopall')                                       // { abort: true }
    await until(() => tr.streams[2].signal.aborted && tr.streams[3].signal.aborted, 'abort all')
    tr.streams.forEach(s => s.push('y').end())
    await sleep(10)
    expect(log).toEqual([])
  })

  it('latest: false keeps both (replies in completion order)', async () => {
    const tr = memoryTransport()
    const { T, got } = oneShot(() => ({ messages: [], ok: 'OK', latest: false }))
    start(T, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.go')
    click('.go'); click('.go')
    await until(() => tr.streams.length === 2, 'both')
    tr.streams[1].push('b').end(); tr.streams[0].push('a').end()
    await until(() => got.length === 2, 'both ok')
    expect(got.map(g => g[1].text)).toEqual(['b', 'a'])
  })

  it('the key is key ?? ok ?? error: requests with another ok run alongside', async () => {
    const tr = memoryTransport()
    let i = 0
    const { T } = oneShot(() => ({ messages: [], ok: i++ ? 'OK' : 'D' }))
    start(T, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.go')
    click('.go'); click('.go')
    await until(() => tr.streams.length === 2, 'both')
    expect(tr.streams.map(s => s.signal.aborted)).toEqual([false, false])
  })

  it('a coalesced delta already scheduled is dropped when the run is aborted', async () => {
    const tr = memoryTransport()
    const { T, got } = oneShot(() => ({ messages: [], key: 'k', delta: 'D', ok: 'OK', coalesce: 50 }), { STOP: { LLM: () => ({ abort: 'k' }) } })
    start(T, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.go')
    click('.go')
    await until(() => tr.streams.length === 1, 'stream')
    tr.streams[0].push('abc')
    await sleep(5)
    app.__runtime.dispatch('root', 'STOP')
    await until(() => tr.streams[0].signal.aborted, 'aborted')
    await sleep(80)
    expect(got).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('coalesce: a number (ms) gives one delta per window; ok flushes the pending one first', async () => {
    const tr = memoryTransport()
    const { T, got } = oneShot(() => ({ messages: [], delta: 'D', ok: 'OK', coalesce: 30 }))
    start(T, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.go')
    click('.go')
    await until(() => tr.streams.length === 1, 'stream')
    tr.streams[0].push('a', 'b', 'c')
    await sleep(60)
    tr.streams[0].push('d').end()
    await until(() => got.some(g => g[0] === 'OK'), 'ok')
    expect(got.map(g => [g[0], g[1].text])).toEqual([['D', 'abc'], ['D', 'abcd'], ['OK', 'abcd']])
  })
})

// Collection items: same component, same key; each gets only its own replies
function List() {
  return h('div', null, h('button', { className: 'drop' }, 'drop'), h('ul', null, h(Collection, { of: Chat, from: 'items' })))
}
List.initialState = { items: [{ ...Chat.initialState, id: 1 }, { ...Chat.initialState, id: 2 }] }
List.intent = ({ DOM }) => ({ DROP: DOM.click('.drop') })
List.model = { DROP: s => ({ ...s, items: s.items.slice(1) }) }

describe('isolation and dispose', () => {
  it('Collection items: same key, each stream reaches only its sender; latest/abort are per sender', async () => {
    const tr = setup(List)
    await until(() => document.querySelectorAll('.send').length === 2, 'render')
    click('.c1 .send'); click('.c2 .send')
    await until(() => tr.streams.length === 2, 'both')
    expect(tr.streams.map(s => s.signal.aborted)).toEqual([false, false])     // latest is per sender
    // the requests carry their scope (isolateValue), as makeFetchDriver's do
    expect(chatScopeOf(tr.streams[0].request).length).toBeGreaterThan(0)
    expect(chatScopeOf(tr.streams[0].request)).not.toEqual(chatScopeOf(tr.streams[1].request))
    tr.streams[1].push('two')
    tr.streams[0].push('one')
    await until(() => text('.c1 .draft') === 'one' && text('.c2 .draft') === 'two', 'drafts')
    click('.c1 .stop')
    await until(() => tr.streams[0].signal.aborted, 'item 1 aborted')
    expect(tr.streams[1].signal.aborted).toBe(false)
    tr.streams[1].end()
    await until(() => text('.c2 .status') === 'ready', 'item 2 done')
    expect(log.filter(l => l[0] === 'DONE')).toEqual([['DONE', 2, 'two']])
  })

  it('a removed item mid-stream: its stream is aborted at once, nothing delivered', async () => {
    const tr = setup(List)
    await until(() => document.querySelectorAll('.send').length === 2, 'render')
    click('.c1 .send')
    await until(() => tr.streams.length === 1, 'stream')
    tr.streams[0].push('par')
    await until(() => text('.c1 .draft') === 'par', 'delta')
    click('.drop')
    await until(() => document.querySelectorAll('.send').length === 1, 'removed')
    expect(tr.streams[0].signal.aborted).toBe(true)
    tr.streams[0].push('LATE').end()
    await sleep(20)
    expect(log).toEqual([['DELTA', 1, 'par']])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('app.dispose() mid-stream aborts every stream synchronously', async () => {
    const tr = setup(List)
    await until(() => document.querySelectorAll('.send').length === 2, 'render')
    click('.c1 .send'); click('.c2 .send2')
    await until(() => tr.streams.length === 2, 'both')
    app.dispose(); app = null
    expect(tr.streams.map(s => s.signal.aborted)).toEqual([true, true])
    tr.streams.forEach(s => s.push('late').end())
    await sleep(20)
    expect(log).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('a sub-component (default isolation) with the same action names: replies stay with each', async () => {
    const tr = memoryTransport()
    function Child({ state }) { return h('span', { className: 'child' }, h('button', { className: 'cgo' }, 'c'), h('i', { className: 'cv' }, state.v ?? '')) }
    Child.intent = ({ DOM }) => ({ GO: DOM.click('.cgo') })
    Child.model = { GO: { LLM: () => ({ messages: [], ok: 'OK' }) }, OK: (s, d) => ({ ...s, v: 'child:' + d.text }) }
    function Parent({ state }) { return h('div', null, h('button', { className: 'pgo' }, 'p'), h('b', { className: 'pv' }, state.v ?? ''), h(Child, { state: 'kid' })) }
    Parent.initialState = { kid: {} }
    Parent.intent = ({ DOM }) => ({ GO: DOM.click('.pgo') })
    Parent.model = { GO: { LLM: () => ({ messages: [], ok: 'OK' }) }, OK: (s, d) => ({ ...s, v: 'parent:' + d.text }) }
    start(Parent, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.cgo')
    click('.cgo'); click('.pgo')
    await until(() => tr.streams.length === 2, 'both')
    tr.streams[0].push('A').end(); tr.streams[1].push('B').end()
    await until(() => text('.cv') && text('.pv'), 'both')
    expect([text('.cv'), text('.pv')]).toEqual(['child:A', 'parent:B'])
  })
})

describe('structured output (G-604)', () => {
  const Todo = z.object({ title: z.string().min(1), done: z.boolean() })

  it('ok gets the validated value; the transport can read the JSON Schema', async () => {
    const tr = memoryTransport()
    const { T, got } = oneShot(() => ({ messages: [], output: Todo, ok: 'OK', error: 'ERR' }))
    start(T, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.go')
    click('.go')
    await until(() => tr.streams.length === 1, 'stream')
    expect(outputJsonSchema(tr.streams[0].request.output)).toEqual({
      wrapped: false,
      schema: { type: 'object', properties: { title: { type: 'string', minLength: 1 }, done: { type: 'boolean' } }, required: ['title', 'done'] },
    })
    tr.streams[0].push('```json\n{"title":', '"Buy milk","done":false}\n```').end()
    await until(() => got.length, 'ok')
    expect(got[0][0]).toBe('OK')
    expect(got[0][1].value).toEqual({ title: 'Buy milk', done: false })
  })

  it('a value that fails the schema, or text that is not JSON, is the error reply with issues', async () => {
    const tr = memoryTransport()
    const { T, got } = oneShot(() => ({ messages: [], output: Todo, ok: 'OK', error: 'ERR' }))
    start(T, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.go')
    click('.go')
    await until(() => tr.streams.length === 1, 'stream')
    tr.streams[0].push('{"title":"","done":"no"}').end()
    await until(() => got.length === 1, 'err 1')
    click('.go')
    await until(() => tr.streams.length === 2, 'stream 2')
    tr.streams[1].push('Sure! Here it is').end()
    await until(() => got.length === 2, 'err 2')
    expect(got.map(g => g[0])).toEqual(['ERR', 'ERR'])
    expect(got[0][1].issues.map(i => i.path[0])).toEqual(['title', 'done'])
    expect(got[0][1].error.name).toBe('ValidationError')
    expect(got[1][1].error.message).toMatch(/not JSON: Sure! Here it is/)
    expect(got[1][1].issues.length).toBe(1)
  })

  it('a non-object schema is wrapped as { value }; the reply is unwrapped (a bare value accepted too)', async () => {
    const Tags = z.array(z.string())
    expect(outputJsonSchema(Tags)).toEqual({ wrapped: true, schema: { type: 'object', properties: { value: { type: 'array', items: { type: 'string' } } }, required: ['value'], additionalProperties: false } })
    const tr = memoryTransport()
    const { T, got } = oneShot(() => ({ messages: [], output: Tags, ok: 'OK', error: 'ERR' }))
    start(T, { LLM: makeChatDriver({ transport: tr }) })
    await ready('.go')
    click('.go')
    await until(() => tr.streams.length === 1, 'stream')
    tr.streams[0].push('{"value":["a","b"]}').end()
    await until(() => got.length === 1, 'ok 1')
    click('.go')
    await until(() => tr.streams.length === 2, 'stream 2')
    tr.streams[1].push('["c"]').end()
    await until(() => got.length === 2, 'ok 2')
    expect(got.map(g => g[1].value)).toEqual([['a', 'b'], ['c']])
  })

  it('outputJsonSchema: undefined for a schema with no JSON Schema form', () => {
    expect(outputJsonSchema(undefined)).toBe(undefined)
    expect(outputJsonSchema({ '~standard': { validate: v => ({ value: v }) } })).toBe(undefined)
    expect(outputJsonSchema({ '~standard': { validate: v => ({ value: v }), jsonSchema: { input: () => { throw new Error('date') } } } })).toBe(undefined)
  })
})
