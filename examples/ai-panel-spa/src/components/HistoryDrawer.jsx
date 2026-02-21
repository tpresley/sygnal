const HISTORY_STORAGE_KEY = 'sygnal.aiPanel.sessions'

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleString()
  } catch (_error) {
    return 'Unknown time'
  }
}

function HistoryDrawer({ state }) {
  const sessions = Array.isArray(state.savedSessions) ? state.savedSessions : []
  const open = state.historyOpen === true

  return (
    <aside className={open ? 'history-drawer open' : 'history-drawer'}>
      <button
        type="button"
        className="history-toggle"
        title={open ? 'Close history' : 'Open history'}
      >
        {open ? 'Close ◀' : 'History ▶'}
      </button>

      <div className="history-content">
        <h3>Saved Discussions</h3>
        {sessions.length === 0 ? (
          <p className="history-empty">No saved sessions yet.</p>
        ) : (
          <ul className="history-list">
            {sessions.map((session) => (
              <li key={session.id} className="history-item">
                <button
                  type="button"
                  className="history-open"
                  value={session.id}
                  title="Open saved transcript"
                >
                  <span className="history-title">{session.title}</span>
                  <span className="history-meta">{formatTime(session.createdAt)}</span>
                </button>
                <button
                  type="button"
                  className="history-delete"
                  value={session.id}
                  title="Delete saved transcript"
                  aria-label="Delete saved transcript"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

HistoryDrawer.intent = ({ DOM, STORAGE }) => ({
  TOGGLE_HISTORY: DOM.select('.history-toggle').events('click').mapTo(null),
  OPEN_HISTORY_SESSION: DOM.select('.history-open').events('click').map((event) => event.currentTarget.value),
  DELETE_HISTORY_SESSION: DOM.select('.history-delete').events('click').map((event) => event.currentTarget.value),
  HYDRATE_HISTORY_SESSIONS: STORAGE.get(HISTORY_STORAGE_KEY, [])
})

HistoryDrawer.model = {
  HYDRATE_HISTORY_SESSIONS: (state, sessions) => ({
    ...state,
    savedSessions: Array.isArray(sessions) ? sessions : []
  }),

  TOGGLE_HISTORY: (state) => ({
    ...state,
    historyOpen: !state.historyOpen,
    debugOpen: !state.historyOpen ? false : state.debugOpen
  }),

  OPEN_HISTORY_SESSION: (state, sessionId) => {
    const sessions = Array.isArray(state.savedSessions) ? state.savedSessions : []
    const session = sessions.find((entry) => entry.id === sessionId)
    if (!session) return state

    return {
      ...state,
      topic: session.topic || state.topic,
      panel: session.panel || null,
      transcript: Array.isArray(session.transcript) ? session.transcript : [],
      turnCount: Number.isFinite(session.turnCount) ? session.turnCount : 0,
      phase: 'completed',
      pendingRequest: null,
      activeRunId: null,
      discussionStarted: true,
      copyTranscriptSuccess: false,
      followUpInput: '',
      followUpQuestion: null,
      pendingFollowUpQueue: [],
      historyOpen: false,
      debugOpen: false,
      logs: Array.isArray(session.logs) ? session.logs : state.logs,
      error: null
    }
  },

  DELETE_HISTORY_SESSION: {
    STATE: (state, sessionId) => {
      const sessions = Array.isArray(state.savedSessions) ? state.savedSessions : []
      return {
        ...state,
        savedSessions: sessions.filter((entry) => entry.id !== sessionId)
      }
    },
    STORAGE: (state, sessionId) => {
      const sessions = Array.isArray(state.savedSessions) ? state.savedSessions : []
      return {
        key: HISTORY_STORAGE_KEY,
        value: sessions.filter((entry) => entry.id !== sessionId)
      }
    }
  }
}

export default HistoryDrawer
