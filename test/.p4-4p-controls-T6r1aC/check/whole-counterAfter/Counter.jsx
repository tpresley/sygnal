import { ABORT, controls } from 'sygnal'

const { Increment, Reset } = controls({ Increment: 'button', Reset: 'button' })

export function Counter({ state }) {
  return (
    <div>
      <p>{state.count}</p>
      <Increment>+1</Increment>
      <Reset disabled={state.count === 0}>Reset</Reset>
    </div>
  )
}

Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INCREMENT: DOM.click(Increment), RESET: DOM.click(Reset) })
Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  RESET: (state) => (state.count === 0 ? ABORT : { ...state, count: 0 }),
}
