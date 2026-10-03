const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0)

function App({ state }) {
  const words = countWords(state.body)
  return (
    <main className="note-editor">
      <h1>Note</h1>
      <label className="field">
        <span>Title</span>
        <input name="title" value={state.title} />
      </label>
      <label className="field">
        <span>Body</span>
        <textarea name="body" rows="8" value={state.body}></textarea>
      </label>
      <p className="word-count">{`${words} ${words === 1 ? 'word' : 'words'}`}</p>
      <p className="save-status"></p>
    </main>
  )
}

App.initialState = {
  title: '',
  body: '',
}

App.intent = ({ DOM }) => ({
  TITLE: DOM.input('input[name="title"]').value(),
  BODY: DOM.input('textarea[name="body"]').value(),
})

App.model = {
  TITLE: (state, title) => ({ ...state, title }),
  BODY: (state, body) => ({ ...state, body }),
}

export default App
