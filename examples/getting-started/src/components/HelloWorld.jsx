function HelloWorld({ state } = {}) {
  return (
    <div>
      <h1>Hello {state.name}!</h1>
    </div>
  )
}

HelloWorld.initialState = {
  name: 'World'
}

export default HelloWorld
