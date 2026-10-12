import { ABORT } from 'sygnal'

export function Counter({ state }) {
  return (
    <div>
      <p>{state.count}</p>
      <button className="increment">+1</button>
      <button className="reset" disabled={state.count === 0}>Reset</button>
    </div>
  )
}

Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INCREMENT: DOM.click('.increment'), RESET: DOM.click('.reset') })
Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  RESET: (state) => (state.count === 0 ? ABORT : { ...state, count: 0 }),
}
