function DebugLogDrawer({ state }) {
  const open = state.debugOpen === true
  const logs = Array.isArray(state.logs) ? state.logs : []

  return (
    <aside className={open ? 'debug-drawer open' : 'debug-drawer'}>
      <button
        type="button"
        className="debug-toggle"
        title={open ? 'Close debug log' : 'Open debug log'}
      >
        {open ? 'Close Logs ◀' : 'Logs ▶'}
      </button>

      <div className="debug-content">
        <h3>Audit Log</h3>
        {logs.length > 0 ? (
          <ul className="log-list">
            {logs.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        ) : (
          <p className="history-empty">No events logged yet.</p>
        )}
      </div>
    </aside>
  )
}

DebugLogDrawer.intent = ({ DOM }) => ({
  TOGGLE_DEBUG: DOM.select('.debug-toggle').events('click').mapTo(null)
})

DebugLogDrawer.model = {
  TOGGLE_DEBUG: (state) => {
    const nextOpen = !state.debugOpen
    return {
      ...state,
      debugOpen: nextOpen,
      historyOpen: nextOpen ? false : state.historyOpen
    }
  }
}

export default DebugLogDrawer
