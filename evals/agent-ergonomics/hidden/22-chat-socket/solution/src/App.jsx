import { ABORT } from 'sygnal'

const ROOMS = [
  { id: 'general', name: 'General' },
  { id: 'random', name: 'Random' },
]

const STATUS_TEXT = {
  offline: 'Not connected',
  connecting: 'Connecting…',
  online: 'Online',
  reconnecting: 'Reconnecting…',
}

function App({ state }) {
  const current = ROOMS.find((room) => room.id === state.room)
  return (
    <div className="chat">
      <h1>Team chat</h1>
      <nav className="rooms">
        {ROOMS.map((room) => (
          <button className={room.id === state.room ? 'room current' : 'room'} data-room={room.id}>
            {room.name}
          </button>
        ))}
      </nav>
      <p className="connection">{STATUS_TEXT[state.status]}</p>
      {current && (
        <section className="room-panel">
          <h2>{`#${current.id}`}</h2>
          <button className="leave">Leave room</button>
          <ul className="messages">
            {state.messages.map((message) => (
              <li>{`${message.user}: ${message.text}`}</li>
            ))}
          </ul>
          <form className="composer">
            <input name="text" placeholder="Message" value={state.draft} />
            <button type="submit" disabled={state.status !== 'online'}>
              Send
            </button>
          </form>
        </section>
      )}
    </div>
  )
}

// status: 'offline' | 'connecting' | 'online' | 'reconnecting'
App.initialState = {
  room: null,
  status: 'offline',
  messages: [],
  draft: '',
}

App.intent = ({ DOM, CHAT }) => ({
  JOIN: DOM.click('.room').map((e) => e.target.dataset.room),
  LEAVE: DOM.click('.leave'),
  SET_DRAFT: DOM.input('input[name="text"]').value(),
  SEND: DOM.select('.composer').events('submit', { preventDefault: true }),
  OPENED: CHAT.select('open'),
  DROPPED: CHAT.select('dropped'),
  RECEIVED: CHAT.select('message').map((event) => event.message),
})

const isBlank = (text) => text.trim() === ''

App.model = {
  JOIN: {
    STATE: (state, room) => (room === state.room ? ABORT : { ...state, room, status: 'connecting', messages: [] }),
    CHAT: (state, room) => (room === state.room ? ABORT : { join: room }),
  },
  LEAVE: {
    STATE: (state) => ({ ...state, room: null, status: 'offline', messages: [] }),
    CHAT: () => ({ leave: true }),
  },
  SET_DRAFT: (state, draft) => ({ ...state, draft }),
  SEND: {
    STATE: (state) => (isBlank(state.draft) ? ABORT : { ...state, draft: '' }),
    CHAT: (state) => (isBlank(state.draft) || state.status !== 'online' ? ABORT : { send: { text: state.draft } }),
  },
  OPENED: (state) => ({ ...state, status: 'online' }),
  DROPPED: (state) => ({ ...state, status: 'reconnecting' }),
  RECEIVED: (state, message) => ({ ...state, messages: [...state.messages, message] }),
}

export default App
