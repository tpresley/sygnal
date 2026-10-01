const STARS = [1, 2, 3, 4, 5]

function App({ state }) {
  const show = (value) => (value ? `${value}/5` : 'not rated')
  return (
    <div className="app">
      <h1>Rate your visit</h1>
      <p className="summary">
        Food: {show(state.food)} · Service: {show(state.service)}
      </p>

      <div className="rating food">
        <span className="label">Food</span>
        {STARS.map((n) => (
          <button className={n <= state.food ? 'star filled' : 'star'} data-value={String(n)}>
            ★
          </button>
        ))}
      </div>

      <div className="rating service">
        <span className="label">Service</span>
        {STARS.map((n) => (
          <button className={n <= state.service ? 'star filled' : 'star'} data-value={String(n)}>
            ★
          </button>
        ))}
      </div>
    </div>
  )
}

App.initialState = {
  food: 0,
  service: 0,
}

App.intent = ({ DOM }) => ({
  RATE_FOOD: DOM.click('.food .star').data('value', Number),
  RATE_SERVICE: DOM.click('.service .star').data('value', Number),
})

App.model = {
  RATE_FOOD: (state, food) => ({ ...state, food }),
  RATE_SERVICE: (state, service) => ({ ...state, service }),
}

export default App
