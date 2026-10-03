import { useEffect, useRef, useState } from 'react'

const ROOMS = [
  { id: 'general', name: 'General' },
  { id: 'random', name: 'Random' },
]

const RETRY_MS = 1000

const STATUS_TEXT = {
  offline: 'Not connected',
  connecting: 'Connecting…',
  online: 'Online',
  reconnecting: 'Reconnecting…',
}

const roomUrl = (room) =>
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/rooms/${room}`

export default function App() {
  const [room, setRoom] = useState(null)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('offline')
  const [messages, setMessages] = useState([])
  const socketRef = useRef(null)
  const current = ROOMS.find((r) => r.id === room)

  // One connection per joined room: the cleanup closes it and cancels a pending retry,
  // and handlers of a cleaned-up connection do nothing.
  useEffect(() => {
    if (!room) {
      setStatus('offline')
      return undefined
    }
    let active = true
    let socket = null
    let retry = null
    setMessages([])
    setStatus('connecting')

    const connect = () => {
      const ws = new WebSocket(roomUrl(room))
      socket = ws
      socketRef.current = ws
      ws.onopen = () => {
        if (active) setStatus('online')
      }
      ws.onmessage = (event) => {
        if (!active) return
        try {
          const message = JSON.parse(event.data)
          setMessages((list) => [...list, message])
        } catch {
          // not JSON: ignore
        }
      }
      ws.onclose = () => {
        if (!active) return
        setStatus('reconnecting')
        retry = setTimeout(connect, RETRY_MS)
      }
    }
    connect()

    return () => {
      active = false // mutant: a pending retry is left running
      socketRef.current = null
      socket.close()
    }
  }, [room])

  const send = (e) => {
    e.preventDefault()
    if (draft.trim() === '') return
    const socket = socketRef.current
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ text: draft }))
    setDraft('')
  }

  return (
    <div className="chat">
      <h1>Team chat</h1>
      <nav className="rooms">
        {ROOMS.map((r) => (
          <button key={r.id} className={r.id === room ? 'room current' : 'room'} onClick={() => setRoom(r.id)}>
            {r.name}
          </button>
        ))}
      </nav>
      <p className="connection">{STATUS_TEXT[status]}</p>
      {current && (
        <section className="room-panel">
          <h2>{`#${current.id}`}</h2>
          <button className="leave" onClick={() => setRoom(null)}>
            Leave room
          </button>
          <ul className="messages">
            {messages.map((message, i) => (
              <li key={i}>{`${message.user}: ${message.text}`}</li>
            ))}
          </ul>
          <form className="composer" onSubmit={send}>
            <input name="text" placeholder="Message" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" disabled={status !== 'online'}>
              Send
            </button>
          </form>
        </section>
      )}
    </div>
  )
}
