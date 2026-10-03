const QUOTE_IDS = [101, 102, 103]

function App({ state }) {
  return (
    <div className="quotes">
      <h1>Quotes</h1>
      <ul className="quote-list">
        {QUOTE_IDS.map((id) => (
          <li>
            <button className={id === state.selected ? 'pick selected' : 'pick'} data-id={String(id)}>
              {`Quote ${id}`}
            </button>
          </li>
        ))}
      </ul>
      <section className="detail">
        {state.selected === null ? (
          <p className="placeholder">Select a quote.</p>
        ) : (
          <div className="quote">
            <h2>{`Quote ${state.selected}`}</h2>
            <button className="refresh">Refresh</button>
            <p className="status"></p>
            <blockquote className="quote-text"></blockquote>
            <p className="quote-author"></p>
          </div>
        )}
      </section>
    </div>
  )
}

App.initialState = {
  selected: null,
}

App.intent = ({ DOM }) => ({
  SELECT: DOM.click('.pick').map((e) => Number(e.target.dataset.id)),
})

App.model = {
  SELECT: (state, selected) => ({ ...state, selected }),
}

export default App
