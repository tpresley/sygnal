import { ABORT } from 'sygnal'

const QUOTE_IDS = [101, 102, 103]

const STATUS_TEXT = { loading: 'Loading…', error: 'Could not load the quote.', done: '' }

function App({ state }) {
  const quote = state.status === 'done' ? state.quote : null
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
            <p className="status">{STATUS_TEXT[state.status]}</p>
            <blockquote className="quote-text">{quote ? quote.text : ''}</blockquote>
            <p className="quote-author">{quote ? quote.author : ''}</p>
          </div>
        )}
      </section>
    </div>
  )
}

// status: 'loading' | 'error' | 'done' (meaningful once a quote is selected)
App.initialState = {
  selected: null,
  status: 'done',
  quote: null,
}

App.intent = ({ DOM, HTTP }) => ({
  SELECT: DOM.click('.pick').map((e) => Number(e.target.dataset.id)),
  REFRESH: DOM.click('.refresh'),
  LOADED: HTTP.select('quote'),
  FAILED: HTTP.errors('quote'),
})

// latest: true aborts the earlier 'quote' request, so its reply never arrives:
// every LOADED / FAILED answers the most recent request.
// mutant: no latest; replies are checked by quote id, which is wrong for two requests of one quote
const load = (id) => ({ category: 'quote', url: `/api/quotes/${id}`, id })

App.model = {
  SELECT: {
    STATE: (state, selected) => ({ ...state, selected, status: 'loading', quote: null }),
    HTTP: (state, selected) => load(selected),
  },
  REFRESH: {
    STATE: (state) => ({ ...state, status: 'loading', quote: null }),
    HTTP: (state) => load(state.selected),
  },
  LOADED: (state, { value, request }) => (request.id === state.selected ? { ...state, status: 'done', quote: value } : ABORT),
  FAILED: (state, { request }) => (request.id === state.selected ? { ...state, status: 'error', quote: null } : ABORT),
}

export default App
