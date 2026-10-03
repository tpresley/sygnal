import { useState } from 'react'

const ROOMS = [
  { id: 'general', name: 'General' },
  { id: 'random', name: 'Random' },
]

export default function App() {
  const [room, setRoom] = useState(null)
  const [draft, setDraft] = useState('')
  const current = ROOMS.find((r) => r.id === room)

  const send = (e) => {
    e.preventDefault()
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
      <p className="connection">Not connected</p>
      {current && (
        <section className="room-panel">
          <h2>{`#${current.id}`}</h2>
          <button className="leave" onClick={() => setRoom(null)}>
            Leave room
          </button>
          <ul className="messages"></ul>
          <form className="composer" onSubmit={send}>
            <input name="text" placeholder="Message" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit">Send</button>
          </form>
        </section>
      )}
    </div>
  )
}
