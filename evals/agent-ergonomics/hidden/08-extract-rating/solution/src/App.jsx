import StarRating from './StarRating.jsx'

function App({ state }) {
  const show = (value) => (value ? `${value}/5` : 'not rated')
  return (
    <div className="app">
      <h1>Rate your visit</h1>
      <p className="summary">
        Food: {show(state.food)} · Service: {show(state.service)}
      </p>
      <StarRating name="food" label="Food" value={state.food} />
      <StarRating name="service" label="Service" value={state.service} />
    </div>
  )
}

App.initialState = {
  food: 0,
  service: 0,
}

App.intent = ({ CHILD }) => ({
  RATE: CHILD.select(StarRating),
})

App.model = {
  RATE: (state, { name, value }) => ({ ...state, [name]: value }),
}

export default App
