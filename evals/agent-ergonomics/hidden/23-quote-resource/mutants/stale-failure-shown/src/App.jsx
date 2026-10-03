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
  seq: 0,
}

App.intent = ({ DOM, HTTP }) => ({
  SELECT: DOM.click('.pick').map((e) => Number(e.target.dataset.id)),
  REFRESH: DOM.click('.refresh'),
  LOADED: HTTP.select('quote'),
  FAILED: HTTP.errors('quote'),
})

// latest: true aborts the earlier 'quote' request, so its reply never arrives:
// every LOADED / FAILED answers the most recent request.
// mutant: no latest; a request number guards successes, but failures are not checked
const load = (id, seq) => ({ category: 'quote', url: `/api/quotes/${id}`, seq })

App.model = {
  SELECT: {
    STATE: (state, selected) => ({ ...state, selected, status: 'loading', quote: null, seq: state.seq + 1 }),
    HTTP: (state, selected) => load(selected, state.seq + 1),
  },
  REFRESH: {
    STATE: (state) => ({ ...state, status: 'loading', quote: null, seq: state.seq + 1 }),
    HTTP: (state) => load(state.selected, state.seq + 1),
  },
  LOADED: (state, { value, request }) => (request.seq === state.seq ? { ...state, status: 'done', quote: value } : ABORT),
  FAILED: (state) => ({ ...state, status: 'error', quote: null }),
}

export default App
