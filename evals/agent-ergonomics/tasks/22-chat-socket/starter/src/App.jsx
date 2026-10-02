const ROOMS = [
  { id: 'general', name: 'General' },
  { id: 'random', name: 'Random' },
]

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
      <p className="connection">Not connected</p>
      {current && (
        <section className="room-panel">
          <h2>{`#${current.id}`}</h2>
          <button className="leave">Leave room</button>
          <ul className="messages"></ul>
          <form className="composer">
            <input name="text" placeholder="Message" value={state.draft} />
            <button type="submit">Send</button>
          </form>
        </section>
      )}
    </div>
  )
}

App.initialState = {
  room: null,
  draft: '',
}

App.intent = ({ DOM }) => ({
  JOIN: DOM.click('.room').map((e) => e.target.dataset.room),
  LEAVE: DOM.click('.leave'),
  SET_DRAFT: DOM.input('input[name="text"]').value(),
  SEND: DOM.select('.composer').events('submit', { preventDefault: true }),
})

App.model = {
  JOIN: (state, room) => ({ ...state, room }),
  LEAVE: (state) => ({ ...state, room: null }),
  SET_DRAFT: (state, draft) => ({ ...state, draft }),
  SEND: (state) => ({ ...state, draft: '' }),
}

export default App
