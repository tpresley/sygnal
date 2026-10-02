import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountApp, waitFor, textOf, click, typeInto, sleep, getByText, queryByText } from './dom.js'

const CONNECTING = /^Connecting(…|\.\.\.)$/
const RECONNECTING = /^Reconnecting(…|\.\.\.)$/
const RETRY_WAIT = { timeout: 2500 }

/**
 * A fake chat server: a WebSocket class installed on globalThis that records every
 * socket the app opens. Nothing happens on its own; the test opens, feeds, drops or
 * refuses each socket. Like a browser, a socket closed by the client stays CLOSING
 * until the server acknowledges (finishCloses()), so its close event can arrive late.
 */
function chatServer() {
  const sockets = []
  const makeEvent = (type, init = {}) => {
    if (type === 'message' && typeof MessageEvent === 'function') return new MessageEvent('message', init)
    if (type === 'close' && typeof CloseEvent === 'function') return new CloseEvent('close', init)
    return Object.assign(new Event(type), init)
  }

  class FakeWebSocket extends EventTarget {
    constructor(url, protocols) {
      super()
      const resolved = new URL(String(url), window.location.href)
      if (resolved.protocol === 'http:') resolved.protocol = 'ws:'
      if (resolved.protocol === 'https:') resolved.protocol = 'wss:'
      this.url = resolved.href
      this.protocols = protocols
      this.protocol = ''
      this.extensions = ''
      this.binaryType = 'blob'
      this.bufferedAmount = 0
      this.readyState = 0
      this.sent = []
      this.closedByClient = false
      this.onopen = null
      this.onmessage = null
      this.onerror = null
      this.onclose = null
      sockets.push(this)
    }

    get path() {
      return new URL(this.url).pathname
    }

    _fire(type, init) {
      const event = makeEvent(type, init)
      this.dispatchEvent(event)
      const handler = this[`on${type}`]
      if (typeof handler === 'function') handler.call(this, event)
    }

    send(data) {
      if (this.readyState === 0) throw new DOMException('Still in CONNECTING state.', 'InvalidStateError')
      if (this.readyState === 1) this.sent.push(data)
    }

    close(code = 1000, reason = '') {
      if (this.readyState >= 2) return
      this.closedByClient = true
      this.wasOpen = this.readyState === 1
      this.closeInit = { code, reason }
      this.readyState = 2
    }

    // ---- server side, driven by the test

    accept() {
      if (this.readyState !== 0) throw new Error(`accept(): socket ${this.url} is not connecting`)
      this.readyState = 1
      this._fire('open')
    }

    receive(payload) {
      if (this.readyState !== 1) throw new Error(`receive(): socket ${this.url} is not open`)
      this._fire('message', { data: JSON.stringify(payload) })
    }

    /** The connection drops (open), or fails to open (connecting): error + abnormal close. */
    drop() {
      if (this.readyState > 1) throw new Error(`drop(): socket ${this.url} is already closing`)
      const wasConnecting = this.readyState === 0
      this.readyState = 3
      if (wasConnecting) this._fire('error')
      this._fire('close', { code: 1006, reason: '', wasClean: false })
    }

    finishClose() {
      if (this.readyState !== 2) return
      this.readyState = 3
      if (!this.wasOpen) this._fire('error')
      this._fire('close', this.wasOpen ? { ...this.closeInit, wasClean: true } : { code: 1006, reason: '', wasClean: false })
    }
  }
  Object.assign(FakeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
  Object.assign(FakeWebSocket.prototype, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })

  return {
    FakeWebSocket,
    sockets,
    finishCloses: () => sockets.forEach((s) => s.finishClose()),
  }
}

let server

async function start() {
  server = chatServer()
  vi.stubGlobal('WebSocket', server.FakeWebSocket)
  await mountApp()
  return server
}

afterEach(async () => {
  // Leave politely, so a retry timer of this test's app can't open a socket in the next test.
  const leave = queryByText('button', 'Leave room')
  if (leave) await click(leave)
  vi.unstubAllGlobals()
})

const connection = () => textOf(document.querySelector('.connection'))
const messages = () => [...document.querySelectorAll('ul.messages li')].map((li) => textOf(li).replace(/\s+:/g, ':'))
const sendButton = () => getByText('button', 'Send')
const textInput = () => document.querySelector('input[name="text"]')

async function join(room) {
  await click(getByText('button', room))
}

async function say(text) {
  await typeInto(textInput(), text)
  await click(sendButton())
}

/** Join a room and accept its connection; returns the socket. */
async function joinOnline(room) {
  const before = server.sockets.length
  await join(room)
  await waitFor(() => expect(server.sockets).toHaveLength(before + 1))
  const socket = server.sockets[before]
  socket.accept()
  await waitFor(() => expect(connection()).toBe('Online'))
  return socket
}

describe('22 chat socket: one connection per room, status, messages, reconnect', () => {
  it('joining a room opens one WebSocket to /ws/rooms/<room> and shows its status', async () => {
    await start()
    expect(connection()).toBe('Not connected')
    await sleep(100)
    expect(server.sockets).toHaveLength(0)

    await join('General')
    await waitFor(() => expect(server.sockets).toHaveLength(1))
    const socket = server.sockets[0]
    const url = new URL(socket.url)
    expect(url.protocol).toBe('ws:')
    expect(url.host).toBe(window.location.host)
    expect(url.pathname).toBe('/ws/rooms/general')
    await waitFor(() => expect(connection()).toMatch(CONNECTING))
    expect(sendButton().disabled).toBe(true)

    socket.accept()
    await waitFor(() => expect(connection()).toBe('Online'))
    expect(sendButton().disabled).toBe(false)

    // Clicking the current room again changes nothing.
    await join('General')
    await sleep(100)
    expect(server.sockets).toHaveLength(1)
    expect(socket.closedByClient).toBe(false)
    expect(connection()).toBe('Online')
  })

  it('lists received messages and sends typed ones as JSON, without adding them itself', async () => {
    await start()
    const socket = await joinOnline('General')
    socket.receive({ user: 'ana', text: 'hi' })
    socket.receive({ user: 'bo', text: 'hello there' })
    await waitFor(() => expect(messages()).toEqual(['ana: hi', 'bo: hello there']))

    await say('Good morning')
    await waitFor(() => expect(socket.sent).toHaveLength(1))
    expect(typeof socket.sent[0]).toBe('string')
    expect(JSON.parse(socket.sent[0])).toMatchObject({ text: 'Good morning' })
    await waitFor(() => expect(textInput().value).toBe(''))
    await sleep(100)
    expect(messages()).toEqual(['ana: hi', 'bo: hello there'])

    socket.receive({ user: 'me', text: 'Good morning' })
    await waitFor(() => expect(messages()).toEqual(['ana: hi', 'bo: hello there', 'me: Good morning']))

    await say('   ')
    await sleep(100)
    expect(socket.sent).toHaveLength(1)
  })

  it('switching rooms closes the old connection, opens the new one and clears the list', async () => {
    await start()
    const general = await joinOnline('General')
    general.receive({ user: 'ana', text: 'in general' })
    await waitFor(() => expect(messages()).toEqual(['ana: in general']))

    await join('Random')
    await waitFor(() => expect(server.sockets).toHaveLength(2))
    const random = server.sockets[1]
    expect(random.path).toBe('/ws/rooms/random')
    await waitFor(() => expect(general.closedByClient).toBe(true))
    await waitFor(() => expect(connection()).toMatch(CONNECTING))
    expect(messages()).toEqual([])

    random.accept()
    await waitFor(() => expect(connection()).toBe('Online'))
    // The old connection's close event arrives only now, after the new one is open.
    server.finishCloses()
    await sleep(1300)
    expect(connection()).toBe('Online')
    expect(server.sockets).toHaveLength(2)

    random.receive({ user: 'bo', text: 'in random' })
    await waitFor(() => expect(messages()).toEqual(['bo: in random']))
    await say('hey')
    await waitFor(() => expect(random.sent).toHaveLength(1))
    expect(general.sent).toHaveLength(0)
  })

  it('"Leave room" closes the connection for good; joining again starts fresh', async () => {
    await start()
    const socket = await joinOnline('Random')
    socket.receive({ user: 'ana', text: 'bye' })
    await waitFor(() => expect(messages()).toEqual(['ana: bye']))

    await click(getByText('button', 'Leave room'))
    await waitFor(() => expect(socket.closedByClient).toBe(true))
    await waitFor(() => expect(connection()).toBe('Not connected'))
    server.finishCloses()
    await sleep(1300)
    expect(server.sockets).toHaveLength(1)
    expect(connection()).toBe('Not connected')

    await join('Random')
    await waitFor(() => expect(server.sockets).toHaveLength(2))
    expect(server.sockets[1].path).toBe('/ws/rooms/random')
    await waitFor(() => expect(connection()).toMatch(CONNECTING))
    expect(messages()).toEqual([])
  })

  it('a dropped connection shows "Reconnecting…" and retries every second until one opens', async () => {
    await start()
    const first = await joinOnline('General')
    first.receive({ user: 'ana', text: 'before the drop' })
    await waitFor(() => expect(messages()).toEqual(['ana: before the drop']))

    first.drop()
    await waitFor(() => expect(connection()).toMatch(RECONNECTING))
    expect(sendButton().disabled).toBe(true)
    await sleep(600)
    expect(server.sockets).toHaveLength(1)
    await waitFor(() => expect(server.sockets).toHaveLength(2), RETRY_WAIT)
    const second = server.sockets[1]
    expect(second.path).toBe('/ws/rooms/general')
    await sleep(100)
    expect(connection()).toMatch(RECONNECTING)

    // The retry fails to open: still reconnecting, and another retry a second later.
    second.drop()
    await sleep(600)
    expect(server.sockets).toHaveLength(2)
    expect(connection()).toMatch(RECONNECTING)
    await waitFor(() => expect(server.sockets).toHaveLength(3), RETRY_WAIT)
    const third = server.sockets[2]
    expect(third.path).toBe('/ws/rooms/general')
    third.accept()
    await waitFor(() => expect(connection()).toBe('Online'))
    expect(messages()).toEqual(['ana: before the drop'])

    await say('back again')
    await waitFor(() => expect(third.sent).toHaveLength(1))
    await sleep(1200)
    expect(server.sockets).toHaveLength(3)
  })

  it('a first connection that fails to open is retried too', async () => {
    await start()
    await join('Random')
    await waitFor(() => expect(server.sockets).toHaveLength(1))
    server.sockets[0].drop()
    await waitFor(() => expect(connection()).toMatch(RECONNECTING))
    await waitFor(() => expect(server.sockets).toHaveLength(2), RETRY_WAIT)
    expect(server.sockets[1].path).toBe('/ws/rooms/random')
    server.sockets[1].accept()
    await waitFor(() => expect(connection()).toBe('Online'))
    expect(sendButton().disabled).toBe(false)
  })

  it('switching rooms or leaving cancels a pending retry', async () => {
    await start()
    const general = await joinOnline('General')
    general.drop()
    await waitFor(() => expect(connection()).toMatch(RECONNECTING))

    await join('Random')
    await waitFor(() => expect(server.sockets).toHaveLength(2))
    const random = server.sockets[1]
    expect(random.path).toBe('/ws/rooms/random')
    await waitFor(() => expect(connection()).toMatch(CONNECTING))
    random.accept()
    await waitFor(() => expect(connection()).toBe('Online'))
    await sleep(1300)
    expect(server.sockets).toHaveLength(2)
    expect(connection()).toBe('Online')

    random.drop()
    await waitFor(() => expect(connection()).toMatch(RECONNECTING))
    await click(getByText('button', 'Leave room'))
    await waitFor(() => expect(connection()).toBe('Not connected'))
    await sleep(1300)
    expect(server.sockets).toHaveLength(2)
    expect(connection()).toBe('Not connected')
  })
})
