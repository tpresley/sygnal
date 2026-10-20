// @vitest-environment jsdom
// PLAN-13 S-1 (#41, #42, #28): SSE `meta` (event ids and types), `resume` (the last id after a
// reconnect the driver makes: a URL parameter for EventSource, Last-Event-ID over fetch) and
// `staleAfterMs` (a silent connection is a drop; heartbeat comments count over fetch), for SSE
// and WebSocket, at the driver and through renderComponent's socket fake.
import { describe, it, expect, vi, afterEach } from 'vitest'
import xs from 'xstream'
import { makeSocketDriver } from '../src/extra/socketDriver.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function eventSources() {
  const sources = []
  class FakeEventSource {
    constructor(url, init) { this.url = url; this.init = init; this.readyState = 0; this.listeners = {}; this.lastEventId = ''; sources.push(this) }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
    close() { this.readyState = 2; this.closed = true }
    accept() { this.readyState = 1; this.onopen?.({ type: 'open' }) }
    emit(data, { type = 'message', id } = {}) {
      if (id != null) this.lastEventId = String(id)
      const ev = { type, data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId: this.lastEventId }
      if (type === 'message') this.onmessage?.(ev)
      ;(this.listeners[type] || []).forEach(f => f(ev))
    }
    fail(fatal = false) { this.readyState = fatal ? 2 : 0; this.onerror?.({ type: 'error' }) }
  }
  return { FakeEventSource, sources }
}
function webSockets() {
  const sockets = []
  class FakeWebSocket {
    constructor(url) { this.url = url; this.readyState = 0; sockets.push(this) }
    send() {}
    close() { this.readyState = 3; this.closed = true }
    accept() { this.readyState = 1; this.onopen?.({ type: 'open' }) }
    receive(d) { this.onmessage?.({ type: 'message', data: JSON.stringify(d) }) }
  }
  return { FakeWebSocket, sockets }
}

function drive(opts) {
  const sink = xs.create()
  const src = makeSocketDriver({ reconnect: { delayMs: 100, maxDelayMs: 100, jitter: false }, ...opts })(sink)
  const list = []
  src.replies(1).addListener({ next: a => list.push([a.type, a.data]), error() {}, complete() {} })
  const declare = (connections) => sink.shamefullySendNext(Object.defineProperties({ connections }, { __emitterId: { value: 1 }, __emitterName: { value: 'Feed' } }))
  return { src, list, declare }
}
const feed = (more = {}) => ({ sse: '/events', message: 'MSG', open: 'OPEN', close: 'CLOSED', events: { price: 'PRICE' }, ...more })

describe('SSE meta', () => {
  it('meta: true gives { data, id, event } for messages and named events', () => {
    const es = eventSources(), d = drive({ EventSource: es.FakeEventSource })
    d.declare({ feed: feed({ meta: true }) })
    const s = es.sources[0]
    s.accept()
    s.emit({ n: 1 }, { id: 7 })
    s.emit({ p: 2 }, { type: 'price' })
    expect(d.list.slice(1)).toEqual([
      ['MSG', { data: { n: 1 }, id: '7', event: 'message' }],
      ['PRICE', { data: { p: 2 }, id: '7', event: 'price' }],   // lastEventId carries over
    ])
  })
  it('without meta the actions get the data alone', () => {
    const es = eventSources(), d = drive({ EventSource: es.FakeEventSource })
    d.declare({ feed: feed() })
    es.sources[0].accept()
    es.sources[0].emit({ n: 1 }, { id: 7 })
    expect(d.list.at(-1)).toEqual(['MSG', { n: 1 }])
  })
})

describe('SSE resume', () => {
  const reconnect = (spec, url = '/events') => {
    vi.useFakeTimers()
    const es = eventSources(), d = drive({ EventSource: es.FakeEventSource })
    d.declare({ feed: feed({ sse: url, ...spec }) })
    es.sources[0].accept()
    es.sources[0].emit('a', { id: 'e-41' })
    es.sources[0].fail(true)          // EventSource gave up (a proxy 502)
    vi.advanceTimersByTime(100)
    return es.sources
  }
  it('resume: true adds ?lastEventId= to the reconnect URL (and lastEventId to the init)', () => {
    const [, again] = reconnect({ resume: true })
    expect(again.url).toBe('/events?lastEventId=e-41')
    expect(again.init.lastEventId).toBe('e-41')
  })
  it("resume: 'cursor' names the parameter, after the URL's own query", () => {
    expect(reconnect({ resume: 'cursor' }, '/events?room=a')[1].url).toBe('/events?room=a&cursor=e-41')
  })
  it('no resume, or no id seen yet: the URL as declared', () => {
    expect(reconnect({})[1].url).toBe('/events')
    vi.useFakeTimers()
    const es = eventSources(), d = drive({ EventSource: es.FakeEventSource })
    d.declare({ feed: feed({ resume: true }) })
    es.sources[0].accept()
    es.sources[0].fail(true)
    vi.advanceTimersByTime(100)
    expect(es.sources[1].url).toBe('/events')
  })

  for (const resume of [true, undefined]) {
    it(`over fetch (headers): the driver's reconnect after a 502 ${resume ? 'sends' : 'without resume does not send'} Last-Event-ID`, async () => {
      const enc = new TextEncoder(), calls = []
      vi.stubGlobal('fetch', vi.fn((url, init) => {
        const call = { url, init }
        calls.push(call)
        // the second attempt meets a proxy 502: FetchEventSource gives up (CLOSED)
        if (calls.length === 2) return Promise.resolve(new Response('bad gateway', { status: 502 }))
        const body = new ReadableStream({ start: c => { call.send = (t) => c.enqueue(enc.encode(t)); call.end = () => c.close() } })
        return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
      }))
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const d = drive({ reconnect: { delayMs: 5, maxDelayMs: 5, jitter: false } })
      d.declare({ feed: feed({ headers: { authorization: 'Bearer t' }, resume, meta: true }) })
      await wait(10)
      calls[0].send('retry: 1\nid: 9\ndata: {"n":1}\n\n')
      await wait(10)
      expect(d.list.at(-1)).toEqual(['MSG', { data: { n: 1 }, id: '9', event: 'message' }])
      calls[0].end()            // EventSource's own retry (Last-Event-ID: 9) gets the 502
      await wait(40)
      expect(calls).toHaveLength(3)
      expect(calls[1].init.headers['last-event-id']).toBe('9')
      expect(calls[2].init.headers['last-event-id']).toBe(resume ? '9' : undefined)
      expect(calls[2].url).toBe('/events')
    })
  }
})

describe('staleAfterMs', () => {
  it('SSE: silence closes it as a drop ({ stale: true }); events re-arm it; the reconnect resumes', () => {
    vi.useFakeTimers()
    const es = eventSources(), d = drive({ EventSource: es.FakeEventSource })
    d.declare({ feed: feed({ staleAfterMs: 1000, resume: true }) })
    const s = es.sources[0]
    s.accept()
    vi.advanceTimersByTime(900)
    s.emit('tick', { id: 3 })
    vi.advanceTimersByTime(900)
    expect(s.closed).toBeUndefined()
    vi.advanceTimersByTime(100)
    expect(s.closed).toBe(true)
    expect(d.list.at(-1)).toEqual(['CLOSED', { stale: true, willReconnect: true }])
    vi.advanceTimersByTime(100)
    expect(es.sources).toHaveLength(2)
    expect(es.sources[1].url).toBe('/events?lastEventId=3')
  })

  it('SSE over fetch: heartbeat comments keep it alive', async () => {
    const enc = new TextEncoder(), calls = []
    vi.stubGlobal('fetch', vi.fn((url, init) => {
      const call = { url, init }
      calls.push(call)
      const body = new ReadableStream({ start: c => { call.send = (t) => c.enqueue(enc.encode(t)) } })
      init.signal?.addEventListener('abort', () => { call.aborted = true })
      return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    }))
    const wait = (ms) => new Promise(r => setTimeout(r, ms))
    const d = drive({ reconnect: false })
    d.declare({ feed: feed({ headers: { a: 'b' }, staleAfterMs: 120 }) })
    await wait(10)
    for (let i = 0; i < 4; i++) { calls[0].send(': ping\n\n'); await wait(60) }
    expect(calls[0].aborted).toBeUndefined()
    await wait(160)
    expect(calls[0].aborted).toBe(true)
    expect(d.list.at(-1)).toEqual(['CLOSED', { stale: true, willReconnect: false }])
  })

  it('WebSocket: the same, with a reconnect', () => {
    vi.useFakeTimers()
    const ws = webSockets(), d = drive({ WebSocket: ws.FakeWebSocket })
    d.declare({ room: { socket: '/ws', message: 'MSG', close: 'CLOSED', staleAfterMs: 500 } })
    ws.sockets[0].accept()
    vi.advanceTimersByTime(400)
    ws.sockets[0].receive({ n: 1 })
    vi.advanceTimersByTime(400)
    expect(ws.sockets[0].closed).toBeUndefined()
    vi.advanceTimersByTime(100)
    expect(ws.sockets[0].closed).toBe(true)
    expect(d.list.at(-1)).toEqual(['CLOSED', { code: 1006, reason: 'stale', stale: true, willReconnect: true }])
    vi.advanceTimersByTime(100)
    expect(ws.sockets).toHaveLength(2)
  })

  it('a connection the app removes never fires its stale timer', () => {
    vi.useFakeTimers()
    const es = eventSources(), d = drive({ EventSource: es.FakeEventSource })
    d.declare({ feed: feed({ staleAfterMs: 100 }) })
    es.sources[0].accept()
    d.declare({})
    vi.advanceTimersByTime(500)
    expect(d.list.map(([type]) => type)).toEqual(['OPEN'])
  })
})

describe('renderComponent: t.push(…, { id }) with meta and resume', () => {
  function Feed({ state }) { return h('ul', null, ...state.events.map((e, i) => h('li', { key: i }, `${e.id}:${e.data.n}`))) }
  Feed.initialState = { events: [], drops: [] }
  Feed.connections = () => ({ feed: { sse: '/events', meta: true, resume: true, staleAfterMs: 1000, message: 'GOT', close: 'DROPPED' } })
  Feed.model = {
    GOT: (s, e) => ({ ...s, events: [...s.events, e] }),
    DROPPED: (s, c) => ({ ...s, drops: [...s.drops, c] }),
  }

  it('meta actions carry the pushed id; a stale connection reconnects resuming from it', async () => {
    vi.useFakeTimers()
    const t = renderComponent(Feed)
    await t.ready()
    await t.push('WS', { n: 1 }, { id: 'a1' })
    await t.push('WS', { n: 2 })
    expect(t.state.events).toEqual([{ data: { n: 1 }, id: 'a1', event: 'message' }, { data: { n: 2 }, id: 'a1', event: 'message' }])
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.state.drops).toEqual([{ stale: true, willReconnect: true }])
    // reconnected after the backoff (500 ms ± 20%), and open again
    await vi.advanceTimersByTimeAsync(700)
    expect(t.connections('WS')).toMatchObject([{ name: 'feed', state: 'open' }])
    await t.push('WS', { n: 3 }, { id: 'a2' })
    expect(t.state.events.at(-1)).toEqual({ data: { n: 3 }, id: 'a2', event: 'message' })
    t.dispose()
  })
})
