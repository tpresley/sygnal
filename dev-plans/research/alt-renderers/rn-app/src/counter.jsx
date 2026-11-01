/** @jsxImportSource sygnal */
// The counter: one view in HTML tags, the same component the web renders, unchanged on native.
import { controls } from 'sygnal'

export const { Inc, Dec, Reset } = controls({ Inc: 'button', Dec: 'button', Reset: 'button' })

export default function Counter({ state }) {
  return (
    <section>
      <h1>Count: {state.count}</h1>
      <div className="buttons" style={{ flexDirection: 'row', gap: 8 }}>
        <Dec aria-label="Decrement">−</Dec>
        <Inc aria-label="Increment">+</Inc>
        <Reset>Reset</Reset>
      </div>
    </section>
  )
}

Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click(Inc), DEC: DOM.click(Dec), RESET: DOM.click(Reset) })
Counter.model = {
  INC: (state) => ({ count: state.count + 1 }),
  DEC: (state) => ({ count: state.count - 1 }),
  RESET: () => ({ count: 0 }),
}
