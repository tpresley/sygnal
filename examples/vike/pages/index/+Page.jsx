import { ABORT } from 'sygnal'

function Page({ state }) {
  return (
    <div className="page">
      <h1>Counter</h1>
      <p className="subtitle">A simple interactive counter demonstrating SSR hydration.</p>
      <div className="counter-card">
        <div className="counter-display">{state.count}</div>
        <div className="counter-controls">
          <button className="btn dec">-</button>
          <button className="btn reset">Reset</button>
          <button className="btn inc">+</button>
        </div>
      </div>
      <p className="hint">
        View source to see the server-rendered HTML with embedded state.
      </p>
    </div>
  )
}

Page.initialState = { count: 0 }

Page.intent = ({ DOM }) => ({
  INC: DOM.click('.inc'),
  DEC: DOM.click('.dec'),
  RESET: DOM.click('.reset'),
})

Page.model = {
  INC: (state) => ({ ...state, count: state.count + 1 }),
  DEC: (state) => {
    if (state.count <= 0) return ABORT
    return { ...state, count: state.count - 1 }
  },
  RESET: () => ({ count: 0 }),
}

export default Page
