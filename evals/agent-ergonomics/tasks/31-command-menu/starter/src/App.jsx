function App({ state }) {
  return (
    <main className="editor-page">
      <header>
        <h1>Untitled document</h1>
        <p className="last-command">{state.lastCommand ? `Ran: ${state.lastCommand}` : 'No command run yet.'}</p>
      </header>
      <section className="palette"></section>
      <textarea className="document" aria-label="Document" value={state.text}></textarea>
    </main>
  )
}

App.initialState = {
  lastCommand: null,
  text: '',
}

App.intent = ({ DOM }) => ({
  EDIT: DOM.input('.document').value(),
})

App.model = {
  EDIT: (state, text) => ({ ...state, text }),
}

export default App
