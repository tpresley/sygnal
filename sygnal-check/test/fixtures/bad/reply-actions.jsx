// Reply actions (PLAN-3): the ok/error names of a request are triggers (SYG102),
// and each one must name a model entry of the same component (SYG112).

function Quote({ state }) {
  return (
    <div>
      <button className="load">load</button>
      <p>{state.status}</p>
    </div>
  )
}

Quote.initialState = { status: 'idle' }

Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })

Quote.model = {
  LOAD: {
    STATE: (state) => ({ ...state, status: 'loading' }),
    HTTP: (state) => ({ url: `/api/quotes/${state.id}`, ok: 'LOADED', error: 'FIALED' }), // expect: SYG112 error
  },
  LOADED: (state, quote) => ({ ...state, status: 'done', quote }),
  FAILED: (state) => ({ ...state, status: 'error' }), // expect: SYG102
  // HYDRATE is not a built-in action any more (6.0): nothing triggers it here
  HYDRATE: (state, data) => ({ ...state, ...data }), // expect: SYG102
}

// connections (PLAN-3 §1.3): message/open/close/error name actions too
function Chat({ state }) {
  return <ul className="messages">{state.messages.map(m => <li>{m}</li>)}</ul>
}

Chat.initialState = { roomId: 'lobby', messages: [], online: false }

Chat.connections = (state) => ({
  room: state.roomId && {
    socket: `/ws/rooms/${state.roomId}`,
    message: 'RECEIVED',
    open: 'CONNECTED',
    close: 'DISCONECTED', // expect: SYG112 error
  },
})

Chat.model = {
  RECEIVED: (state, msg) => ({ ...state, messages: [...state.messages, msg] }),
  CONNECTED: (state) => ({ ...state, online: true }),
  DISCONNECTED: (state) => ({ ...state, online: false }), // expect: SYG102
}

export default Quote
