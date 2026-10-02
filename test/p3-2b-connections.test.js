// @vitest-environment jsdom
// PLAN-3 2-B: the `connections` component static. The core maps the component's state through
// `Component.connections`, drops structurally equal repeats, and sends `{ connections }`
// (sender-stamped) to the makeSocketDriver() sink. Covered: open on mount, a room switch via
// state, leave, no repeats, G-158 ordering (a state change that opens or changes a connection
// and a send on it in the same action), Collection items, dispose, parent + child, task 22's
// spec written with the static, and the runtime SYG112 check of connection action names.
import { it, expect, beforeEach, afterEach, vi, describe } from 'vitest'
import xs from 'xstream'
import run from '../src/extra/run.js'
import { ABORT } from '../src/component.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { makeSocketDriver } from '../src/extra/socketDriver.js'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { waitFor, textOf, getByText, queryByText, sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'

// The fake chat server of test/p3-2a-socket.test.js (after task 22's hidden test)
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
      this.closeInit = { code, reason }
      this.readyState = 2
    }
    accept() {
      if (this.readyState !== 0) throw new Error(`accept(): ${this.url} is not connecting`)
      this.readyState = 1
      this._fire('open')
    }
    receive(data) { this._fire('message', { data: typeof data === 'string' ? data : JSON.stringify(data) }) }
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

let server, app, errorSpy
beforeEach(() => {
  server = chatServer()
  document.body.innerHTML = '<div id="root"></div>'
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const start = (App, drivers, opts = {}) => (app = run(App, drivers, { mountPoint: '#root', ...opts }))
/** a makeSocketDriver() whose sink values are recorded (what the core sends) */
const recorded = (sent, opts = {}) => sink$ => makeSocketDriver({ WebSocket: server.FakeWebSocket, ...opts })(sink$.map(v => (sent.push(v), v)))
const coded = code => errorSpy.mock.calls.filter(c => String(c[0]).includes(code))
const text = sel => textOf(document.querySelector(sel))
const click = sel => document.querySelector(sel).click()
const byPath = path => server.sockets.find(s => s.path === path)

// A room component: state.room names the connection; buttons switch, leave, send, and bump an
// unrelated counter
function Room({ state }) {
  return h('div', null,
    h('button', { className: 'a' }, 'a'), h('button', { className: 'b' }, 'b'),
    h('button', { className: 'leave' }, 'leave'), h('button', { className: 'say' }, 'say'),
    h('button', { className: 'bump' }, 'bump'),
    h('p', { className: 'log' }, state.log.join(',')))
}
Room.initialState = { room: 'a', n: 0, log: [] }
Room.connections = (state) => ({
  room: state.room && { socket: `/ws/${state.room}`, message: 'GOT', open: 'UP', close: 'DOWN' },
})
Room.intent = ({ DOM }) => ({
  JOIN: xs.merge(DOM.click('.a').mapTo('a'), DOM.click('.b').mapTo('b')),
  LEAVE: DOM.click('.leave'),
  SAY: DOM.click('.say'),
  BUMP: DOM.click('.bump'),
})
Room.model = {
  JOIN: (s, room) => ({ ...s, room }),
  LEAVE: (s) => ({ ...s, room: null }),
  SAY: { WS: (s) => ({ to: 'room', text: `in ${s.room}` }) },
  BUMP: (s) => ({ ...s, n: s.n + 1 }),
  GOT: (s, m) => ({ ...s, log: [...s.log, m.text] }),
  UP: (s) => ({ ...s, log: [...s.log, `up:${s.room}`] }),
  DOWN: (s) => ({ ...s, log: [...s.log, 'down'] }),
}

describe('connections static under run()', () => {
  it('opens on mount; open and messages arrive as the named actions', async () => {
    start(Room, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) })
    await waitFor(() => expect(server.sockets).toHaveLength(1))
    expect(server.sockets[0].path).toBe('/ws/a')
    server.sockets[0].accept()
    server.sockets[0].receive({ text: 'hi' })
    await waitFor(() => expect(text('.log')).toBe('up:a,hi'))
  })

  it('the value sent is stamped with the sender, like other routing sink values', async () => {
    const sent = []
    start(Room, { WS: recorded(sent) })
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ connections: { room: { socket: '/ws/a', message: 'GOT', open: 'UP', close: 'DOWN' } } })
    expect(typeof sent[0].__emitterId).toBe('number')
    expect(sent[0].__emitterName).toBe('Room')
  })

  it('a room switch via state: the old socket closes, a new one opens, no close action', async () => {
    start(Room, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) })
    await waitFor(() => expect(server.sockets).toHaveLength(1))
    const a = server.sockets[0]
    a.accept()
    await waitFor(() => expect(text('.log')).toBe('up:a'))
    click('.b')
    await waitFor(() => expect(server.sockets).toHaveLength(2))
    expect(a.closedByClient).toBe(true)
    const b = server.sockets[1]
    expect(b.path).toBe('/ws/b')
    b.accept()
    a.finishClose()
    await waitFor(() => expect(text('.log')).toBe('up:a,up:b'))
    await sleep(20)
    expect(text('.log')).toBe('up:a,up:b')   // no DOWN
  })

  it('leave (falsy entry) closes the connection, with no close action', async () => {
    start(Room, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) })
    await waitFor(() => expect(server.sockets).toHaveLength(1))
    server.sockets[0].accept()
    await waitFor(() => expect(text('.log')).toBe('up:a'))
    click('.leave')
    await waitFor(() => expect(server.sockets[0].closedByClient).toBe(true))
    server.finishCloses()
    await sleep(20)
    expect(text('.log')).toBe('up:a')
    expect(server.sockets).toHaveLength(1)
  })

  it('structurally equal results are not sent again; a change is', async () => {
    const sent = []
    start(Room, { WS: recorded(sent) })
    await waitFor(() => expect(sent).toHaveLength(1))
    server.sockets[0].accept()
    click('.bump'); click('.bump')
    await waitFor(() => expect(text('.log')).toBe('up:a'))
    await sleep(30)
    click('.a')   // the same room again: an equal result
    await sleep(30)
    expect(sent.filter(v => v.connections)).toHaveLength(1)
    click('.b')
    await waitFor(() => expect(sent.filter(v => v.connections)).toHaveLength(2))
    expect(sent[1].connections.room.socket).toBe('/ws/b')
    expect(server.sockets).toHaveLength(2)
  })

  it('sends once at startup, also when there are no connections ({})', async () => {
    const sent = []
    function Quiet() { return h('p', null, 'quiet') }
    Quiet.initialState = { on: false }
    Quiet.connections = (s) => s.on ? { feed: { socket: '/feed' } } : {}
    Quiet.model = { NOOP: (s) => s }
    start(Quiet, { WS: recorded(sent) })
    await waitFor(() => expect(sent).toHaveLength(1))
    await sleep(30)
    expect(sent).toEqual([{ connections: {} }])
    expect(server.sockets).toHaveLength(0)
  })

  it('reads calculated fields', async () => {
    function Calc() { return h('p', null, 'c') }
    Calc.initialState = { id: 7 }
    Calc.calculated = { path: (s) => `/ws/items/${s.id}` }
    Calc.connections = (s) => ({ item: { socket: s.path } })
    Calc.model = { NOOP: (s) => s }
    start(Calc, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) })
    await waitFor(() => expect(server.sockets).toHaveLength(1))
    expect(server.sockets[0].path).toBe('/ws/items/7')
  })

  it('app dispose closes the connections', async () => {
    start(Room, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) })
    await waitFor(() => expect(server.sockets).toHaveLength(1))
    server.sockets[0].accept()
    app.dispose()
    app = null
    expect(server.sockets[0].closedByClient).toBe(true)
    await sleep(30)
    expect(server.sockets).toHaveLength(1)
  })

  it('a throwing connections function is SYG216: nothing is sent, the connections stay, later results still go', async () => {
    function Flaky({ state }) { return h('div', null, h('button', { className: 'go' }, 'go'), h('p', { className: 'n' }, String(state.n))) }
    Flaky.initialState = { n: 0 }
    Flaky.connections = (s) => {
      if (s.n === 1) throw new Error('boom')
      return { live: { socket: `/live/${s.n}` } }
    }
    Flaky.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    Flaky.model = { GO: (s) => ({ ...s, n: s.n + 1 }) }
    start(Flaky, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) })
    await waitFor(() => expect(server.sockets).toHaveLength(1))
    click('.go')
    await waitFor(() => expect(text('.n')).toBe('1'))
    await sleep(20)
    expect(coded('SYG216')).toHaveLength(1)
    expect(server.sockets).toHaveLength(1)
    expect(server.sockets[0].closedByClient).toBe(false)
    click('.go')
    await waitFor(() => expect(byPath('/live/2')).toBeTruthy())
    expect(server.sockets[0].closedByClient).toBe(true)
  })

  it('no connection-capable driver: nothing is sent anywhere, nothing breaks', async () => {
    const seen = []
    const plain = sink$ => { sink$.addListener({ next: v => seen.push(v) }); return { select: () => xs.never() } }
    start(Room, { WS: plain })
    await waitFor(() => expect(text('.log')).toBe(''))
    click('.bump')
    await sleep(30)
    expect(seen).toEqual([])
  })
})

describe('G-158: a state change and a send on the connection in the same action', () => {
  // JOIN opens or changes the connection; the same entry sends on it
  function Chat({ state }) {
    return h('div', null, h('button', { className: 'a' }, 'a'), h('button', { className: 'b' }, 'b'), h('p', { className: 'room' }, String(state.room)))
  }
  Chat.initialState = { room: null }
  Chat.connections = (s) => ({ room: s.room && { socket: `/ws/${s.room}` } })
  Chat.intent = ({ DOM }) => ({ JOIN: xs.merge(DOM.click('.a').mapTo('a'), DOM.click('.b').mapTo('b')) })
  Chat.model = {
    JOIN: {
      STATE: (s, room) => ({ ...s, room }),
      WS: (s, room) => ({ to: 'room', json: { hello: room } }),
    },
  }

  it('opening: the new connection reaches the driver before the send (no SYG611, the send is queued)', async () => {
    start(Chat, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) })
    await waitFor(() => expect(text('.room')).toBe('null'))
    click('.a')
    await waitFor(() => expect(server.sockets).toHaveLength(1))
    await sleep(20)
    expect(coded('SYG611')).toEqual([])
    server.sockets[0].accept()
    expect(server.sockets[0].sent).toEqual(['{"hello":"a"}'])
  })

  it('changing: the send goes to the new connection, not the old one', async () => {
    start(Chat, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) })
    await waitFor(() => expect(text('.room')).toBe('null'))
    click('.a')
    await waitFor(() => expect(server.sockets).toHaveLength(1))
    server.sockets[0].accept()
    click('.b')
    await waitFor(() => expect(server.sockets).toHaveLength(2))
    server.sockets[1].accept()
    expect(server.sockets[0].sent).toEqual(['{"hello":"a"}'])
    expect(server.sockets[1].sent).toEqual(['{"hello":"b"}'])
    expect(coded('SYG611')).toEqual([])
  })

  it('also in a Collection item (its state arrives debounced)', async () => {
    function Item({ state }) {
      return h('li', { className: `item-${state.id}` }, h('button', { className: 'go' }, 'go'), String(state.room))
    }
    Item.connections = (s) => ({ room: s.room && { socket: `/ws/${s.id}/${s.room}` } })
    Item.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    Item.model = {
      GO: {
        STATE: (s) => ({ ...s, room: (s.room || 0) + 1 }),
        WS: (s) => ({ to: 'room', text: `from ${s.id}` }),
      },
    }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 'x', room: 0 }, { id: 'y', room: 0 }] }
    List.model = { NOOP: (s) => s }
    start(List, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) })
    await waitFor(() => expect(document.querySelector('.item-y .go')).toBeTruthy())
    click('.item-y .go')
    await waitFor(() => expect(byPath('/ws/y/1')).toBeTruthy())
    byPath('/ws/y/1').accept()
    expect(byPath('/ws/y/1').sent).toEqual(['from y'])
    click('.item-y .go')
    await waitFor(() => expect(byPath('/ws/y/2')).toBeTruthy())
    byPath('/ws/y/2').accept()
    expect(byPath('/ws/y/2').sent).toEqual(['from y'])
    expect(byPath('/ws/y/1').sent).toEqual(['from y'])
    expect(byPath('/ws/y/1').closedByClient).toBe(true)
    expect(server.sockets.filter(s => s.path.startsWith('/ws/x'))).toEqual([])
    expect(coded('SYG611')).toEqual([])
  })
})

describe('connections per instance', () => {
  it('a Collection of two items: each has its own connection, events and sends; removing one closes it', async () => {
    function Item({ state }) {
      return h('li', { className: `item-${state.id}` }, h('button', { className: 'say' }, 'say'), h('span', { className: 'log' }, state.log.join(',')))
    }
    Item.connections = (s) => ({ room: { socket: `/ws/${s.id}`, message: 'GOT', open: 'UP' } })
    Item.intent = ({ DOM }) => ({ SAY: DOM.click('.say') })
    Item.model = {
      SAY: { WS: (s) => ({ to: 'room', json: { from: s.id } }) },
      GOT: (s, m) => ({ ...s, log: [...s.log, m.text] }),
      UP: (s) => ({ ...s, log: [...s.log, 'up'] }),
    }
    function List() {
      return h('div', null, h('button', { className: 'drop-b' }, 'x'), h('ul', null, h(Collection, { of: Item, from: 'items' })))
    }
    List.initialState = { items: [{ id: 'a', log: [] }, { id: 'b', log: [] }] }
    List.intent = ({ DOM }) => ({ DROP_B: DOM.click('.drop-b') })
    List.model = { DROP_B: (s) => ({ ...s, items: s.items.filter(i => i.id !== 'b') }) }
    start(List, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) })
    await waitFor(() => expect(server.sockets).toHaveLength(2))
    const a = byPath('/ws/a'), b = byPath('/ws/b')
    a.accept(); b.accept()
    a.receive({ text: 'for-a' })
    b.receive({ text: 'for-b' })
    await waitFor(() => expect(text('.item-a .log')).toBe('up,for-a'))
    await waitFor(() => expect(text('.item-b .log')).toBe('up,for-b'))
    click('.item-b .say')
    await waitFor(() => expect(b.sent).toEqual(['{"from":"b"}']))
    expect(a.sent).toEqual([])
    click('.drop-b')
    await waitFor(() => expect(b.closedByClient).toBe(true))
    expect(a.closedByClient).toBe(false)
    expect(server.sockets).toHaveLength(2)
  })

  it('a parent and a child each have their own connections (the same name is per instance)', async () => {
    function Child({ state }) { return h('span', { className: 'child' }, state.log.join(',')) }
    Child.connections = (s) => ({ room: { socket: `/ws/child/${s.topic}`, message: 'GOT' } })
    Child.model = { GOT: (s, m) => ({ ...s, log: [...s.log, m.text] }) }
    function Parent({ state }) {
      return h('div', null, h('button', { className: 'topic' }, 't'), h('span', { className: 'parent' }, state.log.join(',')), h(Child, { state: 'child' }))
    }
    Parent.initialState = { log: [], child: { topic: 'one', log: [] } }
    Parent.connections = () => ({ room: { socket: '/ws/parent', message: 'GOT' } })
    Parent.intent = ({ DOM }) => ({ TOPIC: DOM.click('.topic') })
    Parent.model = {
      GOT: (s, m) => ({ ...s, log: [...s.log, m.text] }),
      TOPIC: (s) => ({ ...s, child: { ...s.child, topic: 'two' } }),   // the parent changes the child's connection
    }
    start(Parent, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) })
    await waitFor(() => expect(server.sockets).toHaveLength(2))
    byPath('/ws/parent').accept(); byPath('/ws/child/one').accept()
    byPath('/ws/parent').receive({ text: 'p' })
    byPath('/ws/child/one').receive({ text: 'c' })
    await waitFor(() => expect(text('.parent')).toBe('p'))
    await waitFor(() => expect(text('.child')).toBe('c'))
    click('.topic')
    await waitFor(() => expect(byPath('/ws/child/two')).toBeTruthy())
    expect(byPath('/ws/child/one').closedByClient).toBe(true)
    expect(byPath('/ws/parent').closedByClient).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// Task 22 (evals/agent-ergonomics/tasks/22-chat-socket) written with the static: the canonical
// recipe. The assertions are the hidden test's, as ported in test/p3-2a-socket.test.js.
describe('task 22 (chat socket) with the connections static', () => {
  const ROOMS = [{ id: 'general', name: 'General' }, { id: 'random', name: 'Random' }]
  const STATUS_TEXT = { offline: 'Not connected', connecting: 'Connecting…', online: 'Online', reconnecting: 'Reconnecting…' }

  function Chat({ state }) {
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
  Chat.initialState = { room: null, status: 'offline', messages: [], draft: '' }
  Chat.intent = ({ DOM }) => ({
    JOIN: DOM.click('.room').map(e => e.target.dataset.room),
    LEAVE: DOM.click('.leave'),
    SET_DRAFT: DOM.input('input[name="text"]').value(),
    SEND: DOM.select('.composer').events('submit', { preventDefault: true }),
  })
  // the recipe
  const room = (id) => id && { socket: `/ws/rooms/${id}`, message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED',
    reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false } }
  Chat.connections = (state) => ({ room: room(state.room) })
  Chat.model = {
    JOIN: (state, id) => id === state.room ? ABORT : { ...state, room: id, status: 'connecting', messages: [] },
    LEAVE: (state) => ({ ...state, room: null, status: 'offline', messages: [] }),
    SET_DRAFT: (state, draft) => ({ ...state, draft }),
    SEND: {
      STATE: (state) => state.draft.trim() ? { ...state, draft: '' } : ABORT,
      WS: (state) => state.draft.trim() ? { to: 'room', json: { text: state.draft } } : ABORT,
    },
    RECEIVED: (state, msg) => ({ ...state, messages: [...state.messages, msg] }),
    CONNECTED: (state) => ({ ...state, status: 'online' }),
    DROPPED: (state) => ({ ...state, status: 'reconnecting' }),
  }

  const CONNECTING = /^Connecting(…|\.\.\.)$/
  const RECONNECTING = /^Reconnecting(…|\.\.\.)$/
  const RETRY_WAIT = { timeout: 2500 }
  const PAUSE = 20
  const clickEl = async el => { el.click(); await sleep(PAUSE) }
  const typeInto = async (el, value) => {
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(PAUSE)
  }
  const boot = async () => {
    vi.stubGlobal('WebSocket', server.FakeWebSocket)
    start(Chat, { WS: makeSocketDriver() })
    await waitFor(() => expect(document.querySelector('.connection')).toBeTruthy())
  }
  const connection = () => textOf(document.querySelector('.connection'))
  const messages = () => [...document.querySelectorAll('ul.messages li')].map(li => textOf(li))
  const sendButton = () => getByText('button', 'Send')
  const textInput = () => document.querySelector('input[name="text"]')
  const join = name => clickEl(getByText('button', name))
  const say = async t => { await typeInto(textInput(), t); await clickEl(sendButton()) }
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
    if (leave) await clickEl(leave)
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
    await clickEl(getByText('button', 'Leave room'))
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
    await clickEl(getByText('button', 'Leave room'))
    await waitFor(() => expect(connection()).toBe('Not connected'))
    await sleep(1300)
    expect(server.sockets).toHaveLength(2)
  }, 10000)
})

describe('SYG112 (dev entry): a connection names an action with no model entry', () => {
  beforeEach(() => setupChecks())

  it('reports a typo in message/open/close/error/events, once, with the nearest model key', async () => {
    function Feed() { return h('p', null, 'feed') }
    Object.defineProperty(Feed, 'name', { value: 'Feed' })
    Feed.initialState = {}
    Feed.connections = () => ({
      live: { socket: '/live', message: 'RECIEVED', open: 'ONLINE' },
      prices: { sse: '/prices', events: { tick: 'TIK' } },
    })
    Feed.model = { RECEIVED: (s) => s, ONLINE: (s) => s, TICK: (s) => s }
    start(Feed, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket, EventSource: class { addEventListener() {} close() {} } }) }, { diagnostics: 'collect' })
    await settle(40)
    const found = diagnostics('SYG112')
    expect(found.map(d => d.data.action).sort()).toEqual(['RECIEVED', 'TIK'])
    expect(found.find(d => d.data.action === 'RECIEVED').data).toMatchObject({ key: 'message', suggestion: 'RECEIVED', sink: 'WS' })
    expect(found.find(d => d.data.action === 'TIK').data).toMatchObject({ suggestion: 'TICK' })
    expect(found[0].severity).toBe('error')
  })

  it('reports nothing when every name has an entry (also for { connections } sent from the model)', async () => {
    function Ok() { return h('p', null, 'ok') }
    Ok.initialState = {}
    Ok.connections = () => ({ live: { socket: '/live', message: 'GOT', close: 'DOWN' } })
    Ok.model = {
      BOOTSTRAP: { WS: () => ({ connections: { other: { socket: '/other', open: 'UP' } } }) },
      GOT: (s) => s, DOWN: (s) => s, UP: (s) => s,
    }
    start(Ok, { WS: makeSocketDriver({ WebSocket: server.FakeWebSocket }) }, { diagnostics: 'collect' })
    await settle(40)
    expect(diagnostics('SYG112')).toEqual([])
  })
})
