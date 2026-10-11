import { OLLAMA_URL } from '../config.js'

const STATUS = {
  idle: 'Idle',
  assembling: 'Assembling panel',
  completed: 'Completed',
  stopped: 'Stopped',
  error: 'Error',
}

const STEP = {
  deciding: 'Choosing the next speaker',
  handoff: 'Moderator is handing off',
  speaking: 'Panelist is responding',
  synthesizing: 'Moderator is summing up',
}

const statusLabel = (state) => (state.phase === 'deliberating' ? STEP[state.step] || 'Panel is deliberating' : STATUS[state.phase])

const sizeOf = (m) => (m.details?.parameter_size ? ` (${m.details.parameter_size})` : '')

function modelPickers(state, context) {
  const models = state.models || { status: 'loading' }
  if (models.status === 'loading' || models.status === 'idle') return <p className="models-note">Loading the installed models…</p>
  if (models.status === 'error' && context.chatModels.length === 0) {
    return (
      <p className="error-text models-note">
        Can't reach Ollama at {OLLAMA_URL}. Start it (<code>ollama serve</code>), then <button type="button" className="refresh-models link-button">try again</button>.
      </p>
    )
  }

  return (
    <div className="setup-inline-fields">
      <label>
        Chat model
        <select className="chat-model" disabled={context.busy}>
          {context.chatModels.length === 0 && <option value="" selected>No chat models installed</option>}
          {context.chatModels.map((m) => (
            <option value={m.name} selected={m.name === state.chatModel}>{m.name}{sizeOf(m)}</option>
          ))}
        </select>
      </label>

      <label>
        Next speaker chosen by
        <select className="decision-model" disabled={context.busy}>
          <option value="" selected={!state.decisionModel}>The moderator (chat model)</option>
          {context.decisionModels.map((m) => (
            <option value={m.name} selected={m.name === state.decisionModel}>{m.name} (decision model)</option>
          ))}
        </select>
      </label>

      <p className="models-note">
        {context.decisionModels.length === 0
          ? <>A decision model picks speakers in a fraction of the time: <code>ollama pull nimble</code>, then </>
          : null}
        <button type="button" className="refresh-models link-button">Refresh models</button>
      </p>
    </div>
  )
}

function SetupCard({ state, context }) {
  const running = context.busy
  const done = state.phase === 'completed' || state.phase === 'stopped' || state.phase === 'error'

  return (
    <section className="card setup-card">
      <h2>Setup</h2>

      {modelPickers(state, context)}

      <label>
        Topic / Question
        <textarea className="topic-input" rows="4" value={state.topic} disabled={running} placeholder="What should the panel discuss?" />
      </label>

      <div className="actions-row">
        {running
          ? <button type="button" className="stop-run">Stop Discussion</button>
          : done
            ? <button type="button" className="new-session-run">New Session</button>
            : <button type="button" className="start-run" disabled={!state.chatModel}>Start Panel Discussion</button>}
      </div>

      <div className="status-row">
        <span className="status-pill">{statusLabel(state)}</span>
        <span className="status-pill">Turns: {state.turnCount}/{state.turnLimit}</span>
        <span className="status-pill">Panel: {state.panel ? `${1 + state.panel.experts.length} members` : '0 members'}</span>
      </div>

      {state.error ? <p className="error-text">{state.error}</p> : null}
    </section>
  )
}

SetupCard.intent = ({ DOM }) => ({
  CHOOSE_CHAT_MODEL: DOM.change('.chat-model').value(),
  CHOOSE_DECISION_MODEL: DOM.change('.decision-model').value(),
  SET_TOPIC: DOM.input('.topic-input').value(),
  START: DOM.click('.start-run'),
  STOP: DOM.click('.stop-run'),
  NEW_SESSION: DOM.click('.new-session-run'),
  REFRESH_MODELS: DOM.click('.refresh-models'),
})

// The choices are this card's; the run itself (requests and their replies) is the root's: PARENT
SetupCard.model = {
  CHOOSE_CHAT_MODEL: (state, chatModel) => ({ ...state, chatModel }),
  CHOOSE_DECISION_MODEL: (state, decisionModel) => ({ ...state, decisionModel }),
  SET_TOPIC: (state, topic) => ({ ...state, topic }),
  START: { PARENT: () => ({ command: 'start' }) },
  STOP: { PARENT: () => ({ command: 'stop' }) },
  NEW_SESSION: { PARENT: () => ({ command: 'new' }) },
  REFRESH_MODELS: { PARENT: () => ({ command: 'refresh' }) },
}

export default SetupCard
