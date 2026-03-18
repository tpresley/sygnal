function BrokenCounter({ state }) {
  if (state.count >= 3) {
    throw new Error('Count too high!')
  }
  return (
    <div>
      <h1>Count: {state.count}</h1>
      <button type="button" className="increment">+</button>
      <p className="hint">Crashes at 3 — try it!</p>
    </div>
  )
}

BrokenCounter.initialState = { count: 0 }

BrokenCounter.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.increment').events('click')
})

BrokenCounter.model = {
  INCREMENT: (state) => ({ count: state.count + 1 })
}

BrokenCounter.onError = (error) => (
  <div className="error-fallback">
    <h2>Something went wrong</h2>
    <p>{error.message}</p>
  </div>
)

export default BrokenCounter
