function App({ state }) {
  return (
    <div className="search">
      <h1>Find a book</h1>
      <input type="search" className="search-input" placeholder="Search books" value={state.query} />
      <ul className="results"></ul>
    </div>
  )
}

App.initialState = {
  query: '',
}

App.intent = ({ DOM }) => ({
  SET_QUERY: DOM.input('.search-input').value(),
})

App.model = {
  SET_QUERY: (state, query) => ({ ...state, query }),
}

export default App
