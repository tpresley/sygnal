function RootComponent({ state }) {
  return (
    <main className="wrap">
      <h1>Sygnal HMR Smoke Test</h1>
      <p>
        Count: <strong>{state.count}</strong>
      </p>
      <button type="button" className="increment-button">Increment</button>
      <p className="note">
        Edit this line to test HMR: <code>RootComponent.jsx</code>
      </p>
    </main>
  )
}

RootComponent.initialState = {
  count: 0
}

RootComponent.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.increment-button').events('click')
})

RootComponent.model = {
  INCREMENT: (state) => ({ count: state.count + 1 })
}

export default RootComponent
