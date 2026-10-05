// TypeScript: strict rules see through annotations and `satisfies`.
import { ABORT } from 'sygnal'
import type { RootComponent } from 'sygnal'

type State = { count: number }

const Counter: RootComponent<State> = (_props: any, state: State) => ( // expect: SYG501 error
  <div className="counter">
    <button className="inc">+</button>
    <button className="reset">0</button>
    <span>{state.count}</span>
  </div>
)

Counter.initialState = { count: 0 }

Counter.intent = ({ DOM, EVENTS }) => ({
  INC: DOM.click('.inc'),
  RESET: DOM.click('.reset'),
  RESET_DONE: EVENTS.select('RESET_DONE'),
})

Counter.model = {
  INC: (state: State) => (state.count > 9 ? state : { ...state, count: state.count + 1 }),
  'RESET | EVENTS': () => ({ type: 'RESET_DONE' }), // expect: SYG504 error, SYG505
  RESET_DONE: (state: State) => ({ ...state, count: 0 }),
} satisfies Record<string, any>

export default Counter
