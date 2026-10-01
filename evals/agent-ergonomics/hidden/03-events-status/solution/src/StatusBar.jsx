function StatusBar({ state }) {
  return <footer className="status-bar">{state.message}</footer>
}

StatusBar.intent = ({ EVENTS }) => ({
  EDITED: EVENTS.select('DOC_EDITED'),
  SAVED: EVENTS.select('DOC_SAVED'),
})

StatusBar.model = {
  EDITED: (state) => ({ ...state, message: 'Unsaved changes' }),
  SAVED: (state, { words }) => ({
    ...state,
    message: `Saved ${words} ${words === 1 ? 'word' : 'words'}`,
  }),
}

export default StatusBar
