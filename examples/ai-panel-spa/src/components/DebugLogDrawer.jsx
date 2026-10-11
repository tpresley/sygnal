function DebugLogDrawer({ state }) {
  const open = state.debugOpen

  return (
    <aside className={open ? 'debug-drawer open' : 'debug-drawer'}>
      <button type="button" className="debug-toggle" title={open ? 'Close debug log' : 'Open debug log'}>
        {open ? 'Close Logs ◀' : 'Logs ▶'}
      </button>

      <div className="debug-content">
        <h3>Audit Log</h3>
        {state.logs.length > 0 ? (
          <ul className="log-list">
            {state.logs.map((line) => <li>{line}</li>)}
          </ul>
        ) : (
          <p className="history-empty">No events logged yet.</p>
        )}
      </div>
    </aside>
  )
}

DebugLogDrawer.intent = ({ DOM }) => ({
  TOGGLE_DEBUG: DOM.click('.debug-toggle'),
})

DebugLogDrawer.model = {
  TOGGLE_DEBUG: (state) => ({ ...state, debugOpen: !state.debugOpen, historyOpen: false }),
}

export default DebugLogDrawer
