// Loaded on demand: this module is its own chunk
export default function Gauge({ state, label }) {
  return (
    <figure className="gauge">
      <meter min="0" max="100" value={state.level} aria-label={label} />
      <figcaption>{label}: {state.level}% (loaded at {state.loadedAt})</figcaption>
      <button className="bump">+10</button>
    </figure>
  )
}

Gauge.initialState = { level: 40, loadedAt: '' }
Gauge.isolatedState = true
Gauge.intent = ({ DOM }) => ({ BUMP: DOM.click('.bump') })
Gauge.model = {
  INITIALIZE: (state) => ({ ...state, loadedAt: new Date().toLocaleTimeString() }),
  BUMP: (state) => ({ ...state, level: Math.min(100, state.level + 10) }),
}
