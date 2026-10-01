function App({ state }) {
  return (
    <div className="app">
      <h1>Quote of the day</h1>
      <button className="get-quote">Get a quote</button>
      <blockquote className="quote">{state.quote || 'No quote yet.'}</blockquote>
    </div>
  )
}

App.initialState = {
  quote: null,
}

export default App
