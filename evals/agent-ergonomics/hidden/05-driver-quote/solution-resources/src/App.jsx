// PLAN-3 3-A (exp): task 05 solved with the `resources` static (not used by verify.mjs).
// A click-triggered read: the resource stays idle until the first click; `asks` is part of the
// request, so every click is a changed request and refetches (`{ refresh: 'quote' }` on the
// HTTP sink would do it too, but needs the first click told apart from the later ones).
function App({ state }) {
  return (
    <div className="app">
      <h1>Quote of the day</h1>
      <button className="get-quote">Get a quote</button>
      <blockquote className="quote">{message(state.quote)}</blockquote>
    </div>
  )
}

function message({ status, data }) {
  if (status === 'loading') return 'Loading…'
  if (status === 'error') return 'Could not load a quote.'
  if (status === 'success') return `${data.text} — ${data.author}`
  return 'No quote yet.'
}

App.initialState = {
  asks: 0,
}

App.resources = {
  quote: (state) => state.asks > 0 && { url: '/api/quote', asks: state.asks },
}

App.intent = ({ DOM }) => ({
  GET: DOM.click('.get-quote'),
})

App.model = {
  GET: (state) => ({ ...state, asks: state.asks + 1 }),
}

export default App
