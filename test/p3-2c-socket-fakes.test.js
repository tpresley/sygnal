// @vitest-environment jsdom
// PLAN-3 2-C: renderComponent's fake source behaves like makeSocketDriver for a sink that gets
// { connections } / { to } values (no driver passed, no option): connections are diffed per
// (sender, name), open / message / close / error are routed to the sender's action names, the
// app's own closes send no close action, and unrouted events reach select(name?).
// t.connections / t.open / t.push / t.drop / t.sent script it; like t.respond (G-140) each call
// throws at the call when nothing matches and returns a promise for the rendered result.
// Until 2-B's `connections` static lands, { connections } is sent from a model sink, built
// from the action data (G-146).
import { describe, it, expect, afterEach, vi } from 'vitest'

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/index.js'
import { ABORT } from '../src/component.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  _resetDiagnostics()
})

const roomSpec = id => ({
  socket: `/ws/rooms/${id}`,
  message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED', error: 'FAILED',
  reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false },
})

function Chat({ state }) {
  return h('div', null,
    h('p', { className: 'status' }, state.status),
    h('ul', null, ...state.messages.map(m => h('li', null, m.text))))
}
Chat.initialState = { room: null, status: 'offline', messages: [], closes: 0, errors: 0 }
Chat.model = {
  JOIN: {
    STATE: (s, room) => ({ ...s, room, status: 'connecting', messages: [] }),
    WS: (s, room) => ({ connections: { room: roomSpec(room) } }),
  },
  LEAVE: {
    STATE: s => ({ ...s, room: null, status: 'offline', messages: [] }),
    WS: () => ({ connections: {} }),
  },
  SAY: { WS: (s, text) => ({ to: 'room', json: { text } }) },
  RECEIVED: (s, m) => ({ ...s, messages: [...s.messages, m] }),
  CONNECTED: (s, { reconnected }) => ({ ...s, status: 'online', reconnected }),
  DROPPED: (s, { code, reason, willReconnect }) => ({ ...s, status: willReconnect ? 'reconnecting' : 'offline', code, reason, closes: s.closes + 1 }),
  FAILED: s => ({ ...s, errors: s.errors + 1 }),
}

describe('socket fakes: open, push, sent', () => {
  it('a declared connection opens by itself; t.push delivers a message action; t.connections lists it', async () => {
    t = renderComponent(Chat)
    t.simulateAction('JOIN', 'general')
    await t.push('WS', { text: 'hi' })
    expect(t.state).toMatchObject({ status: 'online', reconnected: false, messages: [{ text: 'hi' }] })
    expect(t.html()).toContain('<li>hi</li>')
    const list = t.connections('WS')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'room', socket: '/ws/rooms/general', state: 'open', sender: 'Chat' })
    expect(list[0].url).toBe(`ws://${location.host}/ws/rooms/general`)
  })

  it('t.sent lists the { to, json } values; t.requests and t.sinkValues keep their meaning', async () => {
    t = renderComponent(Chat)
    t.simulateAction('JOIN', 'general')
    t.simulateAction('SAY', 'yo')
    t.simulateAction('SAY', 'again')
    await t.settle()
    expect(t.sent('WS')).toEqual([{ to: 'room', json: { text: 'yo' } }, { to: 'room', json: { text: 'again' } }])
    expect(t.sent('WS', 'room')).toHaveLength(2)
    expect(t.sent('WS', 'other')).toEqual([])
    expect(t.requests('WS')).toEqual([{ connections: { room: roomSpec('general') } }, ...t.sent('WS')])
    expect(t.sinkValues('WS')).toEqual(t.requests('WS'))
  })

  it('a text push arrives JSON-parsed when it parses, raw otherwise', async () => {
    t = renderComponent(Chat)
    t.simulateAction('JOIN', 'general')
    await t.push('WS', '{"text":"json"}')
    await t.push('WS', 'plain')
    expect(t.state.messages).toEqual([{ text: 'json' }, 'plain'])
  })

  it('autoConnect: false holds connections in "connecting" until t.open()', async () => {
    t = renderComponent(Chat, { autoConnect: false })
    t.simulateAction('JOIN', 'general')
    await t.settle()
    expect(t.state.status).toBe('connecting')
    expect(t.connections('WS')[0].state).toBe('connecting')
    expect(() => t.push('WS', { text: 'x' })).toThrow(/no open WS connection/)
    await t.open('WS')
    expect(t.state.status).toBe('online')
    expect(t.connections('WS')[0].state).toBe('open')
    expect(() => t.open('WS')).toThrow(/no connecting WS connection/)
  })
})

describe('socket fakes: closes', () => {
  it('a room switch closes the old connection with no close action and opens the new one', async () => {
    t = renderComponent(Chat)
    t.simulateAction('JOIN', 'general')
    await t.push('WS', { text: 'in general' })
    t.simulateAction('JOIN', 'random')
    await t.settle()
    expect(t.connections('WS').map(c => [c.socket, c.state])).toEqual([['/ws/rooms/random', 'open']])
    expect(t.state).toMatchObject({ status: 'online', closes: 0, messages: [] })
    expect(t.states.some(s => s.status === 'reconnecting')).toBe(false)
    // the old connection is gone: a push aimed at it throws
    expect(() => t.push('WS', { text: 'late' }, '/ws/rooms/general')).toThrow(/no open WS connection/)
    await t.push('WS', { text: 'in random' }, '/ws/rooms/random')
    expect(t.state.messages).toEqual([{ text: 'in random' }])
  })

  it('leaving closes the connection for good, with no close action', async () => {
    t = renderComponent(Chat)
    t.simulateAction('JOIN', 'general')
    await t.next(s => s.status === 'online')
    t.simulateAction('LEAVE')
    await t.settle()
    expect(t.connections('WS')).toEqual([])
    expect(t.state).toMatchObject({ status: 'offline', closes: 0 })
  })

  it('t.drop fires close with willReconnect; the fake reconnects after the fixed delay (fake timers); open says reconnected', async () => {
    vi.useFakeTimers()
    t = renderComponent(Chat)
    await t.ready()
    t.simulateAction('JOIN', 'general')
    await t.push('WS', { text: 'before' })
    await t.drop('WS', { code: 1011, reason: 'restart' })
    expect(t.state).toMatchObject({ status: 'reconnecting', code: 1011, reason: 'restart', closes: 1 })
    expect(t.connections('WS')[0].state).toBe('closed')
    await vi.advanceTimersByTimeAsync(900)
    expect(t.connections('WS')[0].state).toBe('closed')
    expect(t.state.status).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(100)
    await t.waitForState(s => s.status === 'online')
    expect(t.state).toMatchObject({ reconnected: true, messages: [{ text: 'before' }] })
    expect(t.connections('WS')[0].state).toBe('open')
  })

  it('a drop while connecting is a failure to open: error, then close, then a retry every second', async () => {
    vi.useFakeTimers()
    t = renderComponent(Chat, { autoConnect: false })
    await t.ready()
    t.simulateAction('JOIN', 'general')
    await t.drop('WS')
    expect(t.state).toMatchObject({ status: 'reconnecting', code: 1006, errors: 1, closes: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.connections('WS')[0].state).toBe('connecting')
    await t.drop('WS')
    expect(t.state).toMatchObject({ errors: 2, closes: 2 })
    await vi.advanceTimersByTimeAsync(1000)
    await t.open('WS')
    expect(t.state).toMatchObject({ status: 'online', reconnected: false })
  })

  it('reconnect: false: the dropped connection stays closed', async () => {
    function C({ state }) { return h('p', null, state.status) }
    C.initialState = { status: 'idle' }
    C.model = {
      GO: { WS: (s, url) => ({ connections: { feed: { socket: url, open: 'UP', close: 'DOWN', reconnect: false } } }) },
      UP: s => ({ ...s, status: 'up' }),
      DOWN: (s, { willReconnect }) => ({ ...s, status: willReconnect ? 'retrying' : 'down' }),
    }
    vi.useFakeTimers()
    t = renderComponent(C)
    t.simulateAction('GO', 'wss://example.test/feed')
    await t.next(s => s.status === 'up')
    expect(t.connections('WS')[0].url).toBe('wss://example.test/feed')
    await t.drop('WS', 'feed')
    expect(t.state.status).toBe('down')
    await vi.advanceTimersByTimeAsync(20000)
    expect(t.connections('WS')[0].state).toBe('closed')
    expect(() => t.push('WS', 1)).toThrow(/no open WS connection/)
  })
})

describe('socket fakes: errors at the call (G-140)', () => {
  it('throws synchronously when nothing matches; the message lists the connections', async () => {
    t = renderComponent(Chat)
    await t.settle()
    expect(() => t.push('WS', { text: 'x' })).toThrow(/no open WS connection.*declare/s)
    expect(() => t.drop('WS')).toThrow(/no open or connecting WS connection/)
    t.simulateAction('JOIN', 'general')
    await t.settle()
    expect(() => t.push('WS', { text: 'x' }, 'lobby')).toThrow(/matching 'lobby'.*room \(\/ws\/rooms\/general, open\)/s)
    expect(() => t.push('WS', 1, c => c.name === 'nope')).toThrow(/matching the predicate/)
    expect(() => t.push('WS', 1, { socket: '/ws/rooms/random' })).toThrow(/no open WS connection matching/)
    await t.push('WS', { text: 'ok' }, { socket: '/ws/rooms/general' })
    await t.push('WS', { text: 'ok2' }, c => c.name === 'room')
    expect(t.state.messages).toHaveLength(2)
  })

  it('a call made while input is still queued waits for it (no throw)', async () => {
    t = renderComponent(Chat)
    await t.ready()
    t.simulateAction('JOIN', 'general')
    const p = t.push('WS', { text: 'queued' })
    await p
    expect(t.state.messages).toEqual([{ text: 'queued' }])
  })

  it('a queued call that never matches rejects', async () => {
    t = renderComponent(Chat, { timeoutMs: 200 })
    // before ready: queued, so it waits (up to half of timeoutMs) instead of throwing
    await expect(t.push('WS', 1)).rejects.toThrow(/no open WS connection after 100ms/)
  })

  it('a sink with a real driver has nothing to script', async () => {
    const WS = () => ({ select: () => ({ addListener() {}, removeListener() {} }) })
    t = renderComponent(Chat, { drivers: { WS } })
    expect(() => t.push('WS', 1)).toThrow(/real driver/)
  })
})

describe('socket fakes: routing', () => {
  it('two Collection items: each pushed to by URL gets only its own message; dispose of one closes its connection', async () => {
    function Item({ state }) { return h('li', { className: `item-${state.id}` }, h('button', { className: 'say' }, 'say'), state.log.join(',')) }
    Item.intent = ({ DOM }) => ({ SAY: DOM.click('.say') })
    Item.model = {
      BOOTSTRAP: { WS: s => ({ connections: { room: { socket: `/ws/${s.id}`, message: 'GOT', open: 'UP' } } }) },
      SAY: { WS: s => ({ to: 'room', json: { from: s.id } }) },
      GOT: (s, m) => ({ ...s, log: [...s.log, m.text] }),
      UP: s => ({ ...s, log: [...s.log, 'up'] }),
    }
    function List() { return h('div', null, h('button', { className: 'drop-b' }, 'x'), h('ul', null, h(Collection, { of: Item, from: 'items' }))) }
    List.initialState = { items: [{ id: 'a', log: [] }, { id: 'b', log: [] }] }
    List.intent = ({ DOM }) => ({ REMOVE_B: DOM.click('.drop-b') })
    List.model = { REMOVE_B: s => ({ ...s, items: s.items.filter(i => i.id !== 'b') }) }
    t = renderComponent(List)
    await t.settle()
    expect(t.connections('WS').map(c => [c.socket, c.state, c.sender])).toEqual([['/ws/a', 'open', 'Item'], ['/ws/b', 'open', 'Item']])
    await t.push('WS', { text: 'for-a' }, '/ws/a')
    await t.push('WS', { text: 'for-b' }, { socket: '/ws/b' })
    expect(t.state.items.map(i => i.log.join(','))).toEqual(['up,for-a', 'up,for-b'])
    t.simulateEvent('.item-b .say', 'click')
    await t.settle()
    expect(t.sent('WS')).toEqual([{ to: 'room', json: { from: 'b' } }])
    // a push by name reaches every matching connection
    await t.push('WS', { text: 'all' }, 'room')
    expect(t.state.items.map(i => i.log.at(-1))).toEqual(['all', 'all'])
    t.simulateEvent('.drop-b', 'click')
    await t.settle()
    await new Promise(r => setTimeout(r, 30))
    expect(t.connections('WS').map(c => c.socket)).toEqual(['/ws/a'])
    expect(() => t.push('WS', { text: 'x' }, '/ws/b')).toThrow(/no open WS connection/)
  })

  it('two senders sharing one URL share the socket: one push reaches both', async () => {
    function Kid({ state }) { return h('span', null, state.n) }
    Kid.model = { BOOTSTRAP: { WS: () => ({ connections: { feed: { socket: '/feed', message: 'TICK' } } }) }, TICK: s => ({ ...s, n: s.n + 1 }) }
    function Two({ state }) { return h('div', null, h('b', null, state.n), h(Kid, { state: 'kid' })) }
    Two.initialState = { n: 0, kid: { n: 0 } }
    Two.model = { BOOTSTRAP: { WS: () => ({ connections: { feed: { socket: '/feed', message: 'TICK' } } }) }, TICK: s => ({ ...s, n: s.n + 1 }) }
    t = renderComponent(Two)
    await t.settle()
    expect(t.connections('WS').map(c => [c.sender, c.state])).toEqual([['Two', 'open'], ['Kid', 'open']])
    await t.push('WS', 'x')
    expect(t.state).toMatchObject({ n: 1, kid: { n: 1 } })
  })

  it('unrouted events (no action name) reach WS.select(name)', async () => {
    function U({ state }) { return h('p', null, state.got.join(',')) }
    U.initialState = { got: [] }
    U.intent = ({ WS }) => ({ GOT: WS.select('news') })
    U.model = {
      BOOTSTRAP: { WS: () => ({ connections: { news: { sse: '/events' } } }) },
      GOT: (s, e) => ({ ...s, got: [...s.got, `${e.name}:${e.type}:${JSON.stringify(e.data ?? null)}`] }),
    }
    t = renderComponent(U)
    await t.settle()
    expect(t.connections('WS')[0]).toMatchObject({ name: 'news', sse: '/events', url: '/events', state: 'open' })
    await t.push('WS', { a: 1 })
    expect(t.state.got).toEqual(['news:open:{"reconnected":false}', 'news:message:{"a":1}'])
  })

  it('SSE named events: t.push(name, data, { event })', async () => {
    function P({ state }) { return h('p', null, state.price) }
    P.initialState = { price: 0 }
    P.model = {
      BOOTSTRAP: { WS: () => ({ connections: { prices: { sse: '/prices', events: { price: 'PRICE' } } } }) },
      PRICE: (s, p) => ({ ...s, price: p.value }),
    }
    t = renderComponent(P)
    await t.settle()
    await t.push('WS', { value: 42 }, { event: 'price' })
    expect(t.state.price).toBe(42)
    await t.push('WS', { value: 7 }, { event: 'price', connection: 'prices' })
    expect(t.state.price).toBe(7)
  })

  it('dispose closes every connection', async () => {
    t = renderComponent(Chat)
    t.simulateAction('JOIN', 'general')
    await t.next(s => s.status === 'online')
    expect(t.connections('WS')).toHaveLength(1)
    t.dispose()
    expect(t.connections('WS')).toEqual([])
    t = null
  })
})

// ---------------------------------------------------------------------------------------------
// Task 22 (evals/agent-ergonomics/tasks/22-chat-socket), the 2-A port's component, tested only
// through renderComponent and the fake (no WebSocket stub, no driver)
describe('task 22 (chat socket) through the fake', () => {
  const ROOMS = [{ id: 'general', name: 'General' }, { id: 'random', name: 'Random' }]
  const STATUS_TEXT = { offline: 'Not connected', connecting: 'Connecting…', online: 'Online', reconnecting: 'Reconnecting…' }
  const chatRoom = id => ({
    socket: `/ws/rooms/${id}`,
    message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED',
    reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false },
  })
  function App({ state }) {
    const current = ROOMS.find(r => r.id === state.room)
    return h('div', { className: 'chat' },
      h('nav', { className: 'rooms' }, ...ROOMS.map(r => h('button', { className: `room ${r.id}`, 'data-room': r.id }, r.name))),
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
  const isBlank = s => s.trim() === ''
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
  const connection = () => t.html().match(/<p class="connection">([^<]*)<\/p>/)[1]
  const messages = () => [...t.html().matchAll(/<li>([^<]*)<\/li>/g)].map(m => m[1])
  const sendDisabled = () => /<button type="submit" disabled/.test(t.html())
  const joinOnline = async id => {
    t.simulateEvent(`.room.${id}`, 'click')
    await t.open('WS', `/ws/rooms/${id}`)
    expect(connection()).toBe('Online')
  }
  const say = async text => {
    t.simulateEvent('input[name="text"]', 'input', { value: text })
    t.simulateEvent('.composer', 'submit')
    await t.settle()
  }

  it('joining opens one connection to /ws/rooms/<room>; status; the current room again changes nothing', async () => {
    t = renderComponent(App, { autoConnect: false })
    await t.ready()
    expect(connection()).toBe('Not connected')
    t.simulateEvent('.room.general', 'click')
    await t.settle()
    expect(t.connections('WS')).toEqual([expect.objectContaining({ name: 'room', url: `ws://${location.host}/ws/rooms/general`, state: 'connecting' })])
    expect(connection()).toBe('Connecting…')
    expect(sendDisabled()).toBe(true)
    await t.open('WS')
    expect(connection()).toBe('Online')
    t.simulateEvent('.room.general', 'click')
    await t.settle()
    expect(t.connections('WS')).toHaveLength(1)
    expect(t.sinkValues('WS')).toHaveLength(1)
  })

  it('lists received messages and sends typed ones as JSON; blank input sends nothing', async () => {
    t = renderComponent(App, { autoConnect: false })
    await joinOnline('general')
    await t.push('WS', { user: 'ana', text: 'hi' })
    expect(messages()).toEqual(['ana: hi'])
    await say('Good morning')
    expect(t.sent('WS')).toEqual([{ to: 'room', json: { text: 'Good morning' } }])
    expect(t.state.draft).toBe('')
    await say('   ')
    expect(t.sent('WS')).toHaveLength(1)
  })

  it('switching rooms closes the old connection, opens the new one; no status change from the close', async () => {
    t = renderComponent(App, { autoConnect: false })
    await joinOnline('general')
    await t.push('WS', { user: 'ana', text: 'in general' })
    t.simulateEvent('.room.random', 'click')
    await t.settle()
    expect(t.connections('WS').map(c => [c.socket, c.state])).toEqual([['/ws/rooms/random', 'connecting']])
    expect(messages()).toEqual([])
    expect(connection()).toBe('Connecting…')
    await t.open('WS')
    await say('hey')
    expect(t.sent('WS')).toEqual([{ to: 'room', json: { text: 'hey' } }])
    expect(t.states.some(s => s.status === 'reconnecting')).toBe(false)
  })

  it('"Leave room" closes the connection for good', async () => {
    vi.useFakeTimers()
    t = renderComponent(App, { autoConnect: false })
    await joinOnline('random')
    t.simulateEvent('.leave', 'click')
    await t.settle()
    expect(t.connections('WS')).toEqual([])
    expect(connection()).toBe('Not connected')
    await vi.advanceTimersByTimeAsync(1300)
    expect(t.connections('WS')).toEqual([])
    expect(connection()).toBe('Not connected')
  })

  it('a dropped connection shows "Reconnecting…" and retries every second until one opens', async () => {
    vi.useFakeTimers()
    t = renderComponent(App, { autoConnect: false })
    await joinOnline('general')
    await t.push('WS', { user: 'ana', text: 'before the drop' })
    await t.drop('WS')
    expect(connection()).toBe('Reconnecting…')
    expect(sendDisabled()).toBe(true)
    await vi.advanceTimersByTimeAsync(600)
    expect(t.connections('WS')[0].state).toBe('closed')
    await vi.advanceTimersByTimeAsync(400)
    expect(t.connections('WS')[0].state).toBe('connecting')
    await t.drop('WS')                       // the retry fails to open
    await vi.advanceTimersByTimeAsync(600)
    expect(t.connections('WS')[0].state).toBe('closed')
    expect(connection()).toBe('Reconnecting…')
    await vi.advanceTimersByTimeAsync(400)
    await t.open('WS')
    expect(connection()).toBe('Online')
    expect(messages()).toEqual(['ana: before the drop'])
    await say('back again')
    expect(t.sent('WS')).toEqual([{ to: 'room', json: { text: 'back again' } }])
  })

  it('switching rooms or leaving cancels a pending retry', async () => {
    vi.useFakeTimers()
    t = renderComponent(App, { autoConnect: false })
    await joinOnline('general')
    await t.drop('WS')
    expect(connection()).toBe('Reconnecting…')
    t.simulateEvent('.room.random', 'click')
    await t.open('WS', '/ws/rooms/random')
    expect(connection()).toBe('Online')
    await vi.advanceTimersByTimeAsync(1300)
    expect(t.connections('WS').map(c => [c.socket, c.state])).toEqual([['/ws/rooms/random', 'open']])
    await t.drop('WS')
    expect(connection()).toBe('Reconnecting…')
    t.simulateEvent('.leave', 'click')
    await t.settle()
    expect(connection()).toBe('Not connected')
    await vi.advanceTimersByTimeAsync(1300)
    expect(t.connections('WS')).toEqual([])
  })
})
