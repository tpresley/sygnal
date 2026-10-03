// PLAN-3 3-A (exp): task 23 solved with the `resources` static (not used by verify.mjs)
const QUOTE_IDS = [101, 102, 103]

const STATUS_TEXT = { loading: 'Loading…', error: 'Could not load the quote.' }

function App({ state }) {
  const { status, data } = state.quote
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
            <p className="status">{STATUS_TEXT[status] ?? ''}</p>
            <blockquote className="quote-text">{data?.text ?? ''}</blockquote>
            <p className="quote-author">{data?.author ?? ''}</p>
          </div>
        )}
      </section>
    </div>
  )
}

App.initialState = {
  selected: null,
}

// state.quote = { status: 'idle' | 'loading' | 'success' | 'error', data, error }
App.resources = {
  quote: (state) => state.selected !== null && `/api/quotes/${state.selected}`,
}

App.intent = ({ DOM }) => ({
  SELECT: DOM.click('.pick').map((e) => Number(e.target.dataset.id)),
  REFRESH: DOM.click('.refresh'),
})

App.model = {
  SELECT: (state, selected) => ({ ...state, selected }),
  REFRESH: { HTTP: { refresh: 'quote' } },
}

export default App
