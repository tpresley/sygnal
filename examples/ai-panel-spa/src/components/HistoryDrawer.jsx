import { ABORT } from 'sygnal'
import { runState } from '../panel.js'

function formatTime(timestamp) {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString()
}

function HistoryDrawer({ state, context }) {
  const open = state.historyOpen

  return (
    <aside className={open ? 'history-drawer open' : 'history-drawer'}>
      <button type="button" className="history-toggle" title={open ? 'Close history' : 'Open history'}>
        {open ? 'Close ◀' : 'History ▶'}
      </button>

      <div className="history-content">
        <h3>Saved Discussions</h3>
        {state.sessions.length === 0 ? (
          <p className="history-empty">No saved sessions yet.</p>
        ) : (
          <ul className="history-list">
            {state.sessions.map((session) => (
              <li key={session.id} className="history-item" data={{ id: session.id }}>
                <button type="button" className="history-open" disabled={context.busy} title="Open saved transcript">
                  <span className="history-title">{session.title}</span>
                  <span className="history-meta">{formatTime(session.createdAt)}</span>
                </button>
                <button type="button" className="history-delete" title="Delete saved transcript" aria-label="Delete saved transcript">×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

HistoryDrawer.intent = ({ DOM }) => ({
  TOGGLE_HISTORY: DOM.click('.history-toggle'),
  OPEN_SESSION: DOM.click('.history-open').data('id'),
  DELETE_SESSION: DOM.click('.history-delete').data('id'),
})

// The saved sessions are root state that persist() keeps: these reducers only change the state
HistoryDrawer.model = {
  TOGGLE_HISTORY: (state) => ({ ...state, historyOpen: !state.historyOpen, debugOpen: false }),

  OPEN_SESSION: (state, id) => {
    const session = state.sessions.find((entry) => entry.id === id)
    if (!session) return ABORT
    return {
      ...state,
      ...runState,
      phase: 'completed',
      sessionId: session.id,
      topic: session.topic,
      panel: session.panel,
      transcript: session.transcript,
      turnCount: session.turnCount,
      turnLimit: session.turnCount,
      followUpInput: '',
      historyOpen: false,
    }
  },

  DELETE_SESSION: (state, id) => ({
    ...state,
    sessions: state.sessions.filter((entry) => entry.id !== id),
    sessionId: state.sessionId === id ? null : state.sessionId,
  }),
}

export default HistoryDrawer
