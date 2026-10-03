function App({ state }) {
  return (
    <div className="items-app">
      <h1>Items</h1>
      {state.view === 'list' ? (
        <section className="list">
          <p className="status"></p>
          <ul className="items">
            {state.items.map((item) => (
              <li>
                <button className="open" data-id={String(item.id)}>
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="detail">
          <button className="back">Back to list</button>
          <p className="status"></p>
          <h2 className="item-title"></h2>
          <p className="item-body"></p>
        </section>
      )}
    </div>
  )
}

App.initialState = {
  view: 'list',
  selected: null,
  items: [],
}

App.intent = ({ DOM }) => ({
  OPEN: DOM.click('.open').map((e) => Number(e.target.dataset.id)),
  BACK: DOM.click('.back'),
})

App.model = {
  OPEN: (state, selected) => ({ ...state, view: 'detail', selected }),
  BACK: (state) => ({ ...state, view: 'list' }),
}

export default App
