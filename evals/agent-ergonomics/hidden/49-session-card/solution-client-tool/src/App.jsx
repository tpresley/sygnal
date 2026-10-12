// Alternative reference: ask_user as the app's own client tool (no catalog): its open calls
// render the program's sessions as buttons, and a click answers with TOOL_OUTPUT.
import { chat, messageText } from 'sygnal/ai'
import { SESSIONS } from './data.js'

const INSTRUCTIONS = [
  'You are the assistant of the DevConf 2026 page. You help the user find their way around the program and choose the session they will attend.',
  'The app state lists the sessions with their ids, titles, times and rooms: quote only those.',
  'Keep replies short: one to three sentences.',
].join(' ')

const ASK_USER = {
  description: 'Ask the user to pick a session; the app shows the sessions as buttons. Say in one sentence what you need.',
  inputSchema: {
    type: 'object',
    properties: { need: { type: 'string', description: 'What you need from the user, in one sentence' } },
    required: ['need'],
    additionalProperties: false,
  },
}

function card(p, state) {
  const answered = p.state === 'output-available' ? p.output?.sessionId : null
  return (
    <div className="ask-card">
      <p className="need">{p.input?.need}</p>
      <ul>
        {state.sessions.map((s) => (
          <li>
            <button type="button" className="pick" data={{ call: p.toolCallId, id: s.id }} disabled={p.state !== 'input-available'}>
              {answered === s.id ? `${s.title} ✓` : s.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function App({ state }) {
  const a = state.assistant
  const busy = a.status === 'submitted' || a.status === 'streaming'
  const mine = state.sessions.find((s) => s.id === state.mySession)
  return (
    <div className="app">
      <header>
        <h1>DevConf 2026</h1>
        <p className="my-session">Your session: {mine ? mine.title : 'none yet'}</p>
      </header>

      <section className="program">
        <h2>Program</h2>
        <ul>
          {state.sessions.map((s) => (
            <li className="session">{s.time} · {s.title} · {s.room}</li>
          ))}
        </ul>
      </section>

      <section className="assistant">
        <h2>Assistant</h2>
        <ol className="messages">
          {a.messages.map((m) => (
            <li className={`msg ${m.role}`}>
              {messageText(m)}
              {(m.parts || []).filter((p) => p.type === 'tool-ask_user').map((p) => card(p, state))}
            </li>
          ))}
          {a.draft && <li className="msg assistant draft">{a.draft}</li>}
        </ol>
        {a.error && <p className="error">Something went wrong: {a.error}</p>}
        <form className="ask">
          <input className="prompt" aria-label="Message" value={a.prompt} placeholder="Ask about the program" />
          <button type="submit" className="send" disabled={busy || !a.prompt.trim()}>Send</button>
        </form>
      </section>
    </div>
  )
}

App.initialState = {
  sessions: SESSIONS,
  mySession: null,
}

App.uses = {
  assistant: chat({ form: '.ask', prompt: '.prompt', instructions: INSTRUCTIONS, clientTools: { ask_user: ASK_USER } }),
}

App.agent = {
  name: 'program',
  description: 'The conference program and the session the user picked',
  read: (state) => ({ sessions: state.sessions, mySession: state.mySession }),
}

App.intent = ({ DOM }) => ({
  PICK: DOM.click('.pick').map((e) => ({ call: e.target.dataset.call, id: e.target.dataset.id })),
})

App.model = {
  PICK: {
    STATE: (state, { id }) => ({ ...state, mySession: id }),
    EFFECT: (state, { call, id }, next) => next('assistant.TOOL_OUTPUT', { toolCallId: call, output: { sessionId: id } }),
  },
}

export default App
