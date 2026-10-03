const MIN_SIZE = 16
const MAX_SIZE = 32

function App({ state }) {
  return (
    <main className="poster-editor">
      <h1>Poster</h1>
      <div className="toolbar">
        <button className="smaller">Smaller</button>
        <button className="larger">Larger</button>
        <label className="bold-option">
          <input type="checkbox" name="bold" checked={state.bold} />
          <span>Bold</span>
        </label>
      </div>
      <label className="field">
        <span>Headline</span>
        <input name="headline" value={state.headline} />
      </label>
      <p className="preview">{`${state.headline} (${state.size}px${state.bold ? ', bold' : ''})`}</p>
    </main>
  )
}

App.initialState = {
  headline: 'Summer sale',
  size: 28,
  bold: false,
}

App.intent = ({ DOM }) => ({
  SMALLER: DOM.click('.smaller'),
  LARGER: DOM.click('.larger'),
  BOLD: DOM.change('input[name="bold"]').checked(),
  HEADLINE: DOM.input('input[name="headline"]').value(),
})

App.model = {
  SMALLER: (state) => ({ ...state, size: Math.max(MIN_SIZE, state.size - 2) }),
  LARGER: (state) => ({ ...state, size: Math.min(MAX_SIZE, state.size + 2) }),
  BOLD: (state, bold) => ({ ...state, bold }),
  HEADLINE: (state, headline) => ({ ...state, headline }),
}

export default App
