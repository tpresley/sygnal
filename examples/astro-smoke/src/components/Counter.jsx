function Counter({ state, props }) {
  return (
    <section className="counter">
      <h2>{props.title || 'Sygnal Counter'}</h2>
      <p>Count: {state.count}</p>
      <button type="button" className="increment">
        Increment By One...
      </button>
    </section>
  )
}

Counter.initialState = {
  count: 0,
}

Counter.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.increment').events('click'),
})

Counter.model = {
  INCREMENT: {
    STATE: (state) => ({ count: state.count + 1 }),
  },
}

export default Counter
