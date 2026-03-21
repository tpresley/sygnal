/**
 * A simple counter component that renders on the server
 * and becomes interactive on the client.
 */
function Counter({ state }) {
  return (
    <div className="counter">
      <h2>Counter</h2>
      <div className="counter-display">
        <button className="dec">−</button>
        <span className="count">{state.count}</span>
        <button className="inc">+</button>
      </div>
    </div>
  )
}

Counter.initialState = { count: 0 }

Counter.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.inc').events('click'),
  DECREMENT: DOM.select('.dec').events('click'),
})

Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  DECREMENT: (state) => ({ ...state, count: state.count - 1 }),
}

export default Counter
