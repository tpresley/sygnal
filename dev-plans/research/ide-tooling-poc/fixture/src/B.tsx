import type { Component, IntentSources } from 'sygnal'
import type { ActionsOf } from 'sygnal'
type State = { count: number }
const intent = ({ DOM }: IntentSources<State>) => ({ INCREMENT: DOM.click('.incc') })
const Counter: Component<State, {}, {}, ActionsOf<typeof intent>> = ({ state }) =>
  <div><button className="inc">+</button><span>{state.count}</span></div>
Counter.initialState = { count: 0 }
Counter.intent = intent
Counter.model = { INCREMNT: (state) => ({ ...state, count: state.count + 1 }) }
export default Counter
