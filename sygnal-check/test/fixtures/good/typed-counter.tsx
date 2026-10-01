// TypeScript component shapes. Expect: no diagnostics.
import { xs, classes, ABORT } from 'sygnal'
import type { Component, RootComponent } from 'sygnal'

type State = { count: number; step: number; history: number[] }
type Actions = { INC: null; DEC: null; STEP: number; RESET: null }

const INITIAL: State = { count: 0, step: 1, history: [] }

const Counter: RootComponent<State, {}, Actions> = function ({ state }) {
  const cls = classes('counter', { negative: state.count < 0 })
  return (
    <div className={cls}>
      <button className="inc">+</button>
      <button className="dec">-</button>
      <input className="step" type="number" value={state.step as number} />
      <ul className="history">{state.history.map(h => <li className={`entry entry-${h}`}>{h}</li>)}</ul>
    </div>
  )
}

Counter.initialState = INITIAL

Counter.intent = ({ DOM }) => {
  const inc$ = DOM.click('.inc').mapTo(null)
  const dec$ = DOM.click('.dec').mapTo(null)
  const step$ = DOM.input('.step').map((e: any) => Number(e.target.value))
  const actions = {
    INC: inc$,
    DEC: dec$,
    STEP: step$,
  }
  return actions
}

Counter.model = {
  INC: (state) => ({ ...state, count: state.count + state.step }),
  DEC: (state, _data, next) => {
    if (state.count - state.step < -10) { next('RESET'); return ABORT }
    return { ...state, count: state.count - state.step }
  },
  STEP: (state, step) => ({ ...state, step }),
  RESET: () => ({ ...INITIAL }),
} satisfies Record<string, any>

const Entry: Component<{ value: number }> = ({ state }) => <span className="entry-value">{state.value}</span>
Entry.intent = ({ DOM }) => ({ CLICK: DOM.click('.entry-value') }) as const
Entry.model = { CLICK: (s) => s }

export default Counter
