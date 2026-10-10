import { ABORT } from 'sygnal'
import { messageText } from 'sygnal/ai'

const busy = (state) => state.status === 'sending' || state.status === 'streaming'

function App({ state }) {
  return (
    <main className="support">
      <header>
        <h1>Acme support</h1>
        <p className="intro">Ask us anything about your order, your account or our products.</p>
      </header>
      <section className="chat">
        <ol className="messages" aria-live="polite">
          {state.messages.map((m, i) => <li key={i} className={m.role}>{messageText(m)}</li>)}
          {busy(state) && state.draft && <li className="assistant">{state.draft}</li>}
        </ol>
        {state.failed && (
          <div role="alert">
            <p>Something went wrong.</p>
            <button type="button" className="retry">Retry</button>
          </div>
        )}
        <form className="ask">
          <label>Message <input className="prompt" value={state.prompt} /></label>
          <button type="submit" disabled={busy(state)}>Send</button>
          {busy(state) && <button type="button" className="stop">Stop</button>}
        </form>
      </section>
    </main>
  )
}

App.initialState = { messages: [], prompt: '', draft: '', status: 'ready', failed: false }

App.intent = ({ DOM }) => ({
  TYPE: DOM.input('.prompt').value(),
  SEND: DOM.select('.ask').events('submit', { preventDefault: true }),
  STOP: DOM.click('.stop'),
  RETRY: DOM.click('.retry'),
})

const userMessage = (text) => ({ role: 'user', parts: [{ type: 'text', text }] })
const canSend = (state) => !busy(state) && state.prompt.trim() !== ''
const withPrompt = (state) => [...state.messages, userMessage(state.prompt)]
const ask = (messages) => ({ messages, key: 'reply', delta: 'DELTA', ok: 'DONE', error: 'FAILED' })

App.model = {
  TYPE: (state, prompt) => ({ ...state, prompt }),
  SEND: {
    STATE: (state) => canSend(state) ? { ...state, messages: withPrompt(state), prompt: '', draft: '', status: 'sending', failed: false } : ABORT,
    LLM: (state) => canSend(state) ? ask(withPrompt(state)) : ABORT,
  },
  RETRY: {
    STATE: (state) => busy(state) ? ABORT : { ...state, draft: '', status: 'sending', failed: false },
    LLM: (state) => busy(state) ? ABORT : ask(state.messages),
  },
  STOP: {
    STATE: (state) => busy(state)
      ? { ...state, draft: '', status: 'ready' }
      : ABORT,
    LLM: (state) => busy(state) ? { abort: 'reply' } : ABORT,
  },
  DELTA: (state, { text }) => ({ ...state, draft: text, status: 'streaming' }),
  DONE: (state, { message }) => ({ ...state, messages: [...state.messages, message], draft: '', status: 'ready' }),
  FAILED: (state) => ({ ...state, draft: '', status: 'ready', failed: true }),
}

export default App
