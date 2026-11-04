import { METRICS } from '../filters.js'

// Step 2, in one of two forms: the wizard's `when` keeps the one that fits the draft's source.

export function Keywords({ state }) {
  return (
    <div className="step">
      <h2 data-router-focus="">Which log lines?</h2>
      <label>Words to match, comma-separated <input className="keywords" value={state.draft.keywords} /></label>
    </div>
  )
}

Keywords.intent = ({ DOM }) => ({ KEYWORDS: DOM.input('.keywords').value() })
Keywords.model = {
  KEYWORDS: (state, keywords) => ({ ...state, draft: { ...state.draft, keywords } }),
}

export function Threshold({ state }) {
  const { metric, above } = state.draft
  return (
    <div className="step">
      <h2 data-router-focus="">Which values?</h2>
      <label>Metric{' '}
        <select className="metric">
          {Object.entries(METRICS).map(([value, label]) => <option value={value} selected={metric === value}>{label}</option>)}
        </select>
      </label>
      <label>Above <input type="number" min="1" className="above" value={above} /></label>
    </div>
  )
}

Threshold.intent = ({ DOM }) => ({
  METRIC: DOM.change('.metric').value(),
  ABOVE: DOM.input('.above').value(),
})
Threshold.model = {
  METRIC: (state, metric) => ({ ...state, draft: { ...state.draft, metric } }),
  ABOVE: (state, above) => ({ ...state, draft: { ...state.draft, above } }),
}
