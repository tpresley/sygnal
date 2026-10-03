// @vitest-environment jsdom
// PLAN-3 G-160: the Component.connections static (2-B) under renderComponent with no driver (the
// 2-C socket fake), using the testing docs' Chat sample verbatim.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement } from '../src/pragma/index.js'

function Chat({ state }) {
  return createElement('div', null,
    createElement('p', { className: 'status' }, state.status),
    createElement('ul', null, ...state.messages.map(m => createElement('li', null, m.text))))
}
Chat.initialState = { room: 'general', status: 'connecting', messages: [] }
Chat.connections = (state) => ({
  room: {
    socket: `/ws/rooms/${state.room}`,
    message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED',
    reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false },
  },
})
Chat.model = {
  SAY: { WS: (state, text) => ({ to: 'room', json: { text } }) },
  RECEIVED: (state, msg) => ({ ...state, messages: [...state.messages, msg] }),
  CONNECTED: (state) => ({ ...state, status: 'online' }),
  DROPPED: (state) => ({ ...state, status: 'reconnecting' }),
}

let t
afterEach(() => { if (t) t.dispose(); t = null; vi.useRealTimers() })

describe('G-160: connections static with the socket fake', () => {
  it('runs the testing docs sample', async () => {
    vi.useFakeTimers()
    t = renderComponent(Chat)
    await t.push('WS', { text: 'hi' })
    expect(t.html()).toContain('<li>hi</li>')
    expect(t.connections('WS')[0]).toMatchObject({ name: 'room', socket: '/ws/rooms/general', state: 'open' })

    t.simulateAction('SAY', 'hello')
    await t.settle()
    expect(t.sent('WS')).toEqual([{ to: 'room', json: { text: 'hello' } }])

    await t.drop('WS', { code: 1011 })
    expect(t.state.status).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1000)
    await t.waitForState(s => s.status === 'online')
  })

  it('a room switch through state reconnects without a close action', async () => {
    const Rooms = Object.assign((p) => Chat(p), Chat, {
      model: { ...Chat.model, JOIN: (state, room) => ({ ...state, room, messages: [] }) },
    })
    t = renderComponent(Rooms)
    await t.waitForState(s => s.status === 'online')
    t.simulateAction('JOIN', 'random')
    await t.waitForState(s => s.room === 'random')
    await t.settle()
    expect(t.connections('WS').map(c => c.socket)).toEqual(['/ws/rooms/random'])
    expect(t.states.some(s => s.status === 'reconnecting')).toBe(false)
  })
})

describe('G-160: socketSink', () => {
  it('a read-only SSE component (no model entry names the sink) still gets the fake', async () => {
    function Feed({ state }) { return createElement('p', null, String(state.price)) }
    Feed.initialState = { price: 0 }
    Feed.connections = () => ({ prices: { sse: '/events/prices', events: { price: 'PRICE' } } })
    Feed.model = { PRICE: (state, price) => ({ ...state, price }) }
    t = renderComponent(Feed)
    await t.push('WS', 42, { event: 'price' })
    expect(t.state.price).toBe(42)
  })

  it('another sink name with { socketSink }', async () => {
    const Sock = Object.assign((p) => Chat(p), Chat, {
      model: { ...Chat.model, SAY: { SOCKET: (state, text) => ({ to: 'room', json: { text } }) } },
    })
    t = renderComponent(Sock, { socketSink: 'SOCKET' })
    await t.push('SOCKET', { text: 'yo' })
    expect(t.html()).toContain('<li>yo</li>')
  })

  it('an HTTP fake next to it gets no connections', async () => {
    const Both = Object.assign((p) => Chat(p), Chat, {
      model: { ...Chat.model, LOAD: { HTTP: () => ({ url: '/api/x', ok: 'RECEIVED' }) } },
    })
    t = renderComponent(Both)
    await t.waitForState(s => s.status === 'online')
    expect(t.connections('HTTP')).toEqual([])
    expect(t.connections('WS')).toHaveLength(1)
  })
})
