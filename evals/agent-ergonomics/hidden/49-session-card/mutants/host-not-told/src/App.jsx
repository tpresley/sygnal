// The conference page: the program, the user's session, and a chat assistant that asks with cards.
import { chat, askCard } from 'sygnal/ai'
import { SESSIONS } from './data.js'
import { catalog, SessionPicker } from './cards.jsx'

const INSTRUCTIONS = [
  'You are the assistant of the DevConf 2026 page. You help the user find their way around the program and choose the session they will attend.',
  'The app state lists the sessions with their ids, titles, times and rooms: quote only those.',
  'Keep replies short: one to three sentences.',
].join(' ')

function part(p, state) {
  if (p.type === 'text') return p.text
  if (p.type === 'tool-ask_user') {
    return (
      <div className="ask-card">
        <p className="need">{p.input?.need}</p>
        {askCard(catalog, state, p) ?? <p className="muted">Composing…</p>}
      </div>
    )
  }
  return null
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
            <li className={`msg ${m.role}`}>{(m.parts || []).map((p) => part(p, state))}</li>
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
  assistant: chat({ form: '.ask', prompt: '.prompt', instructions: INSTRUCTIONS, ask: { catalog } }),
}

App.agent = {
  name: 'program',
  description: 'The conference program and the session the user picked',
  read: (state) => ({ sessions: state.sessions, mySession: state.mySession }),
}

// Mutant: the answer goes to the model only; the page never hears which session was picked
void SessionPicker

export default App
