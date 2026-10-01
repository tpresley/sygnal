import { ABORT, debounce } from 'sygnal'

function App({ state }) {
  return (
    <div className="search">
      <h1>Find a book</h1>
      <input type="search" className="search-input" placeholder="Search books" value={state.query} />
      {state.status === 'searching' && <p className="status">Searching…</p>}
      {state.status === 'error' && <p className="status">Search failed.</p>}
      {state.status === 'done' && state.results.length === 0 && <p className="status">No results</p>}
      <ul className="results">
        {state.results.map((book) => (
          <li>{book.title}</li>
        ))}
      </ul>
    </div>
  )
}

// status: 'idle' | 'searching' | 'done' | 'error'
// pendingQuery: the query of the most recent request still awaited, else null.
App.initialState = {
  query: '',
  status: 'idle',
  results: [],
  pendingQuery: null,
}

App.intent = ({ DOM, SEARCH }) => {
  const query$ = DOM.input('.search-input').value()
  return {
    SET_QUERY: query$,
    START_SEARCH: query$.compose(debounce(300)).filter((query) => query !== ''),
    REPLY: SEARCH.select('books').map((reply) => reply.reply),
  }
}

App.model = {
  SET_QUERY: (state, query) =>
    query === ''
      ? { ...state, query, status: 'idle', results: [], pendingQuery: null }
      : { ...state, query },

  START_SEARCH: {
    STATE: (state, query) => ({ ...state, status: 'searching', pendingQuery: query }),
    SEARCH: (state, query) => ({ category: 'books', query }),
  },

  REPLY: (state, reply) => {
    if (reply.query !== state.pendingQuery) return ABORT
    return reply.ok
      ? { ...state, status: 'done', results: reply.results, pendingQuery: null }
      : { ...state, status: 'error', results: [], pendingQuery: null }
  },
}

export default App
