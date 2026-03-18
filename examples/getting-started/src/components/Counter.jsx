function Counter({ state } = {}) {
  return (
    <div>
      <h1>Count: {state.count}</h1>
      <button type="button" className="increment">+</button>
      <button type="button" className="decrement">-</button>
    </div>
  )
}

Counter.initialState = {
  count: 0
}

Counter.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.increment').events('click'),
  DECREMENT: DOM.select('.decrement').events('click')
})

Counter.model = {
  INCREMENT: (state) => ({ count: state.count + 1 }),
  DECREMENT: (state) => ({ count: state.count - 1 })
}

export default Counter
