function Greeter({ state } = {}) {
  return (
    <div>
      <h1>Hello {state.name}!</h1>
      <input className="name-input" value={state.name} />
    </div>
  )
}

Greeter.initialState = { name: 'World' }

Greeter.intent = ({ DOM }) => ({
  CHANGE_NAME: DOM.select('.name-input').events('input').map(e => e.target.value)
})

Greeter.model = {
  CHANGE_NAME: (state, data) => ({ name: data })
}

export default Greeter
