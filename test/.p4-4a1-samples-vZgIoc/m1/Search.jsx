import { ABORT, debounce } from 'sygnal'
function Search({ state }) {
  return <div><input className="q" aria-label="Search" value={state.query} /><p className="status">{state.status}</p><ul>{state.results.map(r => <li>{r.title}</li>)}</ul></div>
}
Search.initialState = { query: '', status: '', results: [] }
Search.intent = ({ DOM }) => ({   // no intent line for the reply
  TYPE:   DOM.input('.q').value(),
  SEARCH: DOM.input('.q').value().compose(debounce(300)).filter(q => q !== ''),
})
Search.model = {
  TYPE: {
    STATE: (state, query) => (query === '' ? { ...state, query, status: '', results: [] } : { ...state, query }),
    HTTP:  (state, query) => (query === '' ? { abort: 'RESULTS' } : ABORT),   // clearing cancels the request in flight
  },
  SEARCH: {
    STATE: (state) => ({ ...state, status: 'Searching…' }),
    HTTP:  (state, q) => ({ url: '/api/search', query: { q }, ok: 'RESULTS', error: 'FAILED', latest: true }),
  },
  RESULTS: (state, body) => ({ ...state, status: '', results: body.results }),   // ok: the parsed body
  FAILED:  (state, { status, error }) => ({ ...state, status: status === 404 ? 'Not found.' : 'Search failed.', results: [] }),
}

export { Search }
