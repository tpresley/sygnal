import Stopwatch, { INITIAL } from './Stopwatch.jsx'

function App({ state }) {
  return (
    <main className="app">
      <h1>Workout timer</h1>
      <label className="show">
        <input type="checkbox" name="show" checked={state.show} />
        <span>Show stopwatch</span>
      </label>
      {state.show && <Stopwatch state="stopwatch" />}
    </main>
  )
}

App.initialState = {
  show: true,
  stopwatch: INITIAL,
}

App.intent = ({ DOM }) => ({
  SHOW: DOM.change('input[name="show"]').checked(),
})

App.model = {
  // MUTANT: the stopwatch state survives hiding it
  SHOW: (state, show) => ({ ...state, show }),
}

export default App
