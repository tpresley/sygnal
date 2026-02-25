import Header from './Header.jsx'

function CounterWithHeader({ state }) {
  return (
    <div>
      <Header title="My App" />
      <p>Count: {state.count}</p>
      <button type="button" className="increment">+</button>
    </div>
  )
}

CounterWithHeader.initialState = { count: 0 }

CounterWithHeader.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.increment').events('click')
})

CounterWithHeader.model = {
  INCREMENT: (state) => ({ count: state.count + 1 })
}

export default CounterWithHeader
