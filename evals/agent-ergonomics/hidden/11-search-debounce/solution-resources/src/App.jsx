// PLAN-3 3-A (exp): task 11 solved with the `resources` static (not used by verify.mjs).
// `term` is the debounced query; clearing the box empties it at once, so the resource goes
// idle (the request in flight is aborted and its reply never shown).
import { debounce } from 'sygnal'

function App({ state }) {
  const { status, data } = state.search
  const results = status === 'success' ? data.results : []
  return (
    <div className="search">
      <h1>Find a book</h1>
      <input type="search" className="search-input" placeholder="Search books" value={state.query} />
      {status === 'loading' && <p className="status">Searching…</p>}
      {status === 'error' && <p className="status">Search failed.</p>}
      {status === 'success' && results.length === 0 && <p className="status">No results</p>}
      <ul className="results">
        {results.map((book) => (
          <li>{book.title}</li>
        ))}
      </ul>
    </div>
  )
}

App.initialState = {
  query: '',
  term: '',
}

App.resources = {
  search: (state) => state.term !== '' && { url: '/api/search', query: { q: state.term } },
}

App.intent = ({ DOM }) => {
  const query$ = DOM.input('.search-input').value()
  return {
    SET_QUERY: query$,
    SEARCH: query$.compose(debounce(300)),
  }
}

App.model = {
  SET_QUERY: (state, query) => ({ ...state, query, term: query === '' ? '' : state.term }),
  SEARCH: (state, term) => ({ ...state, term }),
}

export default App
