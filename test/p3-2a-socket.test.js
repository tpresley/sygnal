// @vitest-environment jsdom
// PLAN-3 2-A: makeSocketDriver (WebSocket + server-sent events). Driver-level tests feed the sink
// directly with sender-stamped values (what the core sends) and read the reply actions with
// source.replies(sender); the run() tests cover Collection items, dispose, and task 22's spec.
import { it, expect, beforeEach, afterEach, vi, describe } from 'vitest'
import xs from 'xstream'
import run from '../src/extra/run.js'
import { ABORT } from '../src/component.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { makeSocketDriver } from '../src/extra/socketDriver.js'
import { waitFor, textOf, getByText, queryByText, sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'

// ---------------------------------------------------------------------------------------------
// A fake server (after task 22's hidden test): records every socket; the test opens, feeds,
// drops or refuses each one. A socket the client closes stays CLOSING until finishClose().
function chatServer() {
  const sockets = []
  class FakeWebSocket {
    constructor(url, protocols) {
      this.url = String(url)
      this.protocols = protocols
      this.readyState = 0
      this.sent = []
      this.closedByClient = false
      sockets.push(this)
    }
    get path() { return new URL(this.url).pathname }
    _fire(type, init = {}) { this[`on${type}`]?.({ type, ...init }) }
    send(data) {
      if (this.readyState === 0) throw new Error('Still in CONNECTING state.')
      if (this.readyState === 1) this.sent.push(data)
    }
    close(code = 1000, reason = '') {
      if (this.readyState >= 2) return
      this.closedByClient = true
      this.wasOpen = this.readyState === 1
      this.closeInit = { code, reason }
      this.readyState = 2
    }
    accept() {
      if (this.readyState !== 0) throw new Error(`accept(): ${this.url} is not connecting`)
      this.readyState = 1
      this._fire('open')
    }
    receive(data) { this._fire('message', { data: typeof data === 'string' || data instanceof ArrayBuffer ? data : JSON.stringify(data) }) }
    drop(code = 1006, reason = '') {
      const connecting = this.readyState === 0
      this.readyState = 3
      if (connecting) this._fire('error')
      this._fire('close', { code, reason, wasClean: false })
    }
    finishClose() {
      if (this.readyState !== 2) return
      this.readyState = 3
      this._fire('close', { ...this.closeInit, wasClean: true })
    }
  }
  Object.assign(FakeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
  return { FakeWebSocket, sockets, live: () => sockets.filter(s => s.readyState < 2), finishCloses: () => sockets.forEach(s => s.finishClose()) }
}

function sseServer() {
  const sources = []
  class FakeEventSource {
    constructor(url, init) {
      this.url = url
      this.withCredentials = !!init?.withCredentials
      this.readyState = 0
      this.listeners = {}
      this.closed = false
      sources.push(this)
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
    close() { this.readyState = 2; this.closed = true }
    accept() { this.readyState = 1; this.onopen?.({ type: 'open' }) }
    emit(data, type = 'message') {
      const ev = { type, data }
      if (type === 'message') this.onmessage?.(ev)
      ;(this.listeners[type] || []).forEach(f => f(ev))
    }
    // transient: EventSource retries by itself (CONNECTING); fatal: it gives up (CLOSED)
    fail(fatal = false) { this.readyState = fatal ? 2 : 0; this.onerror?.({ type: 'error' }) }
  }
  return { FakeEventSource, sources }
}

// ---------------------------------------------------------------------------------------------
// Driver-level harness
let server, sse, errorSpy
beforeEach(() => {
  server = chatServer()
  sse = sseServer()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()  // first: the backoff test spies on the faked setTimeout
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function drive(opts = {}) {
  const sink = xs.create()
  const src = makeSocketDriver({ WebSocket: server.FakeWebSocket, EventSource: sse.FakeEventSource, ...opts })(sink)
  const subs = new Map()
  /** the reply actions of `sender`, as [type, data] */
  const actions = sender => {
    if (!subs.has(sender)) {
      const list = []
      const l = { next: a => list.push([a.type, a.data]), error: () => {}, complete: () => {} }
      const s$ = src.replies(sender)
      s$.addListener(l)
      subs.set(sender, { list, stop: () => s$.removeListener(l) })
    }
    return subs.get(sender).list
  }
  /** send a value to the sink, stamped with `sender` as the core does */
  const put = (sender, v) => sink.shamefullySendNext(sender === undefined ? v
    : Object.defineProperties({ ...v }, { __emitterId: { value: sender }, __emitterName: { value: `C${sender}` } }))
  const declare = (sender, connections) => { actions(sender); put(sender, { connections }) }
  const stop = sender => subs.get(sender).stop()
  return { sink, src, actions, put, declare, stop }
}
const room = (path = '/ws/rooms/general', more = {}) =>
  ({ socket: path, message: 'RECEIVED', open: 'ONLINE', close: 'DROPPED', error: 'FAILED', ...more })
const coded = code => errorSpy.mock.calls.filter(c => String(c[0]).includes(code))

describe('makeSocketDriver: WebSocket', () => {
  it('opens on declaration; open, JSON and text messages arrive as the reply actions', () => {
    const d = drive()
    d.declare(1, { room: room() })
    expect(server.sockets).toHaveLength(1)
    const ws = server.sockets[0]
    expect(ws.url).toBe(`ws://${location.host}/ws/rooms/general`)
    ws.accept()
    ws.receive({ user: 'ana', text: 'hi' })
    ws.receive('plain text')
    ws.receive('42')
    expect(d.actions(1)).toEqual([
      ['ONLINE', { reconnected: false }],
      ['RECEIVED', { user: 'ana', text: 'hi' }],
      ['RECEIVED', 'plain text'],
      ['RECEIVED', 42],
    ])
  })

  it('binary frames pass through; binary sends go as is', () => {
    const d = drive()
    d.declare(1, { room: room() })
    const ws = server.sockets[0]
    ws.accept()
    const buf = new ArrayBuffer(4)
    ws.receive(buf)
    expect(d.actions(1)[1]).toEqual(['RECEIVED', buf])
    expect(d.actions(1)[1][1]).toBe(buf)
    const bytes = new Uint8Array([1, 2])
    d.put(1, { to: 'room', binary: bytes })
    expect(ws.sent[0]).toBe(bytes)
  })

  it('sends json (stringified) and text; sends while connecting are queued, bounded, oldest dropped', () => {
    const d = drive({ queueLimit: 2 })
    d.declare(1, { room: room() })
    const ws = server.sockets[0]
    d.put(1, { to: 'room', text: 'one' })
    d.put(1, { to: 'room', json: { n: 2 } })
    d.put(1, { to: 'room', json: { n: 3 } })
    expect(ws.sent).toEqual([])
    ws.accept()
    expect(ws.sent).toEqual(['{"n":2}', '{"n":3}'])
    d.put(1, { to: 'room', text: 'now' })
    expect(ws.sent).toEqual(['{"n":2}', '{"n":3}', 'now'])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('a send to no such connection is SYG611 and nothing is sent', () => {
    const d = drive()
    d.declare(1, { room: room() })
    server.sockets[0].accept()
    d.put(1, { to: 'lobby', text: 'x' })
    d.put(2, { to: 'room', text: 'x' })  // another instance's connection names are its own
    expect(coded('SYG611')).toHaveLength(2)
    expect(String(coded('SYG611')[0][0])).toContain("no connection named 'lobby'")
    expect(server.sockets[0].sent).toEqual([])
  })

  it('room switch: closes the old socket, opens the new one, no close action; late events of the old one are ignored', () => {
    const d = drive()
    d.declare(1, { room: room('/ws/rooms/general') })
    const general = server.sockets[0]
    general.accept()
    d.declare(1, { room: room('/ws/rooms/random') })
    expect(general.closedByClient).toBe(true)
    expect(server.sockets).toHaveLength(2)
    const random = server.sockets[1]
    expect(random.path).toBe('/ws/rooms/random')
    random.accept()
    general.finishClose()
    general.receive({ late: true })
    expect(d.actions(1)).toEqual([['ONLINE', { reconnected: false }], ['ONLINE', { reconnected: false }]])
    d.put(1, { to: 'room', text: 'hey' })
    expect(random.sent).toEqual(['hey'])
    expect(general.sent).toEqual([])
  })

  it('changed action names only rebind (same socket); changed protocols reconnect', () => {
    const d = drive()
    d.declare(1, { room: room() })
    const ws = server.sockets[0]
    ws.accept()
    d.declare(1, { room: room('/ws/rooms/general', { message: 'GOT' }) })
    expect(server.sockets).toHaveLength(1)
    ws.receive({ a: 1 })
    expect(d.actions(1).at(-1)).toEqual(['GOT', { a: 1 }])
    d.declare(1, { room: room('/ws/rooms/general', { message: 'GOT', protocols: ['v2'] }) })
    expect(ws.closedByClient).toBe(true)
    expect(server.sockets).toHaveLength(2)
    expect(server.sockets[1].protocols).toEqual(['v2'])
  })

  it('removal (missing or falsy name): closes with no close action; a pending retry is cancelled', () => {
    vi.useFakeTimers()
    const d = drive()
    d.declare(1, { a: room('/a'), b: room('/b') })
    const [a, b] = server.sockets
    a.accept(); b.accept()
    d.declare(1, { a: room('/a'), b: false })
    expect(b.closedByClient).toBe(true)
    a.drop()
    expect(d.actions(1).at(-1)).toEqual(['DROPPED', { code: 1006, reason: '', willReconnect: true }])
    d.declare(1, {})
    vi.advanceTimersByTime(30000)
    expect(server.sockets).toHaveLength(2)
    expect(d.actions(1).filter(([t]) => t === 'DROPPED')).toHaveLength(1)
  })

  it('a drop fires close with willReconnect, then reconnects after a fixed delay; open says reconnected', () => {
    vi.useFakeTimers()
    const d = drive()
    d.declare(1, { room: room('/r', { reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false } }) })
    server.sockets[0].accept()
    server.sockets[0].drop(1011, 'server restart')
    expect(d.actions(1).at(-1)).toEqual(['DROPPED', { code: 1011, reason: 'server restart', willReconnect: true }])
    vi.advanceTimersByTime(999)
    expect(server.sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(server.sockets).toHaveLength(2)
    server.sockets[1].drop()  // fails to open: retried after the same fixed delay
    vi.advanceTimersByTime(999)
    expect(server.sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(server.sockets).toHaveLength(3)
    server.sockets[2].accept()
    expect(d.actions(1).at(-1)).toEqual(['ONLINE', { reconnected: true }])
  })

  it('a failure to open is a drop: error, then close with willReconnect, then a retry', () => {
    vi.useFakeTimers()
    const d = drive()
    d.declare(1, { room: room() })
    server.sockets[0].drop()
    expect(d.actions(1).map(([t]) => t)).toEqual(['FAILED', 'DROPPED'])
    expect(d.actions(1)[0][1].error.type).toBe('error')
    expect(d.actions(1)[1][1].willReconnect).toBe(true)
    vi.advanceTimersByTime(10000)
    expect(server.sockets).toHaveLength(2)
    server.sockets[1].accept()
    expect(d.actions(1).at(-1)).toEqual(['ONLINE', { reconnected: false }])  // it never opened before
  })

  it('reconnect: false (per connection or driver default): no retry, and the connection is gone', () => {
    vi.useFakeTimers()
    const d = drive({ reconnect: false })
    d.declare(1, { room: room() })
    server.sockets[0].accept()
    server.sockets[0].drop()
    expect(d.actions(1).at(-1)).toEqual(['DROPPED', { code: 1006, reason: '', willReconnect: false }])
    vi.advanceTimersByTime(60000)
    expect(server.sockets).toHaveLength(1)
    d.put(1, { to: 'room', text: 'x' })
    expect(coded('SYG611')).toHaveLength(1)
    // a connection's own policy wins over the driver default
    d.declare(1, { room: room('/other', { reconnect: { delayMs: 10, jitter: false } }) })
    server.sockets[1].drop()
    vi.advanceTimersByTime(10)
    expect(server.sockets).toHaveLength(3)
  })

  it('default backoff: jittered exponential, 500 ms doubling to 10 s, ±20%', () => {
    vi.useFakeTimers()
    const delays = []
    const realSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => { delays.push(ms); return realSetTimeout(fn, ms) })
    const rand = vi.spyOn(Math, 'random')
    const d = drive()
    d.declare(1, { room: room() })
    const seq = [0, 0.5, 0.9999999, 0.5, 0.5, 0.5, 0.5, 0]
    seq.forEach((r, i) => {
      rand.mockReturnValue(r)
      server.sockets[i].drop()
      vi.advanceTimersByTime(20000)
    })
    expect(delays.map(Math.round)).toEqual([400, 1000, 2400, 4000, 8000, 10000, 10000, 8000])
    // an open resets the backoff
    server.sockets.at(-1).accept()
    rand.mockReturnValue(0.5)
    server.sockets.at(-1).drop()
    expect(delays.at(-1)).toBe(500)
  })

  it('shares one socket per URL across senders, ref-counted, with fan-out', async () => {
    const d = drive()
    d.declare(1, { feed: room('/feed') })
    d.declare(2, { news: room('/feed', { message: 'NEWS' }) })
    expect(server.sockets).toHaveLength(1)
    const ws = server.sockets[0]
    ws.accept()
    ws.receive({ n: 1 })
    expect(d.actions(1)).toEqual([['ONLINE', { reconnected: false }], ['RECEIVED', { n: 1 }]])
    expect(d.actions(2)).toEqual([['ONLINE', { reconnected: false }], ['NEWS', { n: 1 }]])
    // a late joiner of an open socket gets its open
    d.declare(3, { f: room('/feed') })
    await Promise.resolve()
    expect(d.actions(3)).toEqual([['ONLINE', { reconnected: false }]])
    d.put(2, { to: 'news', text: 'from 2' })
    expect(ws.sent).toEqual(['from 2'])
    d.declare(1, {})
    d.declare(3, { f: null })
    expect(ws.closedByClient).toBe(false)
    d.declare(2, {})
    expect(ws.closedByClient).toBe(true)
    // share: false gets a socket of its own
    d.declare(4, { a: room('/x') })
    d.declare(5, { b: room('/x', { share: false }) })
    expect(server.sockets).toHaveLength(3)
  })

  it('a shared socket drop: each subscriber gets close; those with reconnect: false leave, the rest reconnect', () => {
    vi.useFakeTimers()
    const d = drive()
    d.declare(1, { a: room('/s', { reconnect: { delayMs: 100, jitter: false } }) })
    d.declare(2, { b: room('/s', { reconnect: false }) })
    server.sockets[0].accept()
    server.sockets[0].drop()
    expect(d.actions(1).at(-1)[1].willReconnect).toBe(true)
    expect(d.actions(2).at(-1)[1].willReconnect).toBe(false)
    vi.advanceTimersByTime(100)
    expect(server.sockets).toHaveLength(2)
    server.sockets[1].accept()
    expect(d.actions(1).at(-1)).toEqual(['ONLINE', { reconnected: true }])
    expect(d.actions(2).at(-1)[0]).toBe('DROPPED')
  })

  it("a disposed sender's connections close and its pending retry is cancelled; dispose closes all", () => {
    vi.useFakeTimers()
    const d = drive()
    d.declare(1, { room: room('/one') })
    d.declare(2, { room: room('/two') })
    server.sockets[0].accept(); server.sockets[1].accept()
    server.sockets[0].drop()
    d.stop(1)                       // the instance is disposed: its replies stream stops
    vi.advanceTimersByTime(60000)   // (xstream stops asynchronously)
    expect(server.sockets).toHaveLength(2)
    expect(server.sockets[1].closedByClient).toBe(false)
    d.src.dispose()
    expect(server.sockets[1].closedByClient).toBe(true)
    expect(d.actions(2).map(([t]) => t)).toEqual(['ONLINE'])
  })

  it('resolves URLs: baseUrl prefix, https: → wss:, absolute ws URLs kept', () => {
    vi.stubGlobal('location', new URL('https://chat.example.com/app/'))
    const d = drive({ baseUrl: '/api' })
    d.declare(1, { a: room('/ws'), b: room('wss://other.example.com/x') })
    expect(server.sockets.map(s => s.url)).toEqual(['wss://chat.example.com/api/ws', 'wss://other.example.com/x'])
  })

  it('SYG610: a value or a connection with a then/catch key is refused', () => {
    const d = drive()
    d.declare(1, { room: room() })
    server.sockets[0].accept()
    d.put(1, { to: 'room', text: 'x', then: 'SENT' })
    d.declare(1, { room: room(), other: { socket: '/o', then: 'OPENED' } })
    expect(coded('SYG610')).toHaveLength(2)
    expect(server.sockets).toHaveLength(1)
    expect(server.sockets[0].sent).toEqual([])
  })

  it('an invalid connection or value is SYG611', () => {
    const d = drive()
    d.declare(1, { room: { url: '/ws' } })
    d.put(1, { hello: 1 })
    expect(coded('SYG611')).toHaveLength(2)
    expect(server.sockets).toHaveLength(0)
  })

  it('plain: events without an action name reach select(name?) as { name, type, data }', () => {
    const d = drive()
    const all = [], one = []
    d.src.select().addListener({ next: e => all.push(e) })
    d.src.select('feed').addListener({ next: e => one.push(e) })
    d.declare(1, { feed: { socket: '/f' }, chat: { socket: '/c', message: 'RECEIVED' } })
    const [f, c] = server.sockets
    f.accept(); c.accept()
    f.receive({ x: 1 })
    c.receive({ y: 2 })
    expect(one).toEqual([{ name: 'feed', type: 'open', data: { reconnected: false } }, { name: 'feed', type: 'message', data: { x: 1 } }])
    expect(all.map(e => `${e.name}:${e.type}`)).toEqual(['feed:open', 'chat:open', 'feed:message'])
    expect(d.actions(1)).toEqual([['RECEIVED', { y: 2 }]])
  })

  it('isolation: a scoped source sees only the plain events of its own scope', () => {
    const sink = xs.create()
    const src = makeSocketDriver({ WebSocket: server.FakeWebSocket })(sink)
    const inner = src.isolateSource(src, 'item1')
    const seen = []
    inner.select().addListener({ next: e => seen.push(e.name) })
    const stamp = (v, id) => Object.defineProperty(v, '__emitterId', { value: id })
    src.isolateSink(xs.of(stamp({ connections: { mine: { socket: '/m' } } }, 1)), 'item1').addListener({ next: v => sink.shamefullySendNext(v) })
    sink.shamefullySendNext(stamp({ connections: { other: { socket: '/o' } } }, 2))
    server.sockets.forEach(s => s.accept())
    expect(seen).toEqual(['mine'])
    expect(inner.__sygnalReplies).toBe(true)
  })

  it('SSR: no WebSocket / EventSource: nothing opens, nothing throws, nothing is reported', () => {
    vi.stubGlobal('WebSocket', undefined)
    vi.stubGlobal('EventSource', undefined)
    const sink = xs.create()
    const src = makeSocketDriver()(sink)
    src.replies(1).addListener({ next: () => {} })
    const stamp = v => Object.defineProperty(v, '__emitterId', { value: 1 })
    sink.shamefullySendNext(stamp({ connections: { room: room(), feed: { sse: '/events' } } }))
    sink.shamefullySendNext(stamp({ to: 'room', json: { a: 1 } }))
    sink.shamefullySendNext(stamp({ connections: {} }))
    src.dispose()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe('makeSocketDriver: server-sent events', () => {
  const feed = (more = {}) => ({ sse: '/events', message: 'RECEIVED', open: 'ONLINE', close: 'DROPPED', error: 'FAILED', ...more })

  it('message, named events, withCredentials; sending to an SSE connection is SYG611', () => {
    const d = drive()
    d.declare(1, { feed: feed({ withCredentials: true, events: { price: 'PRICE' } }) })
    const es = sse.sources[0]
    expect(es.url).toBe('/events')
    expect(es.withCredentials).toBe(true)
    es.accept()
    es.emit('{"a":1}')
    es.emit('{"p":9}', 'price')
    es.emit('ignored', 'unmapped')
    expect(d.actions(1)).toEqual([['ONLINE', { reconnected: false }], ['RECEIVED', { a: 1 }], ['PRICE', { p: 9 }]])
    d.put(1, { to: 'feed', text: 'x' })
    expect(String(coded('SYG611')[0][0])).toContain('read-only')
  })

  it('a transient error: error + close (willReconnect), EventSource retries itself, open says reconnected', () => {
    const d = drive()
    d.declare(1, { feed: feed() })
    const es = sse.sources[0]
    es.accept()
    es.fail()
    es.fail()   // a failed native retry: no second close
    expect(d.actions(1).map(([t]) => t)).toEqual(['ONLINE', 'FAILED', 'DROPPED', 'FAILED'])
    expect(d.actions(1)[2][1]).toEqual({ willReconnect: true })
    es.accept()
    expect(d.actions(1).at(-1)).toEqual(['ONLINE', { reconnected: true }])
    expect(sse.sources).toHaveLength(1)
  })

  it('when EventSource gives up (CLOSED), the driver reconnects with its policy', () => {
    vi.useFakeTimers()
    const d = drive()
    d.declare(1, { feed: feed({ reconnect: { delayMs: 200, jitter: false } }) })
    sse.sources[0].accept()
    sse.sources[0].fail(true)
    expect(d.actions(1).at(-1)).toEqual(['DROPPED', { willReconnect: true }])
    vi.advanceTimersByTime(200)
    expect(sse.sources).toHaveLength(2)
    sse.sources[1].accept()
    expect(d.actions(1).at(-1)).toEqual(['ONLINE', { reconnected: true }])
  })

  it('reconnect: false closes the EventSource on its first error; removal closes it with no close action', () => {
    const d = drive()
    d.declare(1, { a: feed({ reconnect: false }), b: { sse: '/b', close: 'DROPPED' } })
    const [a, b] = sse.sources
    a.accept(); b.accept()
    a.fail()
    expect(a.closed).toBe(true)
    expect(d.actions(1).at(-1)).toEqual(['DROPPED', { willReconnect: false }])
    d.declare(1, {})
    expect(b.closed).toBe(true)
    expect(d.actions(1).filter(([t]) => t === 'DROPPED')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------
// Under run()
let app
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
})
const start = (App, drivers) => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, drivers, { mountPoint: '#root' })
  return app
}

describe('makeSocketDriver under run()', () => {
  it('a Collection of two items: each item has its own connection and gets only its own events', async () => {
    function Item({ state }) {
      return h('li', { className: `item-${state.id}` },
        h('button', { className: 'say' }, 'say'),
        h('span', { className: 'log' }, state.log.join(',')))
    }
    Item.intent = ({ DOM }) => ({ SAY: DOM.click('.say') })
    Item.model = {
      BOOTSTRAP: { WS: s => ({ connections: { room: { socket: `/ws/${s.id}`, message: 'GOT', open: 'UP', close: 'DOWN' } } }) },
      SAY: { WS: s => ({ to: 'room', json: { from: s.id } }) },
      GOT: (s, m) => ({ ...s, log: [...s.log, m.text] }),
      UP: s => ({ ...s, log: [...s.log, 'up'] }),
      DOWN: s => ({ ...s, log: [...s.log, 'down'] }),
    }
    function List({ state }) {
      return h('div', null, h('button', { className: 'drop-a' }, 'x'), h('ul', null, h(Collection, { of: Item, from: 'items' })))
    }
    List.initialState = { items: [{ id: 'a', log: [] }, { id: 'b', log: [] }] }
    List.intent = ({ DOM }) => ({ REMOVE_A: DOM.click('.drop-a') })
    List.model = { REMOVE_A: s => ({ ...s, items: s.items.filter(i => i.id !== 'b') }) }
    start(List, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) })
    await waitFor(() => expect(server.sockets).toHaveLength(2))
    const ws = Object.fromEntries(server.sockets.map(s => [s.path.split('/').pop(), s]))
    ws.a.accept(); ws.b.accept()
    ws.a.receive({ text: 'for-a' })
    ws.b.receive({ text: 'for-b' })
    await waitFor(() => expect(textOf(document.querySelector('.item-a .log'))).toBe('up,for-a'))
    await waitFor(() => expect(textOf(document.querySelector('.item-b .log'))).toBe('up,for-b'))
    document.querySelector('.item-b .say').click()
    await waitFor(() => expect(ws.b.sent).toEqual(['{"from":"b"}']))
    expect(ws.a.sent).toEqual([])
    // removing item b disposes it: its socket closes, with no close action anywhere
    document.querySelector('.drop-a').click()
    await waitFor(() => expect(ws.b.closedByClient).toBe(true))
    expect(ws.a.closedByClient).toBe(false)
    expect(textOf(document.querySelector('.item-a .log'))).toBe('up,for-a')
  })

  it('app dispose mid-retry: no reconnect afterwards', async () => {
    function C() { return h('div', null, 'c') }
    C.initialState = {}
    C.model = { BOOTSTRAP: { WS: () => ({ connections: { r: { socket: '/r', reconnect: { delayMs: 30, maxDelayMs: 30, jitter: false } } } }) } }
    start(C, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) })
    await waitFor(() => expect(server.sockets).toHaveLength(1))
    server.sockets[0].drop()
    app.dispose()
    app = null
    await sleep(100)
    expect(server.sockets).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------
// Proof of fit: task 22 (evals/agent-ergonomics/tasks/22-chat-socket) written with
// makeSocketDriver, sending `connections` from the model (2-B will derive them from state), and
// its hidden test's assertions ported (same fake server semantics, the global WebSocket stubbed).
describe('task 22 (chat socket) with makeSocketDriver', () => {
  const ROOMS = [{ id: 'general', name: 'General' }, { id: 'random', name: 'Random' }]
  const STATUS_TEXT = { offline: 'Not connected', connecting: 'Connecting…', online: 'Online', reconnecting: 'Reconnecting…' }
  const chatRoom = (id) => ({
    socket: `/ws/rooms/${id}`,
    message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED',
    reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false },
  })

  function App({ state }) {
    const current = ROOMS.find(r => r.id === state.room)
    return h('div', { className: 'chat' },
      h('nav', { className: 'rooms' }, ...ROOMS.map(r => h('button', { className: 'room', 'data-room': r.id }, r.name))),
      h('p', { className: 'connection' }, STATUS_TEXT[state.status]),
      current && h('section', { className: 'room-panel' },
        h('button', { className: 'leave' }, 'Leave room'),
        h('ul', { className: 'messages' }, ...state.messages.map(m => h('li', null, `${m.user}: ${m.text}`))),
        h('form', { className: 'composer' },
          h('input', { name: 'text', value: state.draft }),
          h('button', { type: 'submit', disabled: state.status !== 'online' }, 'Send'))))
  }
  App.initialState = { room: null, status: 'offline', messages: [], draft: '' }
  App.intent = ({ DOM }) => ({
    JOIN: DOM.click('.room').map(e => e.target.dataset.room),
    LEAVE: DOM.click('.leave'),
    SET_DRAFT: DOM.input('input[name="text"]').value(),
    SEND: DOM.select('.composer').events('submit', { preventDefault: true }),
  })
  const isBlank = t => t.trim() === ''
  App.model = {
    JOIN: {
      STATE: (s, room) => room === s.room ? ABORT : { ...s, room, status: 'connecting', messages: [] },
      WS: (s, room) => room === s.room ? ABORT : { connections: { room: chatRoom(room) } },
    },
    LEAVE: {
      STATE: s => ({ ...s, room: null, status: 'offline', messages: [] }),
      WS: () => ({ connections: {} }),
    },
    SET_DRAFT: (s, draft) => ({ ...s, draft }),
    SEND: {
      STATE: s => isBlank(s.draft) ? ABORT : { ...s, draft: '' },
      WS: s => isBlank(s.draft) || s.status !== 'online' ? ABORT : { to: 'room', json: { text: s.draft } },
    },
    RECEIVED: (s, m) => ({ ...s, messages: [...s.messages, m] }),
    CONNECTED: s => ({ ...s, status: 'online' }),
    DROPPED: s => ({ ...s, status: 'reconnecting' }),
  }

  const CONNECTING = /^Connecting(…|\.\.\.)$/
  const RECONNECTING = /^Reconnecting(…|\.\.\.)$/
  const RETRY_WAIT = { timeout: 2500 }
  const PAUSE = 20
  const click = async el => { el.click(); await sleep(PAUSE) }
  const typeInto = async (el, value) => {
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(PAUSE)
  }
  const boot = async () => {
    vi.stubGlobal('WebSocket', server.FakeWebSocket)
    start(App, { WS: makeSocketDriver() })
    await waitFor(() => expect(document.querySelector('.connection')).toBeTruthy())
  }
  const connection = () => textOf(document.querySelector('.connection'))
  const messages = () => [...document.querySelectorAll('ul.messages li')].map(li => textOf(li))
  const sendButton = () => getByText('button', 'Send')
  const textInput = () => document.querySelector('input[name="text"]')
  const join = name => click(getByText('button', name))
  const say = async text => { await typeInto(textInput(), text); await click(sendButton()) }
  const joinOnline = async name => {
    const before = server.sockets.length
    await join(name)
    await waitFor(() => expect(server.sockets).toHaveLength(before + 1))
    const socket = server.sockets[before]
    socket.accept()
    await waitFor(() => expect(connection()).toBe('Online'))
    return socket
  }
  afterEach(async () => {
    const leave = queryByText('button', 'Leave room')
    if (leave) await click(leave)
  })

  it('joining opens one WebSocket to /ws/rooms/<room>; status; the current room again changes nothing', async () => {
    await boot()
    expect(connection()).toBe('Not connected')
    await join('General')
    await waitFor(() => expect(server.sockets).toHaveLength(1))
    const url = new URL(server.sockets[0].url)
    expect(url.protocol).toBe('ws:')
    expect(url.host).toBe(window.location.host)
    expect(url.pathname).toBe('/ws/rooms/general')
    await waitFor(() => expect(connection()).toMatch(CONNECTING))
    expect(sendButton().disabled).toBe(true)
    server.sockets[0].accept()
    await waitFor(() => expect(connection()).toBe('Online'))
    await join('General')
    await sleep(100)
    expect(server.sockets).toHaveLength(1)
    expect(server.sockets[0].closedByClient).toBe(false)
  })

  it('lists received messages and sends typed ones as JSON', async () => {
    await boot()
    const socket = await joinOnline('General')
    socket.receive({ user: 'ana', text: 'hi' })
    await waitFor(() => expect(messages()).toEqual(['ana: hi']))
    await say('Good morning')
    await waitFor(() => expect(socket.sent).toHaveLength(1))
    expect(JSON.parse(socket.sent[0])).toEqual({ text: 'Good morning' })
    await waitFor(() => expect(textInput().value).toBe(''))
    await say('   ')
    await sleep(100)
    expect(socket.sent).toHaveLength(1)
  })

  it('switching rooms closes the old connection, opens the new one; its late close changes nothing', async () => {
    await boot()
    const general = await joinOnline('General')
    general.receive({ user: 'ana', text: 'in general' })
    await waitFor(() => expect(messages()).toEqual(['ana: in general']))
    await join('Random')
    await waitFor(() => expect(server.sockets).toHaveLength(2))
    const random = server.sockets[1]
    expect(random.path).toBe('/ws/rooms/random')
    await waitFor(() => expect(general.closedByClient).toBe(true))
    expect(messages()).toEqual([])
    random.accept()
    await waitFor(() => expect(connection()).toBe('Online'))
    server.finishCloses()
    await sleep(1300)
    expect(connection()).toBe('Online')
    expect(server.sockets).toHaveLength(2)
    await say('hey')
    await waitFor(() => expect(random.sent).toHaveLength(1))
    expect(general.sent).toHaveLength(0)
  }, 10000)

  it('"Leave room" closes the connection for good', async () => {
    await boot()
    const socket = await joinOnline('Random')
    await click(getByText('button', 'Leave room'))
    await waitFor(() => expect(socket.closedByClient).toBe(true))
    await waitFor(() => expect(connection()).toBe('Not connected'))
    server.finishCloses()
    await sleep(1300)
    expect(server.sockets).toHaveLength(1)
    expect(connection()).toBe('Not connected')
  }, 10000)

  it('a dropped connection shows "Reconnecting…" and retries every second until one opens', async () => {
    await boot()
    const first = await joinOnline('General')
    first.receive({ user: 'ana', text: 'before the drop' })
    await waitFor(() => expect(messages()).toEqual(['ana: before the drop']))
    first.drop()
    await waitFor(() => expect(connection()).toMatch(RECONNECTING))
    expect(sendButton().disabled).toBe(true)
    await sleep(600)
    expect(server.sockets).toHaveLength(1)
    await waitFor(() => expect(server.sockets).toHaveLength(2), RETRY_WAIT)
    server.sockets[1].drop()
    await sleep(600)
    expect(server.sockets).toHaveLength(2)
    expect(connection()).toMatch(RECONNECTING)
    await waitFor(() => expect(server.sockets).toHaveLength(3), RETRY_WAIT)
    server.sockets[2].accept()
    await waitFor(() => expect(connection()).toBe('Online'))
    expect(messages()).toEqual(['ana: before the drop'])
    await say('back again')
    await waitFor(() => expect(server.sockets[2].sent).toHaveLength(1))
  }, 10000)

  it('switching rooms or leaving cancels a pending retry', async () => {
    await boot()
    const general = await joinOnline('General')
    general.drop()
    await waitFor(() => expect(connection()).toMatch(RECONNECTING))
    await join('Random')
    await waitFor(() => expect(server.sockets).toHaveLength(2))
    server.sockets[1].accept()
    await waitFor(() => expect(connection()).toBe('Online'))
    await sleep(1300)
    expect(server.sockets).toHaveLength(2)
    server.sockets[1].drop()
    await waitFor(() => expect(connection()).toMatch(RECONNECTING))
    await click(getByText('button', 'Leave room'))
    await waitFor(() => expect(connection()).toBe('Not connected'))
    await sleep(1300)
    expect(server.sockets).toHaveLength(2)
  }, 10000)
})
