import { ABORT } from 'sygnal'

function App({ state }) { return <div>{state.n}</div> }
App.initialState = { n: 0 }
App.stateSourceName = 'APP'
App.model = { NOOP: () => ABORT }
export default App
