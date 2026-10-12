import { ABORT } from 'sygnal'
function Chat({ state }) {
  return <div><p className="status">{state.status}</p><ul>{state.messages.map(m => <li>{m.text}</li>)}</ul><input className="draft" aria-label="Message" value={state.draft} /><button className="send">Send</button><button className="leave">Leave</button></div>
}
Chat.initialState = { room: 'general', status: 'connecting', messages: [], draft: '' }
Chat.connections = (state) => ({   // from state, diffed by name: new opens, falsy/removed closes, changed URL reconnects
  room: state.room && { socket: `/ws/rooms/${state.room}`, message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED',
    reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false } },   // fixed 1 s retry (default: 500 ms doubling to 10 s, ±20%)
})
Chat.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value(), SEND: DOM.click('.send'), LEAVE: DOM.click('.leave') })
Chat.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  SEND: {
    STATE: (state) => (state.draft.trim() ? { ...state, draft: '' } : ABORT),
    WS:    (state) => (state.draft.trim() ? { to: 'room', json: { text: state.draft } } : ABORT),  // queued while (re)connecting
  },
  LEAVE:     (state) => ({ ...state, room: null, status: 'offline', messages: [] }),   // closes it: no DROPPED
  RECEIVED:  (state, msg) => ({ ...state, messages: [...state.messages, msg] }),        // the JSON-parsed frame
  CONNECTED: (state) => ({ ...state, status: 'online' }),                               // data: { reconnected }
  DROPPED:   (state, { willReconnect }) => ({ ...state, status: willReconnect ? 'reconnecting' : 'offline' }),  // { code, reason, willReconnect }
}

export { Chat }
