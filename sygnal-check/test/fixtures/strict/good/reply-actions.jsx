// The reply-action form (PLAN-3 §1.1), plus select() round trips SYG508 must leave alone.
import { run, makeFetchDriver } from 'sygnal'

function Quote({ state }) {
  return <button className="get">{state.text}</button>
}
Quote.initialState = { text: '' }
Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.get') })
Quote.model = {
  LOAD:   { HTTP: () => ({ url: '/api/quote', ok: 'LOADED', error: 'FAILED' }) },
  LOADED: (state, quote) => ({ ...state, text: quote.text }),
  FAILED: (state) => ({ ...state, text: 'failed' }),
}

// a custom driver keeps select(): nothing says it has reply actions
function Feed({ state }) {
  return <button className="refresh">{state.items.length}</button>
}
Feed.initialState = { items: [] }
Feed.intent = ({ DOM, FEED }) => ({
  REFRESH: DOM.click('.refresh'),
  ITEMS:   FEED.select('items'),
})
Feed.model = {
  REFRESH: { FEED: () => ({ category: 'items' }) },
  ITEMS:   (state, items) => ({ ...state, items }),
}

// HTTP.select() of a category the component never requests (another component's replies)
function Log({ state }) {
  return <p className="log">{state.n}</p>
}
Log.initialState = { n: 0 }
Log.intent = ({ HTTP }) => ({ SEEN: HTTP.select('quote') })
Log.model = { SEEN: (state) => ({ ...state, n: state.n + 1 }) }

run(Quote, { HTTP: makeFetchDriver(), FEED: makeFeedDriver() })

function makeFeedDriver() {
  return () => ({ select: () => null })
}
