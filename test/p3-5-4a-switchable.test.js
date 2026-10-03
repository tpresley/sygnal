// @vitest-environment jsdom
// PLAN-3 5-4a: two Switchable changes the router needs.
// - D83: `instance` re-creates the current page when it changes (fresh state, DISPOSE runs, its
//   connections and resources close); a page shown again after the instance changed while it
//   was hidden is re-created on show. Switching `current` alone keeps pages alive.
// - D85: while a page (or anything inside it) is hidden, its declaration statics send only the
//   entries with `background: true`; the rest are removed (sockets close, resources abort/idle).
//   On show the full set is sent again. A non-object static (a `route` string) stays live.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import xs from 'xstream'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { Switchable, switchable } from '../src/index.js'
import { Collection } from '../src/collection.js'
import { makeSocketDriver } from '../src/extra/socketDriver.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { makeReplies } from '../src/extra/replies.js'
import { StateSource } from '../src/cycle/state/index.js'
import { waitFor, textOf, sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'

// The fake chat server of test/p3-2a-socket.test.js
function chatServer() {
  const sockets = []
  class FakeWebSocket {
    constructor(url, protocols) {
      this.url = String(url)
      this.readyState = 0
      this.sent = []
      this.closedByClient = false
      sockets.push(this)
    }
    get path() { return new URL(this.url).pathname }
    _fire(type, init = {}) { this[`on${type}`]?.({ type, ...init }) }
    send(data) { if (this.readyState === 1) this.sent.push(data) }
    close(code = 1000, reason = '') {
      if (this.readyState >= 2) return
      this.closedByClient = true
      this.closeInit = { code, reason }
      this.readyState = 2
    }
    accept() { this.readyState = 1; this._fire('open') }
    receive(data) { this._fire('message', { data: typeof data === 'string' ? data : JSON.stringify(data) }) }
    finishClose() {
      if (this.readyState !== 2) return
      this.readyState = 3
      this._fire('close', { ...this.closeInit, wasClean: true })
    }
  }
  Object.assign(FakeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
  return {
    FakeWebSocket, sockets,
    live: (path) => sockets.filter(s => s.readyState < 2 && (!path || s.path === path)),
    finishCloses: () => sockets.forEach(s => s.finishClose()),
  }
}

// The fetch stub of test/p3-3a-resources.test.js: every fetch stays pending until answered
function fetchServer() {
  const requests = []
  const fn = vi.fn((input, init) => new Promise((resolve, reject) => {
    const r = { path: new URL(String(input), 'http://localhost').pathname, resolve, reject, settled: false }
    requests.push(r)
    init?.signal?.addEventListener('abort', () => {
      if (r.settled) return
      r.settled = r.aborted = true
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    })
  }))
  return {
    fn, requests,
    respond: (i, body) => {
      const r = requests[i]
      r.settled = true
      r.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    },
  }
}

// a driver with a non-object declaration static (the router's shape): records what it's sent
function makeRouteDriver(sent) {
  return (sink$) => {
    const { replies } = makeReplies()
    sink$.addListener({ next: v => sent.push(v), error() {}, complete() {} })
    const source = () => ({ ...replies, __sygnalStatic: 'route', isolateSource: () => source(), isolateSink: s => s })
    return source()
  }
}

let ws, srv, app, errorSpy
beforeEach(() => {
  ws = chatServer()
  srv = fetchServer()
  document.body.innerHTML = '<div id="root"></div>'
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  vi.restoreAllMocks()
})
const drivers = (extra = {}) => ({
  WS: makeSocketDriver({ WebSocket: ws.FakeWebSocket }),
  HTTP: makeFetchDriver({ fetch: srv.fn }),
  ...extra,
})
const start = (App, extra) => (app = run(App, drivers(extra), { mountPoint: '#root' }))
const text = sel => { const el = document.querySelector(sel); return el ? textOf(el) : null }
const click = async sel => { await waitFor(() => expect(document.querySelector(sel)).toBeTruthy()); document.querySelector(sel).click() }

let disposed
beforeEach(() => { disposed = [] })

// A local-state counter inside the page (isolatedState: its state is the page instance's own)
function Counter({ state }) {
  return h('div', null, h('button', { className: 'inc' }, '+'), h('span', { className: 'count' }, String(state.n)))
}
Counter.isolatedState = true
Counter.initialState = { n: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = { INC: s => ({ ...s, n: s.n + 1 }) }

// The chat page: a room socket (paused while hidden), a feed socket (background), a resource
function ChatPage({ state }) {
  return h('section', { className: 'chat' },
    h('p', { className: 'log' }, state.log.join(',')),
    h('p', { className: 'feed' }, state.feed.join(',')),
    h('p', { className: 'info' }, state.info?.status === 'success' ? state.info.data.v : state.info?.status ?? ''),
    h(Counter))
}
ChatPage.connections = (s) => ({
  room: { socket: `/ws/room/${s.id}`, message: 'GOT', open: 'UP', close: 'DOWN' },
  feed: { socket: '/ws/feed', message: 'FEED', background: true },
})
ChatPage.resources = { info: (s) => ({ url: `/api/info/${s.id}` }) }
ChatPage.model = {
  GOT: (s, m) => ({ ...s, log: [...s.log, m.text] }),
  UP: (s, d) => ({ ...s, log: [...s.log, `up:${d.reconnected}`] }),
  DOWN: (s) => ({ ...s, log: [...s.log, 'DROPPED'] }),
  FEED: (s, m) => ({ ...s, feed: [...s.feed, m.text] }),
  DISPOSE: { EFFECT: (s) => { disposed.push(s.id) } },
}

function OtherPage() { return h('section', { className: 'other' }, 'other') }

function App({ state }) {
  return h('div', null,
    h('button', { className: 'to-chat' }, 'chat'),
    h('button', { className: 'to-other' }, 'other'),
    h('button', { className: 'next-id' }, 'next'),
    h('main', null, h(Switchable, { of: { chat: ChatPage, other: OtherPage }, current: state.page, instance: state.id })))
}
App.initialState = { page: 'chat', id: 1, log: [], feed: [] }
App.intent = ({ DOM }) => ({
  CHAT: DOM.click('.to-chat'),
  OTHER: DOM.click('.to-other'),
  NEXT: DOM.click('.next-id'),
})
App.model = {
  CHAT: s => ({ ...s, page: 'chat' }),
  OTHER: s => ({ ...s, page: 'other' }),
  // the page's log lives in the app's state; a new id starts a new conversation
  NEXT: s => ({ ...s, id: s.id + 1, log: [] }),
}

const room = (id) => ws.sockets.filter(s => s.path === `/ws/room/${id}`)

describe('D83: Switchable instance', () => {
  it('an instance change re-creates the current page: fresh local state, DISPOSE, old socket closed without a close action', async () => {
    start(App)
    await waitFor(() => expect(room(1)).toHaveLength(1))
    room(1)[0].accept()
    await waitFor(() => expect(text('.log')).toBe('up:false'))
    await click('.inc'); await click('.inc')
    await waitFor(() => expect(text('.count')).toBe('2'))

    await click('.next-id')
    await waitFor(() => expect(ws.live('/ws/room/2')).toHaveLength(1))
    expect(room(1)[0].closedByClient).toBe(true)
    // the old instance is disposed once; it already saw the new id (state reaches the page before
    // the parent re-renders the Switchable with the new instance)
    expect(disposed).toEqual([2])
    ws.finishCloses()
    await waitFor(() => expect(text('.count')).toBe('0'))
    await sleep(20)
    expect(text('.log')).not.toContain('DROPPED')
    // the new instance's resource is fetched for the new id
    await waitFor(() => expect(srv.requests.map(r => r.path)).toContain('/api/info/2'))
    // the background feed connection was re-created too (it belongs to the old instance)
    expect(ws.live('/ws/feed')).toHaveLength(1)
  })

  it('switching pages without an instance change keeps the page (and its local state)', async () => {
    start(App)
    await waitFor(() => expect(document.querySelector('.inc')).toBeTruthy())
    await click('.inc')
    await waitFor(() => expect(text('.count')).toBe('1'))
    await click('.to-other')
    await waitFor(() => expect(document.querySelector('.other')).toBeTruthy())
    await click('.to-chat')
    await waitFor(() => expect(document.querySelector('.chat')).toBeTruthy())
    expect(text('.count')).toBe('1')
    expect(disposed).toEqual([])
  })

  it('a page shown again after the instance changed while it was hidden is re-created on show', async () => {
    start(App)
    await waitFor(() => expect(document.querySelector('.inc')).toBeTruthy())
    await click('.inc')
    await waitFor(() => expect(text('.count')).toBe('1'))
    await click('.to-other')
    await waitFor(() => expect(document.querySelector('.other')).toBeTruthy())
    await click('.next-id')
    await sleep(20)
    expect(disposed).toEqual([])           // not while hidden
    await click('.to-chat')
    await waitFor(() => expect(document.querySelector('.chat')).toBeTruthy())
    expect(disposed).toEqual([2])           // the hidden page already saw id 2 in its state
    expect(text('.count')).toBe('0')
  })

  it('a page never shown adopts the instance it is first shown with (no re-creation)', async () => {
    const Start = ({ state }) => h('div', null,
      h('button', { className: 'go' }, 'go'),
      h(Switchable, { of: { other: OtherPage, chat: ChatPage }, current: state.page, instance: state.id }))
    Start.initialState = { page: 'other', id: 7, log: [], feed: [] }
    Start.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    Start.model = { GO: s => ({ ...s, page: 'chat', id: 8 }) }
    start(Start)
    await waitFor(() => expect(document.querySelector('.other')).toBeTruthy())
    await click('.go')
    await waitFor(() => expect(document.querySelector('.chat')).toBeTruthy())
    await sleep(20)
    expect(disposed).toEqual([])
    expect(room(8)).toHaveLength(1)
    expect(room(7)).toHaveLength(0)        // hidden from the start: never opened
  })

  it('the stream form: switchable() takes [name, instance] pairs', () => {
    const made = [], gone = []
    const page = (n) => () => {
      const id = `${n}${made.length}`
      made.push(id)
      return { DOM: xs.of(id).remember(), __dispose: () => gone.push(id) }
    }
    const sel$ = xs.create()
    const state = new StateSource(xs.of({}).remember(), 'STATE')
    const sinks = switchable({ a: page('a'), b: page('b') }, sel$, 'a')({ STATE: state, DOM: {} })
    const out = []
    const listener = { next: v => out.push(v), error() {}, complete() {} }
    sinks.DOM.addListener(listener)
    expect(made).toEqual(['a0', 'b1'])
    sel$.shamefullySendNext(['a', 1])     // adopts instance 1
    sel$.shamefullySendNext('b')          // a plain name: instance undefined
    sel$.shamefullySendNext(['a', 1])     // same instance: kept
    expect(gone).toEqual([])
    sel$.shamefullySendNext(['a', 2])     // re-created
    expect(gone).toEqual(['a0'])
    expect(made).toEqual(['a0', 'b1', 'a2'])
    expect(out.filter(Boolean).at(-1)).toBe('a2')
    sinks.DOM.removeListener(listener)
    sinks.__dispose()
    expect(gone.sort()).toEqual(['a0', 'a2', 'b1'])
  })
})

describe('D85: hidden pages pause their declarations', () => {
  it('a hidden page closes its socket and idles its resource; on show it reconnects as new and refetches', async () => {
    start(App)
    await waitFor(() => expect(room(1)).toHaveLength(1))
    room(1)[0].accept()
    await waitFor(() => expect(srv.requests).toHaveLength(1))
    srv.respond(0, { v: 'hello' })
    await waitFor(() => expect(text('.info')).toBe('hello'))
    await waitFor(() => expect(text('.log')).toBe('up:false'))

    await click('.to-other')
    await waitFor(() => expect(room(1)[0].closedByClient).toBe(true))
    ws.finishCloses()
    await sleep(20)
    // the driver closed it: no close action (checked below: the log has no DROPPED)

    await click('.to-chat')
    await waitFor(() => expect(room(1)).toHaveLength(2))
    room(1)[1].accept()
    await waitFor(() => expect(text('.log')).toBe('up:false,up:false'))
    await waitFor(() => expect(srv.requests).toHaveLength(2))
    expect(srv.requests[1].path).toBe('/api/info/1')
    srv.respond(1, { v: 'again' })
    await waitFor(() => expect(text('.info')).toBe('again'))
  })

  it('a resource in flight when the page hides is aborted', async () => {
    start(App)
    await waitFor(() => expect(srv.requests).toHaveLength(1))
    await click('.to-other')
    await waitFor(() => expect(srv.requests[0].aborted).toBe(true))
  })

  it('a background: true connection stays open across hide/show and keeps receiving while hidden', async () => {
    start(App)
    await waitFor(() => expect(ws.live('/ws/feed')).toHaveLength(1))
    const feed = ws.live('/ws/feed')[0]
    feed.accept()
    feed.receive({ text: 'f1' })
    await click('.to-other')
    await waitFor(() => expect(room(1)[0].closedByClient).toBe(true))
    feed.receive({ text: 'f2' })
    await click('.to-chat')
    await waitFor(() => expect(document.querySelector('.chat')).toBeTruthy())
    await waitFor(() => expect(text('.feed')).toBe('f1,f2'))
    expect(feed.closedByClient).toBe(false)
    expect(ws.sockets.filter(s => s.path === '/ws/feed')).toHaveLength(1)
  })

  it('nested components inside a hidden page pause too', async () => {
    function Inner() { return h('i', null, 'inner') }
    Inner.connections = () => ({ inner: { socket: '/ws/inner' } })
    Inner.model = {}  // a static needs a model to be sent (pre-existing)
    function Outer() { return h('section', { className: 'outer' }, h(Inner)) }
    function Tabs({ state }) {
      return h('div', null, h('button', { className: 'flip' }, 'flip'),
        h(Switchable, { of: { outer: Outer, other: OtherPage }, current: state.page }))
    }
    Tabs.initialState = { page: 'outer' }
    Tabs.intent = ({ DOM }) => ({ FLIP: DOM.click('.flip') })
    Tabs.model = { FLIP: s => ({ ...s, page: s.page === 'outer' ? 'other' : 'outer' }) }
    start(Tabs)
    await waitFor(() => expect(ws.live('/ws/inner')).toHaveLength(1))
    await click('.flip')
    await waitFor(() => expect(ws.live('/ws/inner')).toHaveLength(0))
    await click('.flip')
    await waitFor(() => expect(ws.live('/ws/inner')).toHaveLength(1))
    expect(ws.sockets.filter(s => s.path === '/ws/inner')).toHaveLength(2)
  })

  it('Collection items inside a hidden page pause', async () => {
    function Item({ state }) { return h('li', null, state.id) }
    Item.connections = (s) => ({ item: { socket: `/ws/item/${s.id}` } })
    Item.model = {}
    function List() { return h('ul', { className: 'list' }, h(Collection, { of: Item, from: 'items' })) }
    function Tabs({ state }) {
      return h('div', null, h('button', { className: 'flip' }, 'flip'),
        h(Switchable, { of: { list: List, other: OtherPage }, current: state.page }))
    }
    Tabs.initialState = { page: 'list', items: [{ id: 'a' }, { id: 'b' }] }
    Tabs.intent = ({ DOM }) => ({ FLIP: DOM.click('.flip') })
    Tabs.model = { FLIP: s => ({ ...s, page: s.page === 'list' ? 'other' : 'list' }) }
    start(Tabs)
    await waitFor(() => expect(ws.live().map(s => s.path).sort()).toEqual(['/ws/item/a', '/ws/item/b']))
    await click('.flip')
    await waitFor(() => expect(ws.live()).toHaveLength(0))
    await click('.flip')
    await waitFor(() => expect(ws.live()).toHaveLength(2))
  })

  it('a route-style string static stays live while hidden', async () => {
    const sent = []
    function RoutePage() { return h('p', { className: 'rp' }, 'route page') }
    RoutePage.route = 'ROUTE'
    RoutePage.model = { ROUTE: s => s }
    function Tabs({ state }) {
      return h('div', null, h('button', { className: 'flip' }, 'flip'),
        h(Switchable, { of: { rp: RoutePage, other: OtherPage }, current: state.page }))
    }
    Tabs.initialState = { page: 'rp' }
    Tabs.intent = ({ DOM }) => ({ FLIP: DOM.click('.flip') })
    Tabs.model = { FLIP: s => ({ ...s, page: s.page === 'rp' ? 'other' : 'rp' }) }
    start(Tabs, { ROUTER: makeRouteDriver(sent) })
    await waitFor(() => expect(sent.some(v => v && v.route === 'ROUTE')).toBe(true))
    await click('.flip')
    await waitFor(() => expect(document.querySelector('.other')).toBeTruthy())
    await sleep(20)
    const fromPage = sent.filter(v => v && 'route' in v && v.__emitterName === 'RoutePage')
    expect(fromPage.length).toBeGreaterThan(0)
    expect(fromPage.every(v => v.route === 'ROUTE')).toBe(true)
  })

  it('a page hidden from the start never opens its non-background connections', async () => {
    const Start = ({ state }) => h('div', null,
      h(Switchable, { of: { other: OtherPage, chat: ChatPage }, current: state.page }))
    Start.initialState = { page: 'other', id: 3, log: [], feed: [] }
    start(Start)
    await waitFor(() => expect(ws.live('/ws/feed')).toHaveLength(1))
    await sleep(20)
    expect(room(3)).toHaveLength(0)
    expect(srv.requests).toHaveLength(0)
  })
})
