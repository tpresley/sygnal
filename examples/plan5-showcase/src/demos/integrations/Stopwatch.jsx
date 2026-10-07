import { run, controls } from 'sygnal'
import { Ticker } from './Ticker.js'

// The alternative control form: a widget spec is also a control spec (D189)
const { Count } = controls({ Count: Ticker })

export function Stopwatch({ state }) {
  return (
    <section>
      <div className="row ticker-row">
        <Count step={state.step} broken={state.broken} aria-label="Ticks counted" />
        <span className="muted">last tick event: {state.last}</span>
      </div>
      <div className="row">
        <button className="faster">Step: {state.step} (click for +1)</button>
        <button className="reset">Reset (widget command)</button>
        <button className="break" disabled={state.broken}>Make the next draw fail</button>
        <button className="repair" disabled={!state.broken}>Repair</button>
      </div>
    </section>
  )
}

Stopwatch.initialState = { step: 1, broken: false, last: 0 }

// shown in the widget's place after error(e); the rest of the view keeps working
Stopwatch.onError = (error) => <p className="error" role="alert">Widget stopped: {error.message}</p>

Stopwatch.intent = ({ DOM }) => ({
  TICK: DOM.select(Count).events('tick').detail(),
  FASTER: DOM.click('.faster'),
  RESET: DOM.click('.reset'),
  BREAK: DOM.click('.break'),
  REPAIR: DOM.click('.repair'),
})

Stopwatch.model = {
  TICK: (state, last) => ({ ...state, last }),
  FASTER: (state) => ({ ...state, step: state.step + 1 }),
  RESET: { ELEMENT: { reset: Count } },
  BREAK: (state) => ({ ...state, broken: true }),
  // new props: the widget is tried again
  REPAIR: (state) => ({ ...state, broken: false }),
}

export const start = (mountPoint, uid) => run(Stopwatch, {}, { mountPoint, uid })
