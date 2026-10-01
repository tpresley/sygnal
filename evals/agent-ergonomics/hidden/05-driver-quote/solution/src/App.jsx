function App({ state }) {
  return (
    <div className="app">
      <h1>Quote of the day</h1>
      <button className="get-quote">Get a quote</button>
      <blockquote className="quote">{message(state)}</blockquote>
    </div>
  )
}

function message(state) {
  if (state.status === 'loading') return 'Loading…'
  if (state.status === 'error') return 'Could not load a quote.'
  if (state.quote) return `${state.quote.text} — ${state.quote.author}`
  return 'No quote yet.'
}

App.initialState = {
  quote: null,
  status: 'idle',
}

App.intent = ({ DOM, QUOTE }) => ({
  LOAD: DOM.click('.get-quote'),
  LOADED: QUOTE.select('quote').map((reply) => reply.result),
})

App.model = {
  LOAD: {
    STATE: (state) => ({ ...state, status: 'loading' }),
    QUOTE: () => ({ category: 'quote', url: '/api/quote' }),
  },
  LOADED: (state, result) =>
    result.ok
      ? { ...state, status: 'idle', quote: result.quote }
      : { ...state, status: 'error', quote: null },
}

export default App
