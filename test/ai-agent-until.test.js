// @vitest-environment jsdom
// agent action `until` (sygnal/ai, src/extra/ai/agent/index.ts): the call answers once the
// action's result is in state. `until: 'resource'` (neither loading nor refreshing) or a
// function; `timeout` → { ok, pending, note, state }; cancel() / stop(); the chat behavior cancels
// on STOP and on a new turn. SYG248 (no such resource), SYG241 (until threw). With the real
// makeFetchDriver too: 'loading' is written in the action's own flush, so a call never answers
// with the previous request's result.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { z } from 'zod'
import run from '../src/extra/run.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { agentTools } from '../src/index.js'
import { chat } from '../src/extra/ai/chat/behavior.ts'
import { messageText } from '../src/extra/ai/messages.ts'

let t, app
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  try { app?.dispose() } catch (_) {}
  t = app = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

/** resolves when the promise settles; `settled()` says whether it has */
const track = (p) => { const r = { done: false, value: undefined }; r.p = p.then((v) => { r.done = true; r.value = v; return v }); return r }

function shop(until = 'search', request = (q) => ({ url: '/api/search', query: { q } })) {
  function Shop({ state }) { return h('p', null, state.search.status) }
  Shop.initialState = { query: '' }
  Shop.resources = { search: (state) => state.query && request(state.query) }
  Shop.model = { SEARCH: (state, query) => ({ ...state, query }), REFRESH: { HTTP: () => ({ refresh: 'search' }) } }
  Shop.agent = {
    name: 'shop',
    read: (state) => ({ query: state.query, status: state.search.status, results: state.search.data ?? [] }),
    actions: {
      SEARCH: { description: 'Search the catalog; the results show on the page', input: z.string().min(1), until },
      REFRESH: { description: 'Load the results again', until },
    },
  }
  return Shop
}

describe("until: 'resource'", () => {
  it('the call answers once the reply is in state, with the read', async () => {
    t = renderComponent(shop(), { strict: true })
    await t.ready()
    const call = track(t.callTool('shop_search', { value: 'shoes' }))
    await t.settle()
    expect(call.done).toBe(false)
    expect(t.state.search.status).toBe('loading')
    await t.respond('HTTP', ['Red shoe', 'Blue shoe'])
    expect(await call.p).toEqual({ ok: true, state: { query: 'shoes', status: 'success', results: ['Red shoe', 'Blue shoe'] } })
    t.expectNoDiagnostics()
  })

  it('a second search waits for its own reply, not the first one\'s success', async () => {
    t = renderComponent(shop())
    await t.ready()
    const first = t.callTool('shop_search', { value: 'shoes' })
    await t.settle()
    await t.respond('HTTP', ['Red shoe'])
    await first
    const second = track(t.callTool('shop_search', { value: 'hats' }))
    await t.settle()
    expect(second.done).toBe(false)
    await t.respond('HTTP', ['Top hat'])
    expect((await second.p).state.results).toEqual(['Top hat'])
  })

  it('keepPrevious and a refetch keep the status but set refreshing: the call still waits', async () => {
    t = renderComponent(shop('search', (q) => ({ url: '/api/search', query: { q }, keepPrevious: true })))
    await t.ready()
    const first = t.callTool('shop_search', { value: 'shoes' })
    await t.settle()
    await t.respond('HTTP', ['Red shoe'])
    await first
    const second = track(t.callTool('shop_search', { value: 'hats' }))
    await t.settle()
    expect(t.state.search).toMatchObject({ status: 'success', refreshing: true })
    expect(second.done).toBe(false)
    await t.respond('HTTP', ['Top hat'])
    expect((await second.p).state.results).toEqual(['Top hat'])
    const again = track(t.callTool('shop_refresh'))
    await t.settle()
    expect(again.done).toBe(false)
    await t.respond('HTTP', ['Top hat', 'Cap'])
    expect((await again.p).state.results).toEqual(['Top hat', 'Cap'])
  })

  it('a failed request answers too: the error status is in the read', async () => {
    t = renderComponent(shop())
    await t.ready()
    const call = t.callTool('shop_search', { value: 'shoes' })
    await t.settle()
    await t.fail('HTTP', 500)
    expect(await call).toMatchObject({ ok: true, state: { status: 'error' } })
  })

  it('SYG248: a name that is not one of the component\'s resources: the call answers at once', async () => {
    t = renderComponent(shop('serch'))
    await t.ready()
    expect(await t.callTool('shop_search', { value: 'shoes' })).toEqual({ ok: true, state: { query: 'shoes', status: 'loading', results: [] } })
    expect(t.diagnostics.map((d) => [d.code, d.severity])).toEqual([['SYG248', 'warn']])
    expect(t.diagnostics[0].message).toContain("names 'serch', which is not one of Shop's resources (search)")
  })

  it('with run() and the real makeFetchDriver', async () => {
    const pending = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => pending.push(resolve))))
    const reply = (body) => pending.shift()(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }))
    document.body.innerHTML = '<div id="root"></div>'
    app = run(shop(), { HTTP: makeFetchDriver() }, { mountPoint: '#root', diagnostics: 'off' })
    await app.__runtime.flushed()
    const layer = agentTools(app)
    const first = track(layer.call('shop_search', 'shoes'))
    await new Promise((r) => setTimeout(r, 20))
    expect(first.done).toBe(false)
    reply(['Red shoe'])
    expect(await first.p).toEqual({ ok: true, state: { query: 'shoes', status: 'success', results: ['Red shoe'] } })
    const second = track(layer.call('shop_search', 'hats'))
    await new Promise((r) => setTimeout(r, 20))
    expect(second.done).toBe(false)
    reply(['Top hat'])
    expect((await second.p).state.results).toEqual(['Top hat'])
    layer.stop()
  })
})

describe('until: a function', () => {
  function Weather({ state }) { return h('p', null, state.forecast ? state.forecast.sky : state.status) }
  Weather.initialState = { status: 'idle', forecast: null }
  Weather.model = {
    LOOK_UP: { STATE: (s) => ({ ...s, status: 'loading' }), HTTP: (s, city) => ({ url: `/api/weather/${city}`, ok: 'FORECAST', error: 'NO_FORECAST' }) },
    FORECAST: (s, data) => ({ ...s, status: 'ready', forecast: data }),
    NO_FORECAST: (s) => ({ ...s, status: 'failed' }),
  }
  Weather.agent = {
    name: 'weather', read: (s) => ({ status: s.status, forecast: s.forecast }),
    actions: { LOOK_UP: { description: 'Show the forecast for a city', input: z.string(), until: (s) => s.status !== 'loading', timeout: 5000 } },
  }

  it('a reply action: the call answers when the predicate holds', async () => {
    t = renderComponent(Weather, { strict: true })
    await t.ready()
    const call = track(t.callTool('weather_look_up', { value: 'Oslo' }))
    await t.settle()
    expect(call.done).toBe(false)
    await t.respond('HTTP', { sky: 'sunny' })
    expect(await call.p).toEqual({ ok: true, state: { status: 'ready', forecast: { sky: 'sunny' } } })
  })

  it('timeout: { ok, pending, note, state } (fake timers)', async () => {
    vi.useFakeTimers()
    t = renderComponent(Weather)
    await t.ready()
    const call = track(t.callTool('weather_look_up', { value: 'Oslo' }))
    await vi.advanceTimersByTimeAsync(4999)
    expect(call.done).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(await call.p).toEqual({ ok: true, pending: true, note: 'weather_look_up is still in progress: its result will be in the app state later', state: { status: 'loading', forecast: null } })
  })

  it('SYG241: a throwing until ends the wait', async () => {
    function C({ state }) { return h('p', null, String(state.n)) }
    C.initialState = { n: 0 }
    C.model = { BUMP: (s) => ({ ...s, n: s.n + 1 }) }
    C.agent = { name: 'c', read: (s) => s.n, actions: { BUMP: { description: 'Bump', until: () => { throw new Error('nope') } } } }
    t = renderComponent(C)
    await t.ready()
    expect(await t.callTool('c_bump')).toEqual({ ok: true, state: 1 })
    expect(t.diagnostics.map((d) => d.code)).toEqual(['SYG241'])
  })

  it('a call that already holds after the action answers at once; a refused one never waits', async () => {
    function C({ state }) { return h('p', null, String(state.n)) }
    C.initialState = { n: 0 }
    C.model = { BUMP: (s) => (s.n >= 1 ? undefined : { ...s, n: s.n + 1 }) }
    C.agent = { name: 'c', read: (s) => s.n, actions: { BUMP: { description: 'Bump', until: (s) => s.n > 0 } } }
    t = renderComponent(C)
    await t.ready()
    expect(await t.callTool('c_bump')).toEqual({ ok: true, state: 1 })
  })
})

describe('cancel, stop, removed', () => {
  it('agentTools on run(): cancel() and stop() answer waiting calls as pending', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    document.body.innerHTML = '<div id="root"></div>'
    app = run(shop(), { HTTP: makeFetchDriver() }, { mountPoint: '#root', diagnostics: 'off' })
    await app.__runtime.flushed()
    const layer = agentTools(app)
    const a = layer.call('shop_search', 'shoes')
    await new Promise((r) => setTimeout(r, 10))
    layer.cancel()
    expect(await a).toMatchObject({ ok: true, pending: true, state: { status: 'loading' } })
    // the cancelled call no longer blocks the serial queue
    const b = layer.call('shop_search', 'hats')
    await new Promise((r) => setTimeout(r, 10))
    layer.stop()
    expect(await b).toMatchObject({ ok: true, pending: true })
  })

  it('an item that removes itself while its call waits: { ok, removed }', async () => {
    function Row({ state }) { return h('li', null, state.name) }
    Row.model = { ARCHIVE: { STATE: (s) => ({ ...s, archiving: true }), HTTP: (s) => ({ url: `/api/archive/${s.id}`, ok: 'ARCHIVED' }) }, ARCHIVED: () => undefined }
    Row.agent = { name: 'row', actions: { ARCHIVE: { description: 'Archive the row', until: (s) => !s.archiving } } }
    function List({ state }) { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { rows: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }
    List.agent = { name: 'list', read: (s) => ({ ids: s.rows.map((r) => r.id) }) }
    t = renderComponent(List)
    await t.ready()
    const call = track(t.callTool('row_archive', { id: 'a' }))
    await t.settle()
    expect(call.done).toBe(false)
    await t.respond('HTTP', { ok: true })
    expect(await call.p).toEqual({ ok: true, removed: true, state: { ids: ['b'] } })
  })
})

describe('through the chat behavior', () => {
  const Shop = shop()
  function App(props) {
    const c = props.state.assistant
    return h('main', null, Shop(props),
      h('ol', null, ...c.messages.map((m) => h('li', null, messageText(m)))),
      h('form', { className: 'ask' }, h('input', { className: 'prompt', value: c.prompt }), h('button', { type: 'button', className: 'stop' }, 'Stop')))
  }
  App.initialState = Shop.initialState
  App.resources = Shop.resources
  App.model = Shop.model
  App.agent = Shop.agent
  App.uses = { assistant: chat({ form: '.ask', prompt: '.prompt', stop: '.stop' }) }
  const ask = async (text) => {
    t.simulateEvent('.prompt', 'input', { value: text })
    t.simulateEvent('.ask', 'submit')
    await t.settle()
  }

  it('the next request waits for the search, and carries its results as the tool output', async () => {
    t = renderComponent(App)
    await t.ready()
    await ask('find shoes')
    await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'shop_search', input: { value: 'shoes' } } }])
    await t.settle()
    expect(t.requests('LLM')).toHaveLength(1)
    expect(t.state.assistant.status).toBe('streaming')
    await t.respond('HTTP', ['Red shoe', 'Blue shoe'])
    await t.settle()
    const part = t.requests('LLM').at(-1).messages.at(-1).parts.find((p) => p.type === 'tool-shop_search')
    expect(part).toMatchObject({ state: 'output-available', output: { ok: true, state: { status: 'success', results: ['Red shoe', 'Blue shoe'] } } })
  })

  it('STOP while a search waits: the call answers pending, the part has no stale errorText, the next turn runs', async () => {
    t = renderComponent(App)
    await t.ready()
    await ask('find shoes')
    await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'shop_search', input: { value: 'shoes' } } }])
    await t.settle()
    t.simulateEvent('.stop', 'click')
    await t.settle()
    await t.settle()
    expect(t.state.assistant.status).toBe('ready')
    const part = t.state.assistant.messages.at(-1).parts.find((p) => p.type === 'tool-shop_search')
    expect(part).toMatchObject({ state: 'output-available', output: { ok: true, pending: true } })
    expect(part).not.toHaveProperty('errorText')
    await ask('and hats?')
    expect(t.requests('LLM')).toHaveLength(2)
    await t.stream('LLM', [{ toolCall: { id: 'c2', name: 'shop_search', input: { value: 'hats' } } }])
    await t.settle()
    // the shoes request was replaced (latest): the hats reply ends the new call's wait
    await t.respond('HTTP', ['Top hat'])
    await t.settle()
    expect(t.requests('LLM')).toHaveLength(3)
    expect(t.requests('LLM').at(-1).messages.at(-1).parts.find((p) => p.type === 'tool-shop_search').output.state.results).toEqual(['Top hat'])
  })
})
