// SYG508 (PLAN-3 §1.1): a select()/errors() round trip on a reply-action driver, where a
// request with reply actions ({ url, ok: 'LOADED', error: 'FAILED' }) would do. Only the strict rules are expected.
import { run, makeFetchDriver, driverFromAsync } from 'sygnal'

function Quote({ state }) {
  return <button className="get">{state.text}</button>
}
Quote.initialState = { text: '' }
Quote.intent = ({ DOM, HTTP }) => ({
  LOAD:   DOM.click('.get'),
  LOADED: HTTP.select('quote'), // expect: SYG508
  FAILED: HTTP.errors('quote'), // expect: SYG508
})
Quote.model = {
  LOAD:   { HTTP: () => ({ category: 'quote', url: '/api/quote' }) },
  LOADED: (state, { value }) => ({ ...state, text: value.text }),
  FAILED: (state) => ({ ...state, text: 'failed' }),
}

// driverFromAsync with a custom selector property
function Users({ state }) {
  return <button className="load-users">{state.users.length}</button>
}
Users.initialState = { users: [] }
Users.intent = (sources) => ({
  FETCH: sources.DOM.click('.load-users'),
  DATA_LOADED: sources.API.select('users'), // expect: SYG508
})
Users.model = {
  FETCH: { API: (state) => ({ endpoint: 'users', url: '/api/users' }) },
  DATA_LOADED: (state, { value }) => ({ ...state, users: value }),
}

run(Quote, {
  HTTP: makeFetchDriver(),
  API: driverFromAsync((req) => fetch(req.url).then(r => r.json()), { selector: 'endpoint' }),
})
