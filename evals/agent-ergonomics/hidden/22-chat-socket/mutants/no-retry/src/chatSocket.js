import { xs } from 'sygnal'

const RETRY_MS = 1000

const roomUrl = (room) =>
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/rooms/${room}`

/**
 * One chat connection at a time.
 * Commands: { join: room } (a no-op for the current room), { leave: true }, { send: payload }.
 * Events (select(type)): 'open', 'dropped' (closed without us closing it; a retry follows
 * after RETRY_MS) and 'message' ({ message }: the parsed JSON frame).
 * Events of a socket the driver no longer owns are ignored, so a late close of a
 * socket we closed ourselves changes nothing.
 */
export function chatSocketDriver(command$) {
  const event$ = xs.create()
  const emit = (event) => event$.shamefullySendNext(event)
  let room = null
  let socket = null
  let retry = null

  function connect() {
    const ws = new WebSocket(roomUrl(room))
    socket = ws
    ws.onopen = () => {
      if (socket === ws) emit({ type: 'open' })
    }
    ws.onmessage = (event) => {
      if (socket !== ws) return
      try {
        emit({ type: 'message', message: JSON.parse(event.data) })
      } catch {
        // not JSON: ignore
      }
    }
    ws.onclose = () => {
      if (socket !== ws) return
      socket = null
      emit({ type: 'dropped' }) // mutant: no retry
    }
  }

  function disconnect() {
    clearTimeout(retry)
    retry = null
    const ws = socket
    socket = null
    ws?.close()
  }

  command$.addListener({
    next(command) {
      if (command.join !== undefined) {
        if (command.join === room) return
        disconnect()
        room = command.join
        connect()
      } else if (command.leave) {
        disconnect()
        room = null
      } else if (command.send !== undefined && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(command.send))
      }
    },
    error() {},
    complete() {
      disconnect()
    },
  })

  return { select: (type) => event$.filter((event) => event.type === type) }
}
