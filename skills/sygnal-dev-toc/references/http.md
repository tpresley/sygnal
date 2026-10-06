# HTTP: makeFetchDriver and reply actions

Requests from a model sink, reply actions (`ok` / `error`), `latest: true`, aborting, other promise APIs (`driverFromAsync`). Tests: references/testing.md.

## HTTP (makeFetchDriver + reply actions), latest response only
```jsx
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
```
- main.js: `run(Search, { HTTP: makeFetchDriver() })` (options `baseUrl headers init timeoutMs`). Request: `{ url, ok, error, key, query, json, body, method, headers, latest, timeoutMs, init }` (POST with json/body); extra fields aren't sent and come back on `request`. `ok` gets the parsed body; `error` gets `{ error, status, body, request }` (`status` undefined: network error). The reply reaches exactly the sending instance. Never `HTTP.select`/`HTTP.errors` for your own request (SYG508), never `then`/`catch` keys (SYG610).
- `latest: true`: a newer request in the same lane (`key`: a constant name, never an id or URL; default the `ok` action) aborts this instance's older ones once sent; a reply landing earlier (during a debounce) still arrives. `{ abort: 'RESULTS' }` cancels that lane (with a custom `key`, abort that key). **Build the request from `(state, data)`**: sinks see the state before the action, so `SHOW: { STATE: (s, id) => ({ ...s, id }), HTTP: (s, id) => ({ url: '/api/q/' + id, ok: 'LOADED' }) }`, not `s.id`.
- Other promise APIs: `driverFromAsync(fn)` takes the same reply actions (`{ value, ok: 'DONE', error: 'FAILED' }` calls `fn(value)`).
